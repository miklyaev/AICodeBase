import { LlmService } from '../llm.service';
import { SettingsService } from '../settings.service';

describe('LlmService', () => {
	const original = { ...process.env };
	const originalFetch = global.fetch;
	let llm: LlmService;
	let request: jest.Mock;
	beforeEach(() => {
		for (const name of ['LLM_BASE_URL', 'LLM_CHAT_MODEL', 'LLM_EMBEDDING_MODEL']) delete process.env[name];
		request = jest.fn();
		global.fetch = request;
		llm = new LlmService({ getApiKeyOrThrow: () => 'synthetic-server-key' } as SettingsService);
	});
	afterEach(() => { process.env = { ...original }; global.fetch = originalFetch; jest.useRealTimers(); });

	it('uses new provider defaults and only the server key', async () => {
		request.mockResolvedValue({ ok: true, json: async () => ({ data: [{ embedding: [1, 2, 3] }] }) });
		expect(await llm.createEmbeddings(['query'])).toEqual([[1, 2, 3]]);
		expect(request).toHaveBeenCalledWith('https://polza.ai/api/v1/embeddings', expect.objectContaining({
			headers: expect.objectContaining({ Authorization: 'Bearer synthetic-server-key' }),
			body: JSON.stringify({ model: 'perplexity/pplx-embed-v1-4b', input: ['query'] }),
		}));
		request.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }] }) });
		await llm.createChatCompletion('context', 'question');
		expect(JSON.parse(request.mock.calls[1][1].body).model).toBe('openai/gpt-4.1');
	});

	it('supports custom OpenAI-compatible endpoint and models', async () => {
		process.env.LLM_BASE_URL = 'https://synthetic.invalid/v1/';
		process.env.LLM_CHAT_MODEL = 'custom-chat';
		process.env.LLM_EMBEDDING_MODEL = 'custom-embed';
		llm = new LlmService({ getApiKeyOrThrow: () => 'server-only' } as SettingsService);
		request.mockResolvedValue({ ok: true, json: async () => ({ data: [{ embedding: [1] }] }) });
		await llm.createEmbeddings(['text']);
		expect(request.mock.calls[0][0]).toBe('https://synthetic.invalid/v1/embeddings');
		expect(JSON.parse(request.mock.calls[0][1].body).model).toBe('custom-embed');
	});

	it('orders embeddings by index and validates all dimensions and numeric values', async () => {
		request.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ index: 1, embedding: [2] }, { index: 0, embedding: [1] }] }) });
		expect(await llm.createEmbeddings(['a', 'b'])).toEqual([[1], [2]]);
		for (const data of [[], [{ embedding: [] }], [{ embedding: [NaN] }], [{ embedding: [1] }, { embedding: [1, 2] }]]) {
			request.mockResolvedValueOnce({ ok: true, json: async () => ({ data }) });
			await expect(llm.createEmbeddings(['a'])).rejects.toThrow();
		}
	});

	it('does not retry permanent failures or expose upstream body', async () => {
		const text = jest.fn(async () => 'private upstream key');
		request.mockResolvedValue({ ok: false, status: 401, text });
		await expect(llm.createEmbeddings(['a'])).rejects.toThrow('Сервис LLM временно недоступен');
		expect(request).toHaveBeenCalledTimes(1);
		expect(text).not.toHaveBeenCalled();
	});

	it.each([400, 401, 413, 422, 429, 503])('retains safe HTTP %i diagnostics without reading upstream bodies', async (status) => {
		jest.useFakeTimers();
		const text = jest.fn(async () => 'synthetic-server-key and private request content');
		request.mockResolvedValue({ ok: false, status, text });
		const result = expect(llm.createEmbeddings(['valid'])).rejects.toMatchObject({
			response: { code: 'LLM_UNAVAILABLE', providerStatus: status },
		});
		await jest.runAllTimersAsync();
		await result;
		expect(request).toHaveBeenCalledTimes(status === 429 || status >= 500 ? 3 : 1);
		expect(text).not.toHaveBeenCalled();
	});

	it.each([[''], [' \r\n\t'], ['valid', '']])('rejects empty elements locally without silently shifting embeddings: %j', async (...values) => {
		await expect(llm.createEmbeddings(values as string[])).rejects.toMatchObject({
			response: { code: 'INVALID_EMBEDDING_INPUT' },
		});
		expect(request).not.toHaveBeenCalled();
	});

	it('bounds transient retries without exposing raw errors', async () => {
		jest.useFakeTimers();
		request.mockRejectedValue(new Error('private upstream key'));
		const result = expect(llm.createEmbeddings(['a'])).rejects.toThrow('Сервис LLM временно недоступен');
		await jest.runAllTimersAsync();
		await result;
		expect(request).toHaveBeenCalledTimes(3);
	});

	it('does not call upstream for empty input or a missing server key', async () => {
		expect(await llm.createEmbeddings([])).toEqual([]);
		llm = new LlmService({ getApiKeyOrThrow: () => { throw new Error('not configured'); } } as unknown as SettingsService);
		await expect(llm.createEmbeddings(['a'])).rejects.toThrow('not configured');
		expect(request).not.toHaveBeenCalled();
	});
});
