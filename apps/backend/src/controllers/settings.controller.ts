import { Body, Controller, Get, Headers, Optional, Post, Req } from '@nestjs/common';
import { IndexLifecycleService } from '../services/index-lifecycle.service';
import { Request } from 'express';
import { AdminLoginDto, ResetIndexesDto, SetApiKeyDto } from '../dto/settings.dto';
import { SettingsService } from '../services/settings.service';
import { AdminAuthService } from '../services/admin-auth.service';

@Controller('/api/settings')
export class SettingsController {
	constructor(
		private readonly settingsService: SettingsService,
		private readonly adminAuthService: AdminAuthService,
		@Optional() private readonly lifecycle?: IndexLifecycleService,
	) { }

	@Get('/indexes/status')
	getIndexesStatus(@Headers('authorization') authorization?: string) {
		this.adminAuthService.authorize(authorization);
		return this.lifecycle!.getStatus();
	}

	@Post('/indexes/reset')
	resetIndexes(@Body() _dto: ResetIndexesDto, @Headers('authorization') authorization?: string) {
		this.adminAuthService.authorize(authorization);
		return this.lifecycle!.reset();
	}

	@Get('/status')
	getStatus() {
		return { hasApiKey: this.settingsService.hasApiKey() };
	}

	@Post('/admin/login')
	login(@Body() dto: AdminLoginDto, @Req() request: Request) {
		return this.adminAuthService.login(dto.login, dto.password, request.ip ?? request.socket.remoteAddress ?? 'unknown');
	}

	@Post('/admin/logout')
	logout(@Headers('authorization') authorization?: string) {
		this.adminAuthService.logout(authorization);
		return { success: true };
	}

	@Post('/api-key')
	setApiKey(@Body() dto: SetApiKeyDto, @Headers('authorization') authorization?: string) {
		this.adminAuthService.authorize(authorization);
		this.settingsService.setApiKey(dto.apiKey);
		return { success: true };
	}
}
