import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class SetOpenRouterKeyDto {
	@IsString()
	@MinLength(20)
	apiKey!: string;

	@IsOptional()
	@IsBoolean()
	remember?: boolean;
}

export interface SettingsStatusResponse {
	hasOpenRouterKey: boolean;
}
