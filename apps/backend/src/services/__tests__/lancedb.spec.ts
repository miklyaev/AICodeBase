import { connect } from '@lancedb/lancedb';
import fs from 'node:fs';
import { LanceDbService } from '../lancedb.service';

jest.mock('@lancedb/lancedb', () => ({ connect: jest.fn() }));

describe('LanceDbService dimension safety (no real database)', () => {
	let db: any;
	let table: any;
	beforeEach(() => {
		jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
		table = { schema: jest.fn(async () => ({ fields: [{ name: 'vector', type: { listSize: 1536 } }] })), countRows: jest.fn(async () => 1), delete: jest.fn(), add: jest.fn() };
		db = { tableNames: jest.fn(async () => ['chunks']), openTable: jest.fn(async () => table), dropTable: jest.fn(), createTable: jest.fn(async () => table) };
		jest.mocked(connect).mockResolvedValue(db);
	});
	afterEach(() => jest.restoreAllMocks());

	it('rejects a populated old 1536-dimensional index without deleting data', async () => {
		const service = new LanceDbService();
		await expect(service.assertCompatibleDimension(2560)).rejects.toThrow('Требуется очистить индексы всех проектов');
		expect(db.dropTable).not.toHaveBeenCalled();
		expect(table.delete).not.toHaveBeenCalled();
	});

	it('accepts matching dimensions, including arbitrary compatible provider models', async () => {
		await expect(new LanceDbService().assertCompatibleDimension(1536)).resolves.toBeUndefined();
	});

	it('can reset only an empty old schema', async () => {
		table.countRows.mockResolvedValue(0);
		await new LanceDbService().assertCompatibleDimension(2560);
		expect(db.dropTable).toHaveBeenCalledWith('chunks');
	});

	it('does not delete/recreate a corrupted populated table', async () => {
		db.openTable.mockRejectedValue(new Error('Schema error private details'));
		await expect(new LanceDbService().assertCompatibleDimension(2560)).rejects.toThrow('Векторный индекс несовместим');
		expect(db.dropTable).not.toHaveBeenCalled();
		expect(db.createTable).not.toHaveBeenCalled();
	});

	it('explicit reset drops a corrupted table without open/schema and invalidates cached handles', async () => {
		const service = new LanceDbService();
		await service.assertCompatibleDimension(1536);
		db.openTable.mockClear();
		table.schema.mockClear();
		db.openTable.mockRejectedValueOnce(new Error('broken schema'));
		await service.resetIndex();
		expect(db.dropTable).toHaveBeenCalledWith('chunks');
		expect(db.openTable).not.toHaveBeenCalled();
		expect(table.schema).not.toHaveBeenCalled();
		await expect(service.assertCompatibleDimension(1536)).rejects.toThrow();
		expect(db.openTable).toHaveBeenCalledTimes(1);
	});

	it('explicit reset is idempotent when the table is absent', async () => {
		db.tableNames.mockResolvedValue([]);
		await new LanceDbService().resetIndex();
		expect(db.dropTable).not.toHaveBeenCalled();
		expect(db.openTable).not.toHaveBeenCalled();
	});

	it('does not cache absence and permits later table creation', async () => {
		db.tableNames.mockResolvedValue([]);
		const service = new LanceDbService();
		await service.assertCompatibleDimension(2560);
		await service.upsertFileChunks('project', 'file', [{ vector: new Array(2560).fill(0) } as any]);
		expect(db.createTable).toHaveBeenCalled();
	});

	it('uses Lance identifier quoting when replacing vectors, including empty-file updates', async () => {
		const service = new LanceDbService();
		const rows = [{ vector: new Array(1536).fill(0) } as any];
		await service.upsertFileChunks('project', 'file', rows);
		expect(table.delete).toHaveBeenLastCalledWith("`fileId` = 'file'");
		expect(table.add).toHaveBeenCalledWith(rows);
		table.add.mockClear();
		await service.upsertFileChunks('project', 'file', []);
		expect(table.delete).toHaveBeenLastCalledWith("`fileId` = 'file'");
		expect(table.add).not.toHaveBeenCalled();
	});

	it('quotes case-sensitive columns and escapes values for file/project deletion', async () => {
		const service = new LanceDbService();
		await service.deleteFileChunks('project', "file'value");
		expect(table.delete).toHaveBeenLastCalledWith("`fileId` = 'file''value'");
		await service.clearProject("project'value");
		expect(table.delete).toHaveBeenLastCalledWith("`projectId` = 'project''value'");
	});
});
