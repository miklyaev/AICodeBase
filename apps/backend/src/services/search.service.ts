import { Injectable, Optional } from '@nestjs/common';
import { IndexLifecycleService } from './index-lifecycle.service';
import { CodeReference } from '../types';
import { DatabaseService } from './database.service';
import { LlmService } from './llm.service';
import { ProjectsService } from './projects.service';
import { LanceDbService } from './lancedb.service';

export interface SearchFilters {
	language?: string;
	fileExtension?: string;
	directory?: string;
}

interface KeywordChunkRow {
	relativePath: string;
	startLine: number;
	endLine: number;
	language: string;
	symbolName: string | null;
	content: string;
}

@Injectable()
export class SearchService {
	constructor(
		private readonly db: DatabaseService,
		private readonly llmService: LlmService,
		private readonly projectsService: ProjectsService,
		private readonly lanceDbService: LanceDbService,
		@Optional() private readonly lifecycle?: IndexLifecycleService,
	) { }

	private applyFilters(row: { relativePath: string; language: string }, filters: SearchFilters): boolean {
		if (filters.language && row.language.toLowerCase() !== filters.language.toLowerCase()) return false;
		if (filters.fileExtension) {
			const ext = filters.fileExtension.startsWith('.') ? filters.fileExtension : `.${filters.fileExtension}`;
			if (!row.relativePath.toLowerCase().endsWith(ext.toLowerCase())) return false;
		}
		if (filters.directory) {
			const dir = filters.directory.replace(/\\/g, '/').toLowerCase();
			const rel = row.relativePath.replace(/\\/g, '/').toLowerCase();
			if (!rel.startsWith(dir)) return false;
		}
		return true;
	}

	async search(projectId: string, query: string, topK = 8, filters?: SearchFilters): Promise<CodeReference[]> {
		const release = this.lifecycle?.acquire() ?? (() => undefined);
		try {
			await this.lifecycle?.assertCompatible();
			return await this.runSearch(projectId, query, topK, filters);
		} finally {
			release();
		}
	}

	private async runSearch(projectId: string, query: string, topK: number, filters?: SearchFilters): Promise<CodeReference[]> {
		this.projectsService.getProjectById(projectId);
		const lowered = query.toLowerCase();
		const queryVector = (await this.llmService.createEmbeddings([query]))[0] ?? [];
		const vectorRows = await this.lanceDbService.vectorSearch(projectId, queryVector, topK);
		const keywordRows = this.db.all<KeywordChunkRow>(
			`SELECT relativePath, startLine, endLine, language, symbolName, content
       FROM chunks
       WHERE projectId = ?
         AND (LOWER(content) LIKE ? OR LOWER(IFNULL(symbolName, '')) LIKE ?)
       LIMIT ?`,
			[projectId, `%${lowered}%`, `%${lowered}%`, Math.max(topK * 2, 20)],
		);

		const merged = new Map<string, CodeReference>();

		for (const row of vectorRows) {
			if (filters && !this.applyFilters(row as any, filters)) continue;
			const distance = Number((row as any)._distance ?? 1);
			const score = 1 / (1 + Math.max(distance, 0));
			const key = `${row.relativePath}:${row.startLine}:${row.endLine}`;
			merged.set(key, {
				filePath: row.relativePath,
				startLine: row.startLine,
				endLine: row.endLine,
				language: row.language,
				reason: row.symbolName ? `Векторное совпадение + символ ${row.symbolName}` : 'Векторная близость по LanceDB',
				snippet: row.content.split(/\r?\n/).slice(0, 20).join('\n'),
				relevance: Number(score.toFixed(4)),
			});
		}

		for (const row of keywordRows) {
			if (filters && !this.applyFilters(row, filters)) continue;
			const key = `${row.relativePath}:${row.startLine}:${row.endLine}`;
			const prev = merged.get(key);
			const keywordBoost = 0.35 + (row.symbolName?.toLowerCase().includes(lowered) ? 0.2 : 0);
			if (prev) {
				prev.relevance = Number(Math.min(1, prev.relevance + keywordBoost).toFixed(4));
				prev.reason = prev.reason.includes('keyword') ? prev.reason : `${prev.reason}; keyword-совпадение`;
				continue;
			}

			merged.set(key, {
				filePath: row.relativePath,
				startLine: row.startLine,
				endLine: row.endLine,
				language: row.language,
				reason: row.symbolName ? `Keyword-совпадение с символом ${row.symbolName}` : 'Keyword-совпадение по содержимому',
				snippet: row.content.split(/\r?\n/).slice(0, 20).join('\n'),
				relevance: Number(Math.min(1, keywordBoost).toFixed(4)),
			});
		}

		return [...merged.values()].sort((a, b) => b.relevance - a.relevance).slice(0, topK);
	}
}
