import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class FileSnippetQueryDto {
	@IsString()
	projectId!: string;

	@IsString()
	filePath!: string;

	@Type(() => Number)
	@IsInt()
	@Min(1)
	startLine!: number;

	@Type(() => Number)
	@IsInt()
	@Min(1)
	endLine!: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	context?: number;
}
