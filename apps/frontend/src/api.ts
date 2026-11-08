import { ChatResponse, CodeReference, ProjectInfo, ProjectStatus, SearchFilters } from './types';

// Normalize VITE_API_BASE_URL: remove surrounding quotes if present, fallback to empty string
function normalizeEnvUrl(value: unknown): string {
	if (typeof value !== 'string' || !value) return '';
	return value.replace(/^\s*['"](.*)['"]\s*$/, '$1');
}

const API_ORIGIN = normalizeEnvUrl(import.meta.env.VITE_API_BASE_URL) ?? '';

export function getApiUrl(path: string) {
	return `${API_ORIGIN}${path}`;
}

export class ApiError extends Error {
	constructor(message: string, public readonly status: number) {
		super(message);
		this.name = 'ApiError';
	}
}

export interface AdminSession {
	token: string;
	expiresAt: number;
}

export interface IndexesStatus {
	embeddingModel: string;
	storedEmbeddingModel: string | null;
	requiresReset: boolean;
	indexedProjects: number;
	indexedChunks: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(getApiUrl(path), {
		...init,
		headers: { 'Content-Type': 'application/json', ...init?.headers },
	});

	if (!response.ok) {
		const error = await response.json().catch(() => ({}));
		throw new ApiError(error.message ?? 'Ошибка запроса', response.status);
	}

	return response.json() as Promise<T>;
}

export const api = {
	getSettingsStatus: () => request<{ hasApiKey: boolean }>('/api/settings/status'),
	adminLogin: (login: string, password: string) =>
		request<AdminSession>('/api/settings/admin/login', {
			method: 'POST',
			body: JSON.stringify({ login, password }),
		}),
	adminLogout: (token: string) =>
		request<{ success: boolean }>('/api/settings/admin/logout', {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
		}),
	saveApiKey: (apiKey: string, token: string) =>
		request<{ success: boolean }>('/api/settings/api-key', {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ apiKey }),
		}),
	getIndexesStatus: (token: string) =>
		request<IndexesStatus>('/api/settings/indexes/status', {
			headers: { Authorization: `Bearer ${token}` },
		}),
	resetIndexes: (token: string) =>
		request<{ success: true }>('/api/settings/indexes/reset', {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ confirm: true }),
		}),
	pickProjectFolder: () =>
		request<{ path: string | null }>('/api/projects/pick-folder', {
			method: 'POST',
		}),
	selectProject: (path: string) =>
		request<ProjectInfo>('/api/projects/select', {
			method: 'POST',
			body: JSON.stringify({ path }),
		}),
	startIndexing: (projectId: string) =>
		request<{ started: boolean }>('/api/projects/index', {
			method: 'POST',
			body: JSON.stringify({ projectId }),
		}),
	clearIndex: (projectId: string) =>
		request<{ success: boolean }>('/api/projects/clear-index', {
			method: 'POST',
			body: JSON.stringify({ projectId }),
		}),
	getProjectStatus: (projectId: string) => request<ProjectStatus>(`/api/projects/${projectId}/status`),
	chatMessage: (projectId: string, message: string, conversationId?: string) =>
		request<ChatResponse>('/api/chat/message', {
			method: 'POST',
			body: JSON.stringify({ projectId, message, conversationId }),
		}),
	search: (projectId: string, query: string, filters?: SearchFilters) => {
		const params = new URLSearchParams({ projectId, query });
		if (filters?.language) params.set('language', filters.language);
		if (filters?.fileExtension) params.set('fileExtension', filters.fileExtension);
		if (filters?.directory) params.set('directory', filters.directory);
		return request<CodeReference[]>(`/api/search?${params.toString()}`);
	},
	snippet: (projectId: string, filePath: string, startLine: number, endLine: number) =>
		request<{ content: string; startLine: number; endLine: number; filePath: string }>(
			`/api/files/snippet?projectId=${encodeURIComponent(projectId)}&filePath=${encodeURIComponent(filePath)}&startLine=${startLine}&endLine=${endLine}`,
		),
};
