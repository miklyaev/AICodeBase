import { Injectable, Optional } from '@nestjs/common';
import { IndexLifecycleService } from './index-lifecycle.service';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseService } from './database.service';
import { LlmService } from './llm.service';
import { ProjectsService } from './projects.service';
import { ProgressEventsService } from './progress-events.service';
import { LanceChunkRow, LanceDbService } from './lancedb.service';
import { SettingsService } from './settings.service';
import { chunkText } from '../utils/chunking';
import { isIndexableFile, MAX_FILE_SIZE_BYTES, shouldSkipDirectory, detectLanguage } from '../utils/file-rules';
import { makeId, sha256 } from '../utils/id';
import { describeIndexingFailure, IndexingFailure, indexingFailureMessage, IndexingOperationError, IndexingStage } from './indexing-error';

interface IndexedFileInfo {
	relativePath: string;
	absolutePath: string;
	language: string;
	extension: string;
}

interface ExistingFile {
	id: string;
	relativePath: string;
	contentHash: string;
	status: string;
}

export interface IndexingProgress {
	indexedFiles: number;
	totalFiles: number;
	message?: string;
	stage?: IndexingStage;
	failedFiles?: number;
	failure?: IndexingFailure;
}

@Injectable()
export class IndexingService {
	private progress = new Map<string, IndexingProgress>();

	constructor(
		private readonly db: DatabaseService,
		private readonly projectsService: ProjectsService,
		private readonly llmService: LlmService,
		private readonly progressEvents: ProgressEventsService,
		private readonly lanceDbService: LanceDbService,
		private readonly settingsService: SettingsService,
		@Optional() private readonly lifecycle?: IndexLifecycleService,
	) { }

	getProgress(projectId: string): IndexingProgress {
		return this.progress.get(projectId) ?? { indexedFiles: 0, totalFiles: 0 };
	}

	markFailed(projectId: string, error: unknown) {
		const progress = this.getProgress(projectId);
		const failure = describeIndexingFailure(error, progress.stage);
		const message = indexingFailureMessage(failure);
		this.projectsService.setProjectStatus(projectId, 'failed');
		this.progress.set(projectId, { ...progress, message, failure });
		this.progressEvents.emit(projectId, { event: 'indexing.failed', data: { code: failure.code, failure, message } });
	}

	private async prepare(projectId: string) {
		this.projectsService.getProjectById(projectId);
		const release = this.lifecycle?.acquire() ?? (() => undefined);
		try {
			await this.lifecycle?.assertCompatible();
			return release;
		} catch (error) {
			release();
			throw error;
		}
	}

	async startIndexing(projectId: string) {
		const release = await this.prepare(projectId);
		void this.runIndexProject(projectId).catch((error: unknown) => this.markFailed(projectId, error)).finally(release);
		return { started: true };
	}

	async indexProject(projectId: string) {
		const release = await this.prepare(projectId);
		try {
			await this.runIndexProject(projectId);
		} finally {
			release();
		}
	}

	private async runIndexProject(projectId: string) {
		const project = this.projectsService.getProjectById(projectId);
		this.projectsService.setProjectStatus(projectId, 'indexing');
		this.progress.set(projectId, { indexedFiles: 0, totalFiles: 0, stage: 'embeddings', message: 'Проверка модели embeddings' });
		this.settingsService.getApiKeyOrThrow();
		const probeVector = (await this.llmService.createEmbeddings(['index dimension check']))[0];
		await this.lanceDbService.assertCompatibleDimension(probeVector.length);
		this.lifecycle?.initializeFingerprint();

		this.progress.set(projectId, { indexedFiles: 0, totalFiles: 0, stage: 'scan', message: 'Сканирование проекта' });
		const files = this.scanFiles(project.rootPath);
		this.progress.set(projectId, { indexedFiles: 0, totalFiles: files.length, message: 'Индексация запущена' });
		this.progressEvents.emit(projectId, { event: 'indexing.started', data: { totalFiles: files.length } });

		const existingFiles = this.db.all<ExistingFile>(
			'SELECT id, relativePath, contentHash, status FROM files WHERE projectId = ?',
			[projectId],
		);
		const existingByPath = new Map(existingFiles.map((item) => [item.relativePath, item]));

		let indexedFiles = 0;
		const seen = new Set<string>();
		const failures: IndexingFailure[] = [];

		for (const file of files) {
			seen.add(file.relativePath);
			try {
				const skipped = await this.indexFile(projectId, file, existingByPath.get(file.relativePath));
				indexedFiles += 1;
				this.emitProgress(projectId, indexedFiles, files.length, file.relativePath, skipped);
			} catch (error) {
				const failure = describeIndexingFailure(error, 'read', file.relativePath);
				const recoverable = failure.stage === 'read' || (failure.stage === 'embeddings'
					&& (failure.code === 'INVALID_EMBEDDING_INPUT' || [400, 413, 422].includes(failure.providerStatus ?? 0)));
				if (!recoverable) throw new IndexingOperationError(failure);
				failures.push(failure);
				const message = indexingFailureMessage(failure);
				this.progress.set(projectId, { indexedFiles, totalFiles: files.length, failedFiles: failures.length, failure, message });
				this.progressEvents.emit(projectId, {
					event: 'indexing.fileFailed', data: { failure, message, failedFiles: failures.length },
				});
			}
		}

		for (const old of existingFiles) {
			if (seen.has(old.relativePath)) continue;
			try {
				this.db.transaction(() => {
					this.db.run('DELETE FROM chunks WHERE projectId = ? AND fileId = ?', [projectId, old.id]);
					this.db.run('DELETE FROM files WHERE id = ?', [old.id]);
				});
				await this.lanceDbService.deleteFileChunks(projectId, old.id);
			} catch (error) {
				throw new IndexingOperationError(describeIndexingFailure(error, 'cleanup', old.relativePath));
			}
		}

		if (failures.length) {
			const failure = failures[0];
			const message = `Обработка завершена: успешно ${indexedFiles} из ${files.length} файлов, ошибок: ${failures.length}. ${indexingFailureMessage(failure)}`;
			this.projectsService.setProjectStatus(projectId, 'failed');
			this.progress.set(projectId, { indexedFiles, totalFiles: files.length, failedFiles: failures.length, failure, message });
			this.progressEvents.emit(projectId, {
				event: 'indexing.failed', data: { code: 'INDEXING_PARTIAL_FAILURE', failedFiles: failures.length, failure, message },
			});
			return;
		}

		this.projectsService.setProjectIndexed(projectId);
		this.progress.set(projectId, { indexedFiles: files.length, totalFiles: files.length, message: 'Индексация завершена' });
		this.progressEvents.emit(projectId, {
			event: 'indexing.completed',
			data: this.projectsService.getProjectStats(projectId),
		});
	}

	private async indexFile(projectId: string, file: IndexedFileInfo, existing?: ExistingFile): Promise<boolean> {
		let stage: IndexingStage = 'read';
		try {
			const content = fs.readFileSync(file.absolutePath, 'utf-8');
			const contentHash = sha256(content);
			if (existing?.status === 'indexed' && existing.contentHash === contentHash) return true;
			const chunkUnits = chunkText(content);
			stage = 'embeddings';
			const embeddings = chunkUnits.length
				? await this.llmService.createEmbeddings(chunkUnits.map((chunk) => chunk.content)) : [];
			stage = 'vectors';
			if (embeddings.length) await this.lanceDbService.assertCompatibleDimension(embeddings[0].length);
			const fileId = existing?.id ?? makeId();
			const lanceRows: LanceChunkRow[] = chunkUnits.map((chunk, index) => ({
				chunkId: makeId(), projectId, fileId, relativePath: file.relativePath,
				startLine: chunk.startLine, endLine: chunk.endLine, language: file.language,
				symbolName: chunk.symbolName, content: chunk.content, vector: embeddings[index],
			}));
			stage = 'sqlite';
			this.db.transaction(() => {
				if (!existing) {
					this.db.run(
						`INSERT INTO files (id, projectId, relativePath, absolutePath, extension, language, sizeBytes, contentHash, indexedAt, status)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						[fileId, projectId, file.relativePath, file.absolutePath, file.extension, file.language,
							Buffer.byteLength(content, 'utf8'), contentHash, new Date().toISOString(), 'indexing'],
					);
				} else {
					this.db.run(
						`UPDATE files SET absolutePath = ?, extension = ?, language = ?, sizeBytes = ?, contentHash = ?, indexedAt = ?, status = ? WHERE id = ?`,
						[file.absolutePath, file.extension, file.language, Buffer.byteLength(content, 'utf8'),
							contentHash, new Date().toISOString(), 'indexing', fileId],
					);
				}
				this.db.run('DELETE FROM chunks WHERE projectId = ? AND fileId = ?', [projectId, fileId]);
				chunkUnits.forEach((chunk, index) => {
					this.db.run(
						`INSERT INTO chunks (id, projectId, fileId, relativePath, chunkIndex, startLine, endLine, language, symbolName, content, embedding)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						[lanceRows[index].chunkId, projectId, fileId, file.relativePath, chunk.chunkIndex,
							chunk.startLine, chunk.endLine, file.language, chunk.symbolName, chunk.content, JSON.stringify(embeddings[index])],
					);
				});
			});
			stage = 'vectors';
			// Empty files still replace/remove their previous vectors, but never call the LLM.
			await this.lanceDbService.upsertFileChunks(projectId, fileId, lanceRows);
			stage = 'sqlite';
			// A vector-write failure must not make the next attempt skip this file by hash.
			this.db.run('UPDATE files SET status = ? WHERE id = ?', ['indexed', fileId]);
			return false;
		} catch (error) {
			throw new IndexingOperationError(describeIndexingFailure(error, stage, file.relativePath));
		}
	}

	private emitProgress(projectId: string, indexedFiles: number, totalFiles: number, relativePath: string, skipped: boolean) {
		this.progress.set(projectId, {
			indexedFiles,
			totalFiles,
			message: skipped ? 'Файл пропущен (без изменений)' : `Обработан ${relativePath}`,
		});

		this.progressEvents.emit(projectId, {
			event: skipped ? 'indexing.fileSkipped' : 'indexing.progress',
			data: { indexedFiles, totalFiles, relativePath },
		});
	}

	private scanFiles(rootPath: string): IndexedFileInfo[] {
		const result: IndexedFileInfo[] = [];
		let totalSize = 0;

		const walk = (dir: string) => {
			const entries = fs.readdirSync(dir, { withFileTypes: true });

			for (const entry of entries) {
				const absolutePath = path.join(dir, entry.name);
				const relativePath = path.relative(rootPath, absolutePath).replace(/\\/g, '/');

				if (entry.isDirectory()) {
					if (shouldSkipDirectory(entry.name)) continue;
					walk(absolutePath);
					continue;
				}

				if (!entry.isFile()) continue;
				if (!isIndexableFile(entry.name, absolutePath)) continue;

				const stats = fs.statSync(absolutePath);
				if (stats.size > MAX_FILE_SIZE_BYTES) continue;

				totalSize += stats.size;
				if (totalSize > 200 * 1024 * 1024) {
					return;
				}

				result.push({
					relativePath,
					absolutePath,
					language: detectLanguage(absolutePath),
					extension: path.extname(absolutePath).toLowerCase(),
				});
			}
		};

		walk(rootPath);

		return result.slice(0, 5000);
	}
}
