import { Body, Controller, Post } from '@nestjs/common';
import { ChatMessageDto } from '../dto/chat.dto';
import { ChatService } from '../services/chat.service';

@Controller('/api/chat')
export class ChatController {
	constructor(private readonly chatService: ChatService) { }

	@Post('/message')
	message(@Body() dto: ChatMessageDto) {
		return this.chatService.sendMessage(dto.projectId, dto.message, dto.conversationId);
	}
}
