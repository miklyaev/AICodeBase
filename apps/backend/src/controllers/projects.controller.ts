import { Body, Controller, Get, Param, Post, Query, Sse } from '@nestjs/common';
import { map } from 'rxjs/operators';
import { SelectProjectDto, IndexProjectDto } from '../dto/projects.dto';
import { ProjectsService } from '../services/projects.service';
import { IndexingProgress, IndexingService } from '../services/indexing.service';
import { ProgressEventsService } from '../services/progress-events.service';

@Controller('/api/projects')
export class ProjectsController {
	constructor(
		private readonly projectsService: ProjectsService,
		private readonly indexingService: IndexingService,
		private readonly progressEvents: ProgressEventsService,
	) { }

	@Post('/pick-folder')
	pickFolder() {
		return { path: this.projectsService.pickProjectFolderViaDialog() };
	}

	@Post('/select')
	selectProject(@Body() dto: SelectProjectDto) {
		return this.projectsService.selectProject(dto.path);
	}

	@Post('/index')
	async indexProject(
		@Body() dto: IndexProjectDto,
	) {
		this.projectsService.getProjectById(dto.projectId);
		return this.indexingService.startIndexing(dto.projectId);
	} @Post('/clear-index')
	async clearIndex(@Body() dto: IndexProjectDto) {
		await this.projectsService.clearProjectIndex(dto.projectId);
		return { success: true };
	}

	@Get('/:projectId/status')
	getStatus(@Param('projectId') projectId: string) {
		const project = this.projectsService.getProjectById(projectId);
		const stats = this.projectsService.getProjectStats(projectId);
		const progress: IndexingProgress = project.status === 'idle'
			? { indexedFiles: 0, totalFiles: 0, message: 'Требуется индексация' }
			: this.indexingService.getProgress(projectId);

		return {
			projectId,
			status: project.status,
			filesCount: stats.filesCount,
			chunksCount: stats.chunksCount,
			indexedFiles: progress.indexedFiles,
			totalFiles: progress.totalFiles,
			message: progress.message,
			...(progress.failure ? { failure: progress.failure } : {}),
			...(progress.failedFiles ? { failedFiles: progress.failedFiles } : {}),
		};
	}

	@Sse('/events')
	stream(@Query('projectId') projectId: string) {
		return this.progressEvents.stream(projectId).pipe(
			map((payload) => ({
				type: payload.event,
				data: payload.data,
			})),
		);
	}
}
