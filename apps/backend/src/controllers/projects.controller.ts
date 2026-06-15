import { Body, Controller, Get, Param, Post, Query, Sse } from '@nestjs/common';
import { map } from 'rxjs/operators';
import { SelectProjectDto, IndexProjectDto } from '../dto/projects.dto';
import { ProjectsService } from '../services/projects.service';
import { IndexingService } from '../services/indexing.service';
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
	async indexProject(@Body() dto: IndexProjectDto) {
		void this.indexingService.indexProject(dto.projectId);
		return { started: true };
	}

	@Post('/clear-index')
	async clearIndex(@Body() dto: IndexProjectDto) {
		await this.projectsService.clearProjectIndex(dto.projectId);
		return { success: true };
	}

	@Get('/:projectId/status')
	getStatus(@Param('projectId') projectId: string) {
		const project = this.projectsService.getProjectById(projectId);
		const stats = this.projectsService.getProjectStats(projectId);
		const progress = this.indexingService.getProgress(projectId);

		return {
			projectId,
			status: project.status,
			filesCount: stats.filesCount,
			chunksCount: stats.chunksCount,
			indexedFiles: progress.indexedFiles,
			totalFiles: progress.totalFiles,
			message: progress.message,
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
