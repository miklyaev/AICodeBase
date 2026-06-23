import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseService } from './database.service';
import { LanceDbService } from './lancedb.service';
import { ensureDirectoryExists } from '../utils/path';
import { makeId } from '../utils/id';
import { ProjectRecord, ProjectStatus } from '../types';

@Injectable()
export class ProjectsService {
	constructor(
		private readonly db: DatabaseService,
		private readonly lanceDbService: LanceDbService,
	) { }

	selectProject(rawPath: string) {
		const rootPath = ensureDirectoryExists(rawPath);
		const existing = this.db.get<ProjectRecord>('SELECT * FROM projects WHERE rootPath = ?', [rootPath]);

		if (existing) {
			return this.toProjectInfo(existing);
		}

		const now = new Date().toISOString();
		const id = makeId();
		const name = path.basename(rootPath);

		this.db.run(
			`INSERT INTO projects (id, name, rootPath, status, createdAt, updatedAt, lastIndexedAt)
       VALUES (?, ?, ?, 'idle', ?, ?, NULL)`,
			[id, name, rootPath, now, now],
		);

		const created = this.getProjectById(id);
		return this.toProjectInfo(created);
	}

	getProjectById(projectId: string): ProjectRecord {
		const project = this.db.get<ProjectRecord>('SELECT * FROM projects WHERE id = ?', [projectId]);
		if (!project) {
			throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: 'Проект не найден' });
		}

		return project;
	}

	setProjectStatus(projectId: string, status: ProjectStatus) {
		const now = new Date().toISOString();
		this.db.run('UPDATE projects SET status = ?, updatedAt = ? WHERE id = ?', [status, now, projectId]);
	}

	setProjectIndexed(projectId: string) {
		const now = new Date().toISOString();
		this.db.run('UPDATE projects SET status = ?, updatedAt = ?, lastIndexedAt = ? WHERE id = ?', ['ready', now, now, projectId]);
	}

	getProjectStats(projectId: string) {
		const filesRow = this.db.get<{ count: number }>('SELECT COUNT(*) as count FROM files WHERE projectId = ?', [projectId]);
		const chunksRow = this.db.get<{ count: number }>('SELECT COUNT(*) as count FROM chunks WHERE projectId = ?', [projectId]);

		return {
			filesCount: filesRow?.count ?? 0,
			chunksCount: chunksRow?.count ?? 0,
		};
	}

	async clearProjectIndex(projectId: string) {
		this.getProjectById(projectId);
		this.db.transaction(() => {
			this.db.run('DELETE FROM chunks WHERE projectId = ?', [projectId]);
			this.db.run('DELETE FROM files WHERE projectId = ?', [projectId]);
			this.db.run('UPDATE projects SET status = ?, updatedAt = ?, lastIndexedAt = NULL WHERE id = ?', [
				'idle',
				new Date().toISOString(),
				projectId,
			]);
		});
		await this.lanceDbService.clearProject(projectId);
	}

	pickProjectFolderViaDialog(): string | null {
		// В Docker-контейнере (Linux) системный диалог Windows недоступен.
		// Если бэкенд запущен не на Windows, возвращаем null, чтобы фронтенд показал поле ввода.
		if (process.platform !== 'win32') {
			return null;
		}
		const script = [
			"Add-Type -AssemblyName System.Windows.Forms",
			"$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
			"$dialog.Description = 'Выберите папку проекта'",
			"$dialog.ShowNewFolderButton = $false",
			"if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }",
		].join('; ');

		try {
			const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
				encoding: 'utf-8',
				stdio: ['ignore', 'pipe', 'ignore'],
			}).trim();
			return output || null;
		} catch {
			throw new BadRequestException({
				code: 'FOLDER_PICKER_FAILED',
				message: 'Не удалось открыть системный диалог выбора папки',
			});
		}
	}

	toProjectInfo(project: ProjectRecord) {
		const stats = this.getProjectStats(project.id);
		return {
			id: project.id,
			name: project.name,
			path: project.rootPath,
			status: project.status,
			filesCount: stats.filesCount,
			chunksCount: stats.chunksCount,
		};
	}
}
