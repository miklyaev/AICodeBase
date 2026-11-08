import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { IndexingService } from '../indexing.service';
import { ProjectsService } from '../projects.service';
import { ProjectsController } from '../../controllers/projects.controller';
import { sha256 } from '../../utils/id';

jest.mock('@lancedb/lancedb', () => ({ connect: jest.fn() }));

describe('indexing content regression (virtual files, in-memory SQLite, no external requests)', () => {
	const root = path.resolve('__indexing_virtual_fixture__');
	let sqlite: Database.Database;
	let db: DatabaseService;
	let files: Map<string, string | Error>;
	let lance: any;
	let llm: any;
	let events: any;
	let projects: ProjectsService;
	let indexer: IndexingService;

	beforeEach(() => {
		sqlite = new Database(':memory:');
		db = Object.create(DatabaseService.prototype);
		(db as any).db = sqlite;
		(db as any).bootstrap();
		db.run("INSERT INTO projects VALUES ('project', 'fixture', ?, 'idle', 'then', 'then', NULL)", [root]);
		files = new Map();
		lance = {
			assertCompatibleDimension: jest.fn(async () => undefined),
			upsertFileChunks: jest.fn(async () => undefined),
			deleteFileChunks: jest.fn(async () => undefined),
		};
		llm = { createEmbeddings: jest.fn(async (inputs: string[]) => {
			if (inputs.some((value) => !value.trim())) throw new Error('EMPTY_EMBEDDING_SENT');
			return inputs.map(() => [1, 2, 3]);
		}) };
		events = { emit: jest.fn() };
		projects = new ProjectsService(db, lance);
		indexer = new IndexingService(db, projects, llm, events, lance, { getApiKeyOrThrow: () => 'synthetic' } as any);

		const readdir = fs.readdirSync;
		const stat = fs.statSync;
		const read = fs.readFileSync;
		jest.spyOn(fs, 'readdirSync').mockImplementation(((location: any, options: any) => {
			if (String(location) !== root) return readdir(location, options);
			return [...files.keys()].map((name) => ({ name, isDirectory: () => false, isFile: () => true }));
		}) as any);
		jest.spyOn(fs, 'statSync').mockImplementation(((location: any, options: any) => {
			const name = path.relative(root, String(location));
			if (!files.has(name)) return stat(location, options);
			const value = files.get(name);
			return { size: typeof value === 'string' ? Buffer.byteLength(value) : 1 };
		}) as any);
		jest.spyOn(fs, 'readFileSync').mockImplementation(((location: any, options: any) => {
			const name = path.relative(root, String(location));
			if (!files.has(name)) return read(location, options);
			const value = files.get(name);
			if (value instanceof Error) throw value;
			return value;
		}) as any);
	});
	afterEach(() => { jest.restoreAllMocks(); sqlite.close(); });

	it('passes empty and whitespace files and continues to the next real source file', async () => {
		files.set('empty.js', '');
		files.set('whitespace.ts', ' \t\r\n');
		files.set('next.ts', 'export const answer = 42;');
		await indexer.indexProject('project');
		expect(projects.getProjectById('project').status).toBe('ready');
		expect(projects.getProjectStats('project')).toEqual({ filesCount: 3, chunksCount: 1 });
		expect(llm.createEmbeddings.mock.calls.map(([inputs]: any) => inputs)).toEqual([
			['index dimension check'], ['export const answer = 42;'],
		]);
		expect(db.all<{ status: string }>('SELECT status FROM files').every((file) => file.status === 'indexed')).toBe(true);
		expect(lance.upsertFileChunks.mock.calls[0][2]).toEqual([]);
	});

	it('removes old chunks when a previously indexed file becomes empty', async () => {
		files.set('changed.ts', 'const previous = 1;');
		await indexer.indexProject('project');
		const fileId = db.get<{ id: string }>('SELECT id FROM files')!.id;
		files.set('changed.ts', '');
		llm.createEmbeddings.mockClear();
		await indexer.indexProject('project');
		expect(projects.getProjectStats('project')).toEqual({ filesCount: 1, chunksCount: 0 });
		expect(lance.upsertFileChunks).toHaveBeenLastCalledWith('project', fileId, []);
		expect(llm.createEmbeddings).toHaveBeenCalledTimes(1); // Model probe only.
	});

	it('continues after a file-local HTTP 400, exposes only safe context, and retries only the failed file', async () => {
		files.set('bad.ts', 'const rejected = true;');
		files.set('good.ts', 'const accepted = true;');
		const normal = llm.createEmbeddings.getMockImplementation();
		let rejectFile = true;
		llm.createEmbeddings.mockImplementation(async (inputs: string[]) => {
			if (rejectFile && inputs[0].includes('rejected')) {
				throw new ServiceUnavailableException({ code: 'LLM_UNAVAILABLE', providerStatus: 400, message: 'private-key-and-source' });
			}
			return normal(inputs);
		});
		await indexer.indexProject('project');
		expect(projects.getProjectById('project').status).toBe('failed');
		expect(projects.getProjectStats('project').filesCount).toBe(1);
		const goodId = db.get<{ id: string }>("SELECT id FROM chunks WHERE relativePath = 'good.ts'")!.id;
		const controller = new ProjectsController(projects, indexer, events);
		expect(controller.getStatus('project')).toMatchObject({
			failedFiles: 1, failure: { filePath: 'bad.ts', stage: 'embeddings', providerStatus: 400 },
		});
		expect(indexer.getProgress('project').message).toContain('HTTP 400');
		expect(JSON.stringify(indexer.getProgress('project'))).not.toContain('private-key-and-source');
		expect(events.emit.mock.calls.some(([, payload]: any) => payload.event === 'indexing.fileFailed')).toBe(true);
		rejectFile = false;
		llm.createEmbeddings.mockClear();
		await indexer.indexProject('project');
		expect(projects.getProjectById('project').status).toBe('ready');
		expect(llm.createEmbeddings.mock.calls.map(([inputs]: any) => inputs)).toEqual([
			['index dimension check'], ['const rejected = true;'],
		]);
		expect(db.get<{ id: string }>("SELECT id FROM chunks WHERE relativePath = 'good.ts'")!.id).toBe(goodId);
	});

	it('continues past a file read error without exposing filesystem details', async () => {
		files.set('unreadable.ts', new Error('private filesystem contents'));
		files.set('good.ts', 'const good = 1;');
		await indexer.indexProject('project');
		expect(projects.getProjectStats('project').filesCount).toBe(1);
		expect(indexer.getProgress('project')).toMatchObject({ failedFiles: 1, failure: { filePath: 'unreadable.ts', stage: 'read' } });
		expect(JSON.stringify(indexer.getProgress('project'))).not.toContain('private filesystem');
	});

	it('stops a background job on global HTTP 401 and reports the failing file safely', async () => {
		files.set('first.ts', 'const first = 1;');
		files.set('next.ts', 'const next = 1;');
		llm.createEmbeddings.mockImplementation(async (inputs: string[]) => {
			if (inputs[0] !== 'index dimension check') {
				throw new ServiceUnavailableException({ code: 'LLM_UNAVAILABLE', providerStatus: 401, message: 'private token' });
			}
			return [[1, 2, 3]];
		});
		await indexer.startIndexing('project');
		for (let attempt = 0; attempt < 20 && projects.getProjectById('project').status !== 'failed'; attempt += 1) {
			await new Promise<void>((resolve) => setImmediate(resolve));
		}
		expect(projects.getProjectById('project').status).toBe('failed');
		expect(indexer.getProgress('project')).toMatchObject({ failure: { filePath: 'first.ts', stage: 'embeddings', providerStatus: 401 } });
		expect(llm.createEmbeddings).toHaveBeenCalledTimes(2);
		expect(JSON.stringify(events.emit.mock.calls)).not.toContain('private token');
	});

	it('does not skip a file by hash after a vector-write failure', async () => {
		const content = 'const value = 1;';
		files.set('retry.ts', content);
		lance.upsertFileChunks.mockRejectedValueOnce(new Error('private vector details'));
		await expect(indexer.indexProject('project')).rejects.toMatchObject({ failure: { stage: 'vectors', filePath: 'retry.ts' } });
		expect(db.get('SELECT status, contentHash FROM files')).toEqual({ status: 'indexing', contentHash: sha256(content) });
		const fileId = db.get<{ id: string }>('SELECT id FROM files')!.id;
		await indexer.indexProject('project');
		expect(lance.upsertFileChunks).toHaveBeenCalledTimes(2);
		expect(lance.upsertFileChunks.mock.calls[1][1]).toBe(fileId);
		expect(projects.getProjectById('project').status).toBe('ready');
		expect(db.get('SELECT status FROM files')).toEqual({ status: 'indexed' });
	});
});
