import { ChatResponse, CodeReference, ProjectInfo, ProjectStatus } from './types';

// Normalize VITE_API_BASE_URL: remove surrounding quotes if present, fallback to empty string
function normalizeEnvUrl(value: unknown): string {
	if (typeof value !== 'string' || !value) return '';
	return value.replace(/^\s*['"](.*)['"]\s*$/, '$1');
}

const API_ORIGIN = normalizeEnvUrl(import.meta.env.VITE_API_BASE_URL) ?? '';

export function getApiUrl(path: string) {
	return `${API_ORIGIN}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(getApiUrl(path), {
		headers: { 'Content-Type': 'application/json' },
		...init,
	});

	if (!response.ok) {
		const error = await response.json().catch(() => ({}));
		throw new Error(error.message ?? 'Ошибка запроса');
	}

	return response.json() as Promise<T>;
}

export const api = {
	getSettingsStatus: () => request<{ hasOpenRouterKey: boolean }>('/api/settings/status'),
	setOpenRouterKey: (apiKey: string) =>
		request<{ success: boolean }>('/api/settings/openrouter-key', {
			method: 'POST',
			body: JSON.stringify({
				apiKey: typeof apiKey === 'object' ? (apiKey as any).apiKey : apiKey,
				remember: false,
			}),
		}), pickProjectFolder: () =>
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
	search: (projectId: string, query: string) =>
		request<CodeReference[]>(`/api/search?projectId=${encodeURIComponent(projectId)}&query=${encodeURIComponent(query)}`),
	snippet: (projectId: string, filePath: string, startLine: number, endLine: number) =>
		request<{ content: string; startLine: number; endLine: number; filePath: string }>(
			`/api/files/snippet?projectId=${encodeURIComponent(projectId)}&filePath=${encodeURIComponent(filePath)}&startLine=${startLine}&endLine=${endLine}`,
		),
};
