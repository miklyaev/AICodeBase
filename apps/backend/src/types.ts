export type ProjectStatus = 'idle' | 'indexing' | 'ready' | 'failed';

export interface ProjectRecord {
	id: string;
	name: string;
	rootPath: string;
	status: ProjectStatus;
	createdAt: string;
	updatedAt: string;
	lastIndexedAt: string | null;
}

export interface ChunkRecord {
	id: string;
	projectId: string;
	fileId: string;
	relativePath: string;
	language: string;
	chunkIndex: number;
	startLine: number;
	endLine: number;
	symbolName: string | null;
	content: string;
	embedding: number[];
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

export interface ApiErrorShape {
	code: string;
	message: string;
	details?: unknown;
	requestId: string;
}
