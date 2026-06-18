import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SettingsService } from './settings.service';

@Injectable()
export class OpenRouterService {
	private readonly baseUrl = 'https://openrouter.ai/api/v1';
	private readonly chatModel = process.env.OPENROUTER_CHAT_MODEL ?? 'gpt-5.3-codex';
	private readonly embeddingModel = process.env.OPENROUTER_EMBED_MODEL ?? 'openai/text-embedding-3-small';

	constructor(private readonly settingsService: SettingsService) { }

	private async request<T>(endpoint: string, body: unknown, apiKey?: string, timeoutMs = 30_000): Promise<T> {
		const key = apiKey || this.settingsService.getOpenRouterKeyOrThrow();
		let lastError: unknown;

		for (let attempt = 0; attempt < 3; attempt += 1) {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);

			try {
				const response = await fetch(`${this.baseUrl}${endpoint}`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${key}`,
					},
					body: JSON.stringify(body),
					signal: controller.signal,
				});
				if (response.ok) {
					return (await response.json()) as T;
				}

				if (response.status >= 500 || response.status === 429) {
					lastError = await response.text();
					console.error(`[OpenRouter] Attempt ${attempt + 1} failed (${response.status}): ${lastError}`);
					await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
					continue;
				}

				const errorText = await response.text();
				console.error(`[OpenRouter] Request failed (${response.status}): ${errorText}`);
				throw new ServiceUnavailableException({
					code: 'OPENROUTER_REQUEST_FAILED',
					message: 'Ошибка OpenRouter',
					details: errorText,
				});
			} catch (error) {
				lastError = error;
				console.error(`[OpenRouter] Network/Timeout error:`, error);
				await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
			} finally {
				clearTimeout(timer);
			}
		}

		throw new ServiceUnavailableException({
			code: 'OPENROUTER_UNAVAILABLE',
			message: 'Не удалось выполнить запрос к OpenRouter',
			details: String(lastError),
		});
	}

	async createEmbeddings(inputs: string[], apiKey?: string) {
		if (!inputs || inputs.length === 0) {
			return [];
		}

		const payload = {
			model: this.embeddingModel,
			input: inputs,
		};

		const result = await this.request<{ data?: Array<{ embedding: number[] }> }>('/embeddings', payload, apiKey);

		if (!result?.data || !Array.isArray(result.data)) {
			return [];
		}

		return result.data.map((item) => {
			if (!item?.embedding || !Array.isArray(item.embedding)) {
				return [];
			}
			return item.embedding;
		});
	}

	async createChatCompletion(context: string, message: string, apiKey?: string) {
		const systemPrompt =
			'Ты агент поиска по коду. Используй только предоставленный контекст. Не выдумывай файлы или строки. Если уверенность низкая, явно укажи это.';

		const payload = {
			model: this.chatModel,
			response_format: { type: 'json_object' },
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: `Контекст:\n${context}\n\nЗапрос: ${message}\nВерни JSON с полями answer, confidence, references` },
			],
		};

		const result = await this.request<{ choices: Array<{ message: { content: string } }> }>('/chat/completions', payload, apiKey, 45_000);
		return result.choices[0]?.message?.content ?? '';
	}
}
