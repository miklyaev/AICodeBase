import { Equals, IsBoolean, IsString, Length, Matches } from 'class-validator';

export class SetApiKeyDto {
	@IsString()
	@Length(20, 4096)
	@Matches(/^[A-Za-z0-9._~+\/-]+={0,2}$/)
	apiKey!: string;
}

export class AdminLoginDto {
	@IsString()
	@Length(1, 128)
	login!: string;

	@IsString()
	@Length(1, 1024)
	password!: string;
}

export class ResetIndexesDto {
	@IsBoolean()
	@Equals(true)
	confirm!: boolean;
}

export interface SettingsStatusResponse {
	hasApiKey: boolean;
}
