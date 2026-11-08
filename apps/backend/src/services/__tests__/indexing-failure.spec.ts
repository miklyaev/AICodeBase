import { ConflictException } from '@nestjs/common';
import { IndexingService } from '../indexing.service';
import { ProjectsController } from '../../controllers/projects.controller';

jest.mock('@lancedb/lancedb', () => ({ connect: jest.fn() }));
jest.mock('better-sqlite3', () => jest.fn());

describe('background indexing failures', () => {
	it('reports incompatible dimensions without exposing raw failure details', () => {
		const projects = { setProjectStatus: jest.fn() };
		const events = { emit: jest.fn() };
		const service = new IndexingService({} as any, projects as any, {} as any, events as any, {} as any, {} as any);
		service.markFailed('project', new ConflictException({ code: 'INDEX_REBUILD_REQUIRED', message: 'private raw information' }));
		expect(projects.setProjectStatus).toHaveBeenCalledWith('project', 'failed');
		expect(service.getProgress('project').message).toContain('всех проектов');
		expect(JSON.stringify(events.emit.mock.calls)).not.toContain('private raw information');
	});

	it('sanitizes unknown upstream/filesystem failures', () => {
		const events = { emit: jest.fn() };
		const service = new IndexingService({} as any, { setProjectStatus: jest.fn() } as any, {} as any, events as any, {} as any, {} as any);
		service.markFailed('project', new Error('secret key and raw disk contents'));
		expect(JSON.stringify(events.emit.mock.calls)).not.toContain('secret key');
		expect(service.getProgress('project').message).toContain('Проверьте настройки');
	});

	it('returns zero idle progress after reset instead of a cached completed run', () => {
		const projects = {
			getProjectById: jest.fn(() => ({ status: 'idle' })),
			getProjectStats: jest.fn(() => ({ filesCount: 0, chunksCount: 0 })),
		};
		const indexing = { getProgress: jest.fn(() => ({ indexedFiles: 12, totalFiles: 12, message: 'Индексация завершена' })) };
		const controller = new ProjectsController(projects as any, indexing as any, {} as any);
		expect(controller.getStatus('project')).toEqual({
			projectId: 'project', status: 'idle', filesCount: 0, chunksCount: 0,
			indexedFiles: 0, totalFiles: 0, message: 'Требуется индексация',
		});
		expect(indexing.getProgress).not.toHaveBeenCalled();
		projects.getProjectById.mockReturnValue({ status: 'ready' });
		expect(controller.getStatus('project')).toMatchObject({ indexedFiles: 12, totalFiles: 12, message: 'Индексация завершена' });
	});

	it('awaits indexing preflight so conflicts reach the HTTP caller', async () => {
		const failure = new ConflictException({ code: 'INDEX_REBUILD_REQUIRED' });
		const indexing = { startIndexing: jest.fn().mockRejectedValue(failure) };
		const projects = { getProjectById: jest.fn() };
		const controller = new ProjectsController(projects as any, indexing as any, {} as any);
		await expect(controller.indexProject({ projectId: 'project' })).rejects.toBe(failure);
		expect(projects.getProjectById).toHaveBeenCalledWith('project');
	});
});
