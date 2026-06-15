export type IndexStatus = 'idle' | 'indexing' | 'ready' | 'failed';

export interface ProjectInfo {
	id: string;
	name: string;
	path: string;
	status: IndexStatus;
	filesCount: number;
	chunksCount: number;
}

export interface CodeReference {
	filePath: string;
	startLine: number;
	endLine: number;
	language: string;
	reason: string;
	snippet: string;
	relevance: number;
}

export interface ChatResponse {
	answer: string;
	confidence: 'high' | 'medium' | 'low';
	references: CodeReference[];
	conversationId: string;
}
