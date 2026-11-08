import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import fs from 'node:fs';
import { FileSnippetQueryDto } from '../dto/files.dto';
import { ProjectsService } from '../services/projects.service';
import { safeResolveInsideRoot } from '../utils/path';
import { isSecretFile } from '../utils/file-rules';

@Controller('/api/files')
export class FilesController {
	constructor(private readonly projectsService: ProjectsService) { }

	@Get('/snippet')
	snippet(@Query() query: FileSnippetQueryDto) {
		const project = this.projectsService.getProjectById(query.projectId);
		const absolutePath = safeResolveInsideRoot(project.rootPath, query.filePath);
		if (isSecretFile(query.filePath) || isSecretFile(absolutePath)) {
			throw new ForbiddenException({ code: 'FILE_FORBIDDEN', message: 'Этот файл недоступен' });
		}
		const content = fs.readFileSync(absolutePath, 'utf-8');
		const lines = content.split(/\r?\n/);
		const context = query.context ?? 5;
		const start = Math.max(1, query.startLine - context);
		const end = Math.min(lines.length, query.endLine + context);

		return {
			filePath: query.filePath,
			startLine: start,
			endLine: end,
			content: lines.slice(start - 1, end).join('\n'),
		};
	}
}
