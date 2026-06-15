import { IsOptional, IsString, MinLength } from 'class-validator';

export class SelectProjectDto {
	@IsString()
	@MinLength(1)
	path!: string;
}

export class IndexProjectDto {
	@IsString()
	@MinLength(1)
	projectId!: string;
}

export class ClearProjectIndexDto {
	@IsString()
	@MinLength(1)
	projectId!: string;
}

export interface ProjectStatusResponse {
	projectId: string;
	status: 'idle' | 'indexing' | 'ready' | 'failed';
	filesCount: number;
	chunksCount: number;
	indexedFiles: number;
	totalFiles: number;
	message?: string;
}
