import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { persistApiKey } from '../config/environment';

@Injectable()
export class SettingsService {
	private apiKey: string | null = process.env.LLM_API_KEY?.trim() || null;

	setApiKey(key: string) {
		const normalized = key.trim();
		if (!/^[A-Za-z0-9._~+\/-]{20,4096}={0,2}$/.test(normalized) || normalized.length > 4096) {
			throw new BadRequestException({ code: 'INVALID_KEY_FORMAT', message: 'Некорректный формат API key' });
		}
		try {
			persistApiKey(normalized);
		} catch {
			throw new ServiceUnavailableException({ code: 'SETTINGS_SAVE_FAILED', message: 'Не удалось сохранить настройки сервера' });
		}
		this.apiKey = normalized;
		process.env.LLM_API_KEY = normalized;
	}

	hasApiKey() {
		return Boolean(this.apiKey);
	}

	getApiKeyOrThrow() {
		if (!this.apiKey) {
			throw new BadRequestException({ code: 'LLM_KEY_MISSING', message: 'API key не настроен. Обратитесь к администратору.' });
		}
		return this.apiKey;
	}
}
