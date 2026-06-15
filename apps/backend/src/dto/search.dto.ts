import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class SearchQueryDto {
	@IsString()
	@MinLength(1)
	projectId!: string;

	@IsString()
	@MinLength(1)
	query!: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(30)
	topK?: number;
}
