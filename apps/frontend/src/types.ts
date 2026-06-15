export interface ProjectInfo {
	id: string;
	name: string;
	path: string;
	status: 'idle' | 'indexing' | 'ready' | 'failed';
	filesCount: number;
	chunksCount: number;
}

export interface ProjectStatus {
	projectId: string;
	status: 'idle' | 'indexing' | 'ready' | 'failed';
	filesCount: number;
	chunksCount: number;
	indexedFiles: number;
	totalFiles: number;
	message?: string;
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
