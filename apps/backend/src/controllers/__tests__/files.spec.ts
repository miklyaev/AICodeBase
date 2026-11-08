import fs from 'node:fs';
import path from 'node:path';
import { FilesController } from '../files.controller';
import { ProjectsService } from '../../services/projects.service';

const root = path.resolve('synthetic-project');
const query = { projectId: 'test', filePath: '', startLine: 1, endLine: 1 };

describe('file snippet secret and canonical containment', () => {
	let controller: FilesController;
	beforeEach(() => {
		controller = new FilesController({ getProjectById: () => ({ rootPath: root }) } as unknown as ProjectsService);
		jest.spyOn(fs, 'existsSync').mockReturnValue(true);
		jest.spyOn(fs, 'realpathSync').mockImplementation((target) => String(target));
		jest.spyOn(fs, 'readFileSync').mockReturnValue('synthetic source');
	});
	afterEach(() => jest.restoreAllMocks());

	it.each(['.env', '.env.local', '.env.backup', '.llm-config-temp.tmp', '.llm-config-temp.tmp.backup', 'credentials-test.json', 'private.key'])('denies %s without reading', (filePath) => {
		expect(() => controller.snippet({ ...query, filePath })).toThrow();
		expect(fs.readFileSync).not.toHaveBeenCalled();
	});

	it('denies sibling-prefix traversal', () => {
		expect(() => controller.snippet({ ...query, filePath: '../synthetic-project-other/file.ts' })).toThrow();
		expect(fs.readFileSync).not.toHaveBeenCalled();
	});

	it('denies an innocent alias resolving to env', () => {
		jest.mocked(fs.realpathSync).mockImplementation((target) => String(target).endsWith('alias.txt') ? path.join(root, '.env') : String(target));
		expect(() => controller.snippet({ ...query, filePath: 'alias.txt' })).toThrow();
		expect(fs.readFileSync).not.toHaveBeenCalled();
	});

	it('denies symlink escape', () => {
		jest.mocked(fs.realpathSync).mockImplementation((target) => String(target).endsWith('alias.txt') ? path.resolve('outside', 'file.ts') : String(target));
		expect(() => controller.snippet({ ...query, filePath: 'alias.txt' })).toThrow();
	});

	it('permits source when project root itself is a symlink', () => {
		const canonical = path.resolve('canonical-project');
		jest.mocked(fs.realpathSync).mockImplementation((target) => String(target).replace(root, canonical));
		expect(controller.snippet({ ...query, filePath: 'source.ts' }).content).toBe('synthetic source');
		expect(fs.readFileSync).toHaveBeenCalledWith(path.join(canonical, 'source.ts'), 'utf-8');
	});
});
