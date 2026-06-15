import { BadRequestException, Injectable } from '@nestjs/common';

@Injectable()
export class SettingsService {
	private openRouterKey: string | null = null;

	setOpenRouterKey(key: string) {
		const normalized = key.trim();
		if (normalized.length < 20) {
			throw new BadRequestException({ code: 'INVALID_KEY_FORMAT', message: 'Некорректный формат API key' });
		}
		this.openRouterKey = normalized;
	}

	clearOpenRouterKey() {
		this.openRouterKey = null;
	}

	hasOpenRouterKey() {
		return Boolean(this.openRouterKey);
	}

	getOpenRouterKeyOrThrow() {
		if (!this.openRouterKey) {
			throw new BadRequestException({ code: 'OPENROUTER_KEY_MISSING', message: 'Сначала укажите OpenRouter API key' });
		}
		return this.openRouterKey;
	}
}
