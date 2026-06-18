import { Injectable } from '@nestjs/common';
import { CodeReference } from '../types';
import { DatabaseService } from './database.service';
import { OpenRouterService } from './openrouter.service';
import { ProjectsService } from './projects.service';
import { LanceDbService } from './lancedb.service';

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
		private readonly openRouterService: OpenRouterService,
		private readonly projectsService: ProjectsService,
		private readonly lanceDbService: LanceDbService,
	) { }

	async search(projectId: string, query: string, topK = 8, apiKey?: string): Promise<CodeReference[]> {
		this.projectsService.getProjectById(projectId);
		const lowered = query.toLowerCase();
		const queryVector = (await this.openRouterService.createEmbeddings([query], apiKey))[0] ?? [];
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
