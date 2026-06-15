import { IsOptional, IsString, MinLength } from 'class-validator';

export class ChatMessageDto {
	@IsString()
	@MinLength(1)
	projectId!: string;

	@IsString()
	@MinLength(1)
	message!: string;

	@IsOptional()
	@IsString()
	conversationId?: string;
}
