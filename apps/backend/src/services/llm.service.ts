import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SettingsService } from './settings.service';

@Injectable()
export class LlmService {
	private readonly baseUrl = (process.env.LLM_BASE_URL?.trim() || 'https://polza.ai/api/v1').replace(/\/+$/, '');
	private readonly chatModel = process.env.LLM_CHAT_MODEL?.trim() || 'openai/gpt-4.1';
	private readonly embeddingModel = process.env.LLM_EMBEDDING_MODEL?.trim() || 'perplexity/pplx-embed-v1-4b';

	constructor(private readonly settingsService: SettingsService) { }

	getEmbeddingFingerprint() {
		return { baseUrl: this.baseUrl, embeddingModel: this.embeddingModel };
	}

	private unavailable(providerStatus?: number, code = 'LLM_UNAVAILABLE') {
		return new ServiceUnavailableException({
			code, message: 'Сервис LLM временно недоступен',
			...(providerStatus ? { providerStatus } : {}),
		});
	}

	private async request<T>(endpoint: string, body: unknown, timeoutMs = 30_000): Promise<T> {
		const key = this.settingsService.getApiKeyOrThrow();
		let providerStatus: number | undefined;
		for (let attempt = 0; attempt < 3; attempt += 1) {
			providerStatus = undefined;
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			let retry = true;
			try {
				const response = await fetch(`${this.baseUrl}${endpoint}`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
					body: JSON.stringify(body),
					signal: controller.signal,
				});
				if (response.ok) return await response.json() as T;
				providerStatus = response.status;
				retry = response.status >= 500 || response.status === 429;
				await response.body?.cancel();
			} catch {
				// Never log or return upstream bodies, credentials or network error details.
			} finally {
				clearTimeout(timer);
			}
			if (!retry || attempt === 2) break;
			await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
		}
		throw this.unavailable(providerStatus);
	}

	async createEmbeddings(inputs: string[]): Promise<number[][]> {
		if (!inputs.length) return [];
		if (inputs.some((input) => typeof input !== 'string' || !input.trim())) {
			throw new BadRequestException({ code: 'INVALID_EMBEDDING_INPUT', message: 'Текст для embeddings не должен быть пустым' });
		}
		const result = await this.request<{ data?: Array<{ index?: number; embedding: number[] }> }>('/embeddings', {
			model: this.embeddingModel,
			input: inputs,
		});
		if (!Array.isArray(result?.data) || result.data.length !== inputs.length
			|| result.data.some((item) => !item || typeof item !== 'object')) {
			throw this.unavailable(undefined, 'LLM_INVALID_RESPONSE');
		}
		const data = [...result.data];
		if (data.every((item) => Number.isInteger(item.index))) {
			data.sort((a, b) => a.index! - b.index!);
			if (data.some((item, index) => item.index !== index)) throw this.unavailable(undefined, 'LLM_INVALID_RESPONSE');
		}
		const dimension = data[0]?.embedding?.length;
		if (!dimension || data.some((item) => !Array.isArray(item.embedding) || item.embedding.length !== dimension || item.embedding.some((value) => !Number.isFinite(value)))) {
			throw this.unavailable(undefined, 'LLM_INVALID_RESPONSE');
		}
		return data.map((item) => item.embedding);
	}

	async createChatCompletion(context: string, message: string) {
		const result = await this.request<{ choices?: Array<{ message?: { content?: string } }> }>('/chat/completions', {
			model: this.chatModel,
			response_format: { type: 'json_object' },
			messages: [
				{ role: 'system', content: 'Ты агент поиска по коду. Используй только предоставленный контекст. Не выдумывай файлы или строки. Если уверенность низкая, явно укажи это.' },
				{ role: 'user', content: `Контекст:\n${context}\n\nЗапрос: ${message}\nВерни JSON с полями answer, confidence, references` },
			],
		}, 45_000);
		const content = result?.choices?.[0]?.message?.content;
		if (typeof content !== 'string') throw this.unavailable();
		return content;
	}
}
