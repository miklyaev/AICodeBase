import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SettingsController } from './controllers/settings.controller';
import { ProjectsController } from './controllers/projects.controller';
import { SearchController } from './controllers/search.controller';
import { ChatController } from './controllers/chat.controller';
import { FilesController } from './controllers/files.controller';
import { DatabaseService } from './services/database.service';
import { SettingsService } from './services/settings.service';
import { OpenRouterService } from './services/openrouter.service';
import { ProjectsService } from './services/projects.service';
import { IndexingService } from './services/indexing.service';
import { SearchService } from './services/search.service';
import { ChatService } from './services/chat.service';
import { ProgressEventsService } from './services/progress-events.service';
import { LanceDbService } from './services/lancedb.service';

@Module({
	imports: [EventEmitterModule.forRoot()],
	controllers: [SettingsController, ProjectsController, SearchController, ChatController, FilesController],
	providers: [
		DatabaseService,
		SettingsService,
		OpenRouterService,
		ProjectsService,
		IndexingService,
		SearchService,
		ChatService,
		ProgressEventsService,
		LanceDbService,
	],
})
export class AppModule { }
