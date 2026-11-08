import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api';

const fetchMock = vi.fn<typeof fetch>();

function respond(body: unknown, status = 200) {
	fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	}));
}

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('API settings contract', () => {
	it('requests public status without credentials', async () => {
		respond({ hasApiKey: true });
		await expect(api.getSettingsStatus()).resolves.toEqual({ hasApiKey: true });
		expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/settings\/status$/), {
			headers: { 'Content-Type': 'application/json' },
		});
	});

	it('sends administrator credentials only to login and returns session expiry', async () => {
		const session = { token: 'test-admin-token', expiresAt: Date.now() + 3_600_000 };
		respond(session);
		await expect(api.adminLogin('admin', 'test-password')).resolves.toEqual(session);
		expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/settings\/admin\/login$/), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ login: 'admin', password: 'test-password' }),
		});
	});

	it('saves only the new key using an explicit bearer token', async () => {
		respond({ success: true });
		await api.saveApiKey('test-api-key', 'test-admin-token');
		expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/settings\/api-key$/), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-token' },
			body: JSON.stringify({ apiKey: 'test-api-key' }),
		});
	});

	it('loads embedding model and shared index counts using only an explicit bearer token', async () => {
		const status = {
			embeddingModel: 'new-embedding-model', storedEmbeddingModel: 'old-embedding-model',
			requiresReset: true, indexedProjects: 3, indexedChunks: 42,
		};
		respond(status);
		await expect(api.getIndexesStatus('test-admin-token')).resolves.toEqual(status);
		expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/settings\/indexes\/status$/), {
			headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-token' },
		});
	});

	it('accepts legacy unknown index model status without dropping counts', async () => {
		const status = {
			embeddingModel: 'current-model', storedEmbeddingModel: null,
			requiresReset: false, indexedProjects: 1, indexedChunks: 20,
		};
		respond(status);
		await expect(api.getIndexesStatus('test-admin-token')).resolves.toEqual(status);
	});

	it('resets all shared indexes with an explicit confirmation and bearer token only', async () => {
		respond({ success: true });
		await expect(api.resetIndexes('test-admin-token')).resolves.toEqual({ success: true });
		expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/settings\/indexes\/reset$/), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-token' },
			body: JSON.stringify({ confirm: true }),
		});
	});

	it.each([401, 403])('preserves HTTP %s from both index administrator endpoints', async (status) => {
		respond({ message: 'Unauthorized' }, status);
		await expect(api.getIndexesStatus('expired-token')).rejects.toMatchObject({ name: 'ApiError', status });
		respond({ message: 'Unauthorized' }, status);
		await expect(api.resetIndexes('expired-token')).rejects.toMatchObject({ name: 'ApiError', status });
	});

	it('preserves HTTP 409 when reset is blocked by active indexing', async () => {
		respond({ message: 'Indexing in progress' }, 409);
		await expect(api.resetIndexes('test-admin-token')).rejects.toMatchObject({
			name: 'ApiError', status: 409, message: 'Indexing in progress',
		});
	});

	it('revokes the explicit administrator token without putting it into the body', async () => {
		respond({ success: true });
		await api.adminLogout('test-admin-token');
		expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/settings\/admin\/logout$/), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-token' },
		});
	});

	it('does not retain admin credentials for chat, indexing, search or public status', async () => {
		respond({ token: 'test-admin-token', expiresAt: Date.now() + 3_600_000 });
		await api.adminLogin('admin', 'test-password');
		respond({ success: true });
		await api.saveApiKey('test-api-key', 'test-admin-token');
		respond({ success: true });
		await api.resetIndexes('test-admin-token');
		respond({ embeddingModel: 'current', storedEmbeddingModel: null, requiresReset: false, indexedProjects: 0, indexedChunks: 0 });
		await api.getIndexesStatus('test-admin-token');
		fetchMock.mockClear();
		fetchMock.mockImplementation(async () => new Response('{}', { status: 200 }));
		await api.chatMessage('project', 'question', 'conversation');
		await api.startIndexing('project');
		await api.search('project', 'query', { language: 'ts' });
		await api.getSettingsStatus();
		for (const call of fetchMock.mock.calls) {
			const serialized = JSON.stringify(call);
			expect(serialized).not.toContain('test-admin-token');
			expect(serialized).not.toContain('test-password');
			expect(serialized).not.toContain('test-api-key');
			expect(call[1]?.headers).toEqual({ 'Content-Type': 'application/json' });
		}
	});

	it.each([401, 403])('preserves HTTP %s to let the UI clear an expired/revoked session', async (status) => {
		respond({ message: 'Unauthorized' }, status);
		await expect(api.saveApiKey('test-api-key', 'expired-token')).rejects.toMatchObject({
			name: 'ApiError', status, message: 'Unauthorized',
		});
	});

	it('reports non-JSON server errors without masking their HTTP status', async () => {
		fetchMock.mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));
		await expect(api.getSettingsStatus()).rejects.toEqual(new ApiError('Ошибка запроса', 503));
	});
});
