import { Body, Controller, Get, Post } from '@nestjs/common';
import { SetOpenRouterKeyDto } from '../dto/settings.dto';
import { SettingsService } from '../services/settings.service';

@Controller('/api/settings')
export class SettingsController {
	constructor(private readonly settingsService: SettingsService) { }

	@Post('/openrouter-key')
	setOpenRouterKey(@Body() dto: SetOpenRouterKeyDto) {
		this.settingsService.setOpenRouterKey(dto.apiKey);
		return { success: true };
	}

	@Get('/status')
	getStatus() {
		return {
			hasOpenRouterKey: this.settingsService.hasOpenRouterKey(),
		};
	}
}
