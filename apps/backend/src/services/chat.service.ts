import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { OpenRouterService } from './openrouter.service';
import { SearchService } from './search.service';
import { ProjectsService } from './projects.service';
import { makeId } from '../utils/id';
import { ChatResponse } from '../types';

@Injectable()
export class ChatService {
	constructor(
		private readonly db: DatabaseService,
		private readonly searchService: SearchService,
		private readonly openRouterService: OpenRouterService,
		private readonly projectsService: ProjectsService,
	) { }

	async sendMessage(projectId: string, message: string, conversationId?: string, apiKey?: string): Promise<ChatResponse> {
		const project = this.projectsService.getProjectById(projectId);
		if (project.status !== 'ready' && project.status !== 'indexing') {
			throw new BadRequestException({
				code: 'PROJECT_NOT_INDEXED',
				message: 'Индекс проекта еще не готов. Сначала запустите индексацию.',
			});
		}

		const references = await this.searchService.search(projectId, message, 8, apiKey); const actualConversationId = this.ensureConversation(projectId, conversationId);

		this.db.run(
			'INSERT INTO messages (id, conversationId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)',
			[makeId(), actualConversationId, 'user', message, new Date().toISOString()],
		);

		const context = references
			.map((reference, index) => {
				return `#${index + 1} ${reference.filePath}:${reference.startLine}-${reference.endLine}\n${reference.snippet}`;
			})
			.join('\n\n');

		let answer = 'Нашел потенциально релевантные места в коде.';
		let confidence: 'high' | 'medium' | 'low' = references.length >= 3 ? 'high' : references.length > 0 ? 'medium' : 'low';

		try {
			const raw = await this.openRouterService.createChatCompletion(context, message, apiKey);
			const parsed = JSON.parse(raw) as Partial<ChatResponse>; if (parsed.answer && typeof parsed.answer === 'string') answer = parsed.answer;
			if (parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low') {
				confidence = parsed.confidence;
			}
		} catch {
			// fallback to deterministic answer
		}

		const response: ChatResponse = {
			answer,
			confidence,
			references,
			conversationId: actualConversationId,
		};

		this.db.run(
			'INSERT INTO messages (id, conversationId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)',
			[makeId(), actualConversationId, 'assistant', JSON.stringify(response), new Date().toISOString()],
		);

		return response;
	}

	private ensureConversation(projectId: string, conversationId?: string) {
		if (conversationId) {
			const exists = this.db.get<{ id: string }>('SELECT id FROM conversations WHERE id = ?', [conversationId]);
			if (exists) {
				this.db.run('UPDATE conversations SET updatedAt = ? WHERE id = ?', [new Date().toISOString(), conversationId]);
				return conversationId;
			}
		}

		const id = makeId();
		const now = new Date().toISOString();
		this.db.run('INSERT INTO conversations (id, projectId, createdAt, updatedAt) VALUES (?, ?, ?, ?)', [id, projectId, now, now]);
		return id;
	}
}
