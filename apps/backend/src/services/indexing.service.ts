import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseService } from './database.service';
import { OpenRouterService } from './openrouter.service';
import { ProjectsService } from './projects.service';
import { ProgressEventsService } from './progress-events.service';
import { LanceChunkRow, LanceDbService } from './lancedb.service';
import { chunkText } from '../utils/chunking';
import { isIndexableFile, MAX_FILE_SIZE_BYTES, shouldSkipDirectory, detectLanguage } from '../utils/file-rules';
import { makeId, sha256 } from '../utils/id';

interface IndexedFileInfo {
	relativePath: string;
	absolutePath: string;
	contentHash: string;
	sizeBytes: number;
	language: string;
	extension: string;
}

@Injectable()
export class IndexingService {
	private progress = new Map<string, { indexedFiles: number; totalFiles: number; message?: string }>();

	constructor(
		private readonly db: DatabaseService,
		private readonly projectsService: ProjectsService,
		private readonly openRouterService: OpenRouterService,
		private readonly progressEvents: ProgressEventsService,
		private readonly lanceDbService: LanceDbService,
	) { }

	getProgress(projectId: string) {
		return this.progress.get(projectId) ?? { indexedFiles: 0, totalFiles: 0 };
	}

	async indexProject(projectId: string) {
		const project = this.projectsService.getProjectById(projectId);
		this.projectsService.setProjectStatus(projectId, 'indexing');

		const files = this.scanFiles(project.rootPath);
		this.progress.set(projectId, { indexedFiles: 0, totalFiles: files.length, message: 'Индексация запущена' });
		this.progressEvents.emit(projectId, { event: 'indexing.started', data: { totalFiles: files.length } });

		const existingFiles = this.db.all<{ id: string; relativePath: string; contentHash: string }>(
			'SELECT id, relativePath, contentHash FROM files WHERE projectId = ?',
			[projectId],
		);
		const existingByPath = new Map(existingFiles.map((item) => [item.relativePath, item]));

		let indexedFiles = 0;
		const seen = new Set<string>();

		for (const file of files) {
			seen.add(file.relativePath);
			const existing = existingByPath.get(file.relativePath);

			if (existing && existing.contentHash === file.contentHash) {
				indexedFiles += 1;
				this.emitProgress(projectId, indexedFiles, files.length, file.relativePath, true);
				continue;
			}

			const content = fs.readFileSync(file.absolutePath, 'utf-8');
			const chunkUnits = chunkText(content);
			const embeddings = chunkUnits.length
				? await this.openRouterService.createEmbeddings(chunkUnits.map((chunk) => chunk.content))
				: [];
			const fileId = existing?.id ?? makeId();
			const lanceRows: LanceChunkRow[] = [];

			this.db.transaction(() => {

				if (!existing) {
					this.db.run(
						`INSERT INTO files (id, projectId, relativePath, absolutePath, extension, language, sizeBytes, contentHash, indexedAt, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						[
							fileId,
							projectId,
							file.relativePath,
							file.absolutePath,
							file.extension,
							file.language,
							file.sizeBytes,
							file.contentHash,
							new Date().toISOString(),
							'indexed',
						],
					);
				} else {
					this.db.run(
						`UPDATE files SET absolutePath = ?, extension = ?, language = ?, sizeBytes = ?, contentHash = ?, indexedAt = ?, status = ?
             WHERE id = ?`,
						[
							file.absolutePath,
							file.extension,
							file.language,
							file.sizeBytes,
							file.contentHash,
							new Date().toISOString(),
							'indexed',
							fileId,
						],
					);
				}

				this.db.run('DELETE FROM chunks WHERE projectId = ? AND fileId = ?', [projectId, fileId]);

				chunkUnits.forEach((chunk, index) => {
					const chunkId = makeId();
					const vector = embeddings[index] ?? [];
					this.db.run(
						`INSERT INTO chunks (id, projectId, fileId, relativePath, chunkIndex, startLine, endLine, language, symbolName, content, embedding)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						[
							chunkId,
							projectId,
							fileId,
							file.relativePath,
							chunk.chunkIndex,
							chunk.startLine,
							chunk.endLine,
							file.language,
							chunk.symbolName,
							chunk.content,
							JSON.stringify(vector),
						],
					);
					lanceRows.push({
						chunkId,
						projectId,
						fileId,
						relativePath: file.relativePath,
						startLine: chunk.startLine,
						endLine: chunk.endLine,
						language: file.language,
						symbolName: chunk.symbolName,
						content: chunk.content,
						vector,
					});
				});
			});
			await this.lanceDbService.upsertFileChunks(projectId, fileId, lanceRows);

			indexedFiles += 1;
			this.emitProgress(projectId, indexedFiles, files.length, file.relativePath, false);
		}

		for (const old of existingFiles) {
			if (seen.has(old.relativePath)) continue;
			this.db.transaction(() => {
				this.db.run('DELETE FROM chunks WHERE projectId = ? AND fileId = ?', [projectId, old.id]);
				this.db.run('DELETE FROM files WHERE id = ?', [old.id]);
			});
			await this.lanceDbService.deleteFileChunks(projectId, old.id);
		}

		this.projectsService.setProjectIndexed(projectId);
		this.progress.set(projectId, { indexedFiles: files.length, totalFiles: files.length, message: 'Индексация завершена' });
		this.progressEvents.emit(projectId, {
			event: 'indexing.completed',
			data: this.projectsService.getProjectStats(projectId),
		});
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

				const content = fs.readFileSync(absolutePath, 'utf-8');

				result.push({
					relativePath,
					absolutePath,
					sizeBytes: stats.size,
					language: detectLanguage(absolutePath),
					extension: path.extname(absolutePath).toLowerCase(),
					contentHash: sha256(content),
				});
			}
		};

		walk(rootPath);

		return result.slice(0, 5000);
	}
}
