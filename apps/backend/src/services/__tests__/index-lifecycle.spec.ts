import Database from 'better-sqlite3';
import { DatabaseService } from '../database.service';
import { IndexLifecycleService } from '../index-lifecycle.service';
import { IndexingService } from '../indexing.service';
import { SearchService } from '../search.service';
import { ProjectsService } from '../projects.service';

jest.mock('@lancedb/lancedb', () => ({ connect: jest.fn() }));

describe('index lifecycle (isolated in-memory SQLite only)', () => {
	let sqlite: Database.Database;
	let db: DatabaseService;
	let lifecycle: IndexLifecycleService;
	let lance: any;
	let llm: any;
	beforeEach(() => {
		sqlite = new Database(':memory:');
		db = Object.create(DatabaseService.prototype);
		(db as any).db = sqlite;
		(db as any).bootstrap();
		lance = { getStoredChunkCount: jest.fn(async () => 0), resetIndex: jest.fn(async () => undefined), assertCompatibleDimension: jest.fn(async () => undefined) };
		llm = { getEmbeddingFingerprint: jest.fn(() => ({ baseUrl: 'https://synthetic.invalid/v1', embeddingModel: 'new-model' })), createEmbeddings: jest.fn(async () => [[1, 2]]) };
		lifecycle = new IndexLifecycleService(db, lance, llm);
	});
	afterEach(() => sqlite.close());

	const seedProject = (db: DatabaseService, id: string) => db.run("INSERT INTO projects VALUES (?, ?, ?, 'indexing', 'then', 'then', 'then')", [id, id, `root-${id}`]);
	const seedChunks = (db: DatabaseService, id: string) => {
		seedProject(db, id);
		db.run("INSERT INTO files VALUES (?, ?, 'a.ts', 'root/a.ts', '.ts', 'ts', 1, 'hash', 'then', 'indexed')", [`f-${id}`, id]);
		db.run("INSERT INTO chunks VALUES (?, ?, ?, 'a.ts', 0, 1, 1, 'ts', '', 'code', '[1,2]')", [`c-${id}`, id, `f-${id}`]);
	};

	it('allows empty legacy indexes and persists only model/baseUrl, never credentials', async () => {
		await expect(lifecycle.assertCompatible()).resolves.toBeUndefined();
		lifecycle.initializeFingerprint();
		expect(JSON.parse(db.get<{ value: string }>('SELECT value FROM metadata')!.value)).toEqual(llm.getEmbeddingFingerprint());
		expect((await lifecycle.getStatus()).requiresReset).toBe(false);
	});

	it('flags populated legacy SQLite and Lance indexes without guessing a model', async () => {
		seedChunks(db, 'a');
		expect(await lifecycle.getStatus()).toEqual({ embeddingModel: 'new-model', storedEmbeddingModel: null, requiresReset: true, indexedProjects: 1, indexedChunks: 1 });
		await expect(lifecycle.assertCompatible()).rejects.toMatchObject({ response: { code: 'INDEX_REBUILD_REQUIRED' } });
		db.run('DELETE FROM chunks');
		lance.getStoredChunkCount.mockResolvedValue(4);
		expect((await lifecycle.getStatus()).requiresReset).toBe(true);
	});

	it.each(['model', 'baseUrl'])('blocks %s changes even when dimensions match before embeddings or mutations', async (change) => {
		lifecycle.initializeFingerprint();
		seedChunks(db, 'a');
		llm.getEmbeddingFingerprint.mockReturnValue({ baseUrl: change === 'baseUrl' ? 'https://changed.invalid/v1' : 'https://synthetic.invalid/v1', embeddingModel: change === 'model' ? 'changed' : 'new-model' });
		const projects = { getProjectById: jest.fn(() => ({ rootPath: 'unused' })), setProjectStatus: jest.fn() };
		const indexer = new IndexingService(db, projects as any, llm, {} as any, lance, {} as any, lifecycle);
		const search = new SearchService(db, llm, projects as any, lance, lifecycle);
		await expect(indexer.startIndexing('a')).rejects.toMatchObject({ response: { code: 'INDEX_REBUILD_REQUIRED' } });
		await expect(search.search('a', 'query')).rejects.toMatchObject({ response: { code: 'INDEX_REBUILD_REQUIRED' } });
		expect(llm.createEmbeddings).not.toHaveBeenCalled();
		expect(projects.setProjectStatus).not.toHaveBeenCalled();
		expect(db.get<{ count: number }>('SELECT COUNT(*) as count FROM chunks')?.count).toBe(1);
		// Both failed preflights released their leases.
		await expect(lifecycle.reset()).resolves.toEqual({ success: true });
	});

	it('resets all indexes despite stale indexing statuses, retaining projects and chat history', async () => {
		seedChunks(db, 'a'); seedChunks(db, 'b');
		db.run("INSERT INTO conversations VALUES ('conversation', 'a', 'then', 'then')");
		db.run("INSERT INTO messages VALUES ('message', 'conversation', 'user', 'hello', 'then')");
		await lifecycle.reset();
		expect(lance.resetIndex).toHaveBeenCalledTimes(1);
		expect(db.all('SELECT * FROM files')).toEqual([]);
		expect(db.all('SELECT * FROM chunks')).toEqual([]);
		expect(db.all('SELECT status, lastIndexedAt FROM projects')).toEqual([{ status: 'idle', lastIndexedAt: null }, { status: 'idle', lastIndexedAt: null }]);
		expect(db.all('SELECT * FROM conversations')).toHaveLength(1);
		expect(db.all('SELECT * FROM messages')).toHaveLength(1);
		expect((await lifecycle.getStatus()).storedEmbeddingModel).toBe('new-model');
	});

	it('rejects reset while an indexing lease is active, then permits recovery', async () => {
		const release = lifecycle.acquire();
		await expect(lifecycle.reset()).rejects.toMatchObject({ status: 409, response: { code: 'INDEXING_IN_PROGRESS' } });
		expect(lance.resetIndex).not.toHaveBeenCalled();
		release(); release();
		await expect(lifecycle.reset()).resolves.toEqual({ success: true });
	});

	it('sanitizes failed resets, preserves SQLite rows and always releases the lease', async () => {
		seedChunks(db, 'a');
		lance.resetIndex.mockRejectedValueOnce(new Error('secret disk content'));
		await expect(lifecycle.reset()).rejects.toMatchObject({ response: { code: 'INDEX_RESET_FAILED' } });
		expect(db.all('SELECT * FROM chunks')).toHaveLength(1);
		await expect(lifecycle.reset()).resolves.toEqual({ success: true });
	});

	it('keeps durable reset intent after Lance deletion and a rolled-back SQL cleanup', async () => {
		lifecycle.initializeFingerprint();
		seedChunks(db, 'a');
		db.run("INSERT INTO conversations VALUES ('conversation', 'a', 'then', 'then')");
		db.run("INSERT INTO messages VALUES ('message', 'conversation', 'user', 'hello', 'then')");
		db.run("CREATE TEMP TRIGGER fail_cleanup BEFORE DELETE ON files BEGIN SELECT RAISE(ABORT, 'private SQL failure'); END");

		await expect(lifecycle.reset()).rejects.toMatchObject({ response: { code: 'INDEX_RESET_FAILED', message: 'Не удалось сбросить индексы. Повторите попытку.' } });
		expect(lance.resetIndex).toHaveBeenCalledTimes(1);
		expect(db.all('SELECT * FROM files')).toHaveLength(1);
		expect(db.all('SELECT * FROM chunks')).toHaveLength(1);
		expect(db.get('SELECT value FROM metadata WHERE key = ?', ['indexResetPending'])).toEqual({ value: 'true' });

		// A fresh service represents a restart: only the persistent marker can
		// distinguish this partial reset from a compatible, fully indexed store.
		const restarted = new IndexLifecycleService(db, lance, llm);
		expect(await restarted.getStatus()).toMatchObject({ storedEmbeddingModel: 'new-model', requiresReset: true });
		const projects = { getProjectById: jest.fn(() => ({ rootPath: 'unused' })), setProjectStatus: jest.fn() };
		const indexer = new IndexingService(db, projects as any, llm, {} as any, lance, {} as any, restarted);
		const search = new SearchService(db, llm, projects as any, lance, restarted);
		await expect(indexer.startIndexing('a')).rejects.toMatchObject({ response: { code: 'INDEX_REBUILD_REQUIRED' } });
		await expect(search.search('a', 'query')).rejects.toMatchObject({ response: { code: 'INDEX_REBUILD_REQUIRED' } });
		expect(llm.createEmbeddings).not.toHaveBeenCalled();
		expect(projects.setProjectStatus).not.toHaveBeenCalled();

		db.run('DROP TRIGGER fail_cleanup');
		await expect(restarted.reset()).resolves.toEqual({ success: true });
		expect(db.get('SELECT value FROM metadata WHERE key = ?', ['indexResetPending'])).toBeUndefined();
		expect((await restarted.getStatus()).requiresReset).toBe(false);
		expect(db.all('SELECT * FROM files')).toEqual([]);
		expect(db.all('SELECT * FROM chunks')).toEqual([]);
		expect(db.all('SELECT status, lastIndexedAt FROM projects')).toEqual([{ status: 'idle', lastIndexedAt: null }]);
		expect(db.all('SELECT * FROM conversations')).toHaveLength(1);
		expect(db.all('SELECT * FROM messages')).toHaveLength(1);
	});

	it('blocks new indexing/search after partial project clear until a global reset recovers', async () => {
		lifecycle.initializeFingerprint();
		seedChunks(db, 'a'); seedChunks(db, 'b');
		db.run("INSERT INTO conversations VALUES ('conversation', 'a', 'then', 'then')");
		db.run("INSERT INTO messages VALUES ('message', 'conversation', 'user', 'hello', 'then')");
		lance.clearProject = jest.fn(async () => undefined);
		const projects = new ProjectsService(db, lance, lifecycle);
		db.run("CREATE TEMP TRIGGER fail_project_cleanup BEFORE DELETE ON files BEGIN SELECT RAISE(ABORT, 'private SQL failure'); END");
		await expect(projects.clearProjectIndex('a')).rejects.toMatchObject({ response: { code: 'INDEX_CLEAR_FAILED', message: 'Не удалось очистить индекс проекта. Администратору необходимо сбросить индексы всех проектов.' } });
		expect(lance.clearProject).toHaveBeenCalledWith('a');
		expect(db.all('SELECT * FROM files')).toHaveLength(2);
		expect(db.all('SELECT * FROM chunks')).toHaveLength(2);
		expect(db.get('SELECT value FROM metadata WHERE key = ?', ['indexResetPending'])).toEqual({ value: 'true' });
		expect((await lifecycle.getStatus()).requiresReset).toBe(true);
		const indexer = new IndexingService(db, projects, llm, {} as any, lance, {} as any, lifecycle);
		const search = new SearchService(db, llm, projects, lance, lifecycle);
		await expect(indexer.startIndexing('a')).rejects.toMatchObject({ response: { code: 'INDEX_REBUILD_REQUIRED' } });
		await expect(search.search('a', 'query')).rejects.toMatchObject({ response: { code: 'INDEX_REBUILD_REQUIRED' } });
		expect(llm.createEmbeddings).not.toHaveBeenCalled();
		// A later successful project clear cannot erase global recovery intent.
		db.run('DROP TRIGGER fail_project_cleanup');
		await expect(projects.clearProjectIndex('b')).rejects.toMatchObject({ response: { code: 'INDEX_REBUILD_REQUIRED' } });
		expect(lance.clearProject).toHaveBeenCalledTimes(1);
		await expect(lifecycle.reset()).resolves.toEqual({ success: true });
		expect(db.get('SELECT value FROM metadata WHERE key = ?', ['indexResetPending'])).toBeUndefined();
		expect((await lifecycle.getStatus()).requiresReset).toBe(false);
		expect(db.all('SELECT * FROM files')).toEqual([]);
		expect(db.all('SELECT * FROM chunks')).toEqual([]);
		expect(db.all('SELECT * FROM conversations')).toHaveLength(1);
		expect(db.all('SELECT * FROM messages')).toHaveLength(1);
	});

	it('clears one project atomically without relabelling remaining legacy embeddings', async () => {
		seedChunks(db, 'a'); seedChunks(db, 'b');
		lance.clearProject = jest.fn(async () => undefined);
		const projects = new ProjectsService(db, lance, lifecycle);
		await projects.clearProjectIndex('a');
		expect(db.all<{ projectId: string }>('SELECT projectId FROM files')).toEqual([{ projectId: 'b' }]);
		expect(db.get('SELECT value FROM metadata WHERE key = ?', ['indexResetPending'])).toBeUndefined();
		expect(await lifecycle.getStatus()).toMatchObject({ storedEmbeddingModel: null, requiresReset: true, indexedChunks: 1 });
	});

	it('requires recovery after a failed Lance reset even when both stores are empty', async () => {
		lifecycle.initializeFingerprint();
		lance.resetIndex.mockRejectedValueOnce(new Error('private Lance failure'));
		await expect(lifecycle.reset()).rejects.toMatchObject({ response: { code: 'INDEX_RESET_FAILED' } });
		expect(await lifecycle.getStatus()).toMatchObject({ indexedChunks: 0, requiresReset: true });
		await expect(lifecycle.assertCompatible()).rejects.toMatchObject({ response: { code: 'INDEX_REBUILD_REQUIRED' } });
		await lifecycle.reset();
		expect((await lifecycle.getStatus()).requiresReset).toBe(false);
	});

	it('does not delete Lance data when durable reset intent cannot be saved', async () => {
		jest.spyOn(db, 'run').mockImplementationOnce(() => { throw new Error('private SQLite failure'); });
		await expect(lifecycle.reset()).rejects.toMatchObject({ response: { code: 'INDEX_RESET_FAILED' } });
		expect(lance.resetIndex).not.toHaveBeenCalled();
		await expect(lifecycle.reset()).resolves.toEqual({ success: true });
	});

	it('holds a real indexing lease until failure and releases it in finally', async () => {
		let fail!: (error: Error) => void;
		llm.createEmbeddings.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
		const projects = { getProjectById: jest.fn(() => ({ rootPath: 'unused' })), setProjectStatus: jest.fn() };
		const indexer = new IndexingService(db, projects as any, llm, {} as any, lance, { getApiKeyOrThrow: jest.fn() } as any, lifecycle);
		const running = indexer.indexProject('a');
		while (!fail) await Promise.resolve();
		await expect(lifecycle.reset()).rejects.toMatchObject({ response: { code: 'INDEXING_IN_PROGRESS' } });
		fail(new Error('synthetic upstream failure'));
		await expect(running).rejects.toThrow('synthetic upstream failure');
		await expect(lifecycle.reset()).resolves.toEqual({ success: true });
	});

	it('marks unreadable Lance indexes as requiring reset', async () => {
		lance.getStoredChunkCount.mockResolvedValue(null);
		expect((await lifecycle.getStatus()).requiresReset).toBe(true);
	});
});
