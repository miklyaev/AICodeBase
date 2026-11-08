import { ConflictException, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import * as lancedb from '@lancedb/lancedb';

export interface LanceChunkRow {
	chunkId: string;
	projectId: string;
	fileId: string;
	relativePath: string;
	startLine: number;
	endLine: number;
	language: string;
	symbolName: string;
	content: string;
	vector: number[];
}

@Injectable()
export class LanceDbService {
	private dbPromise: Promise<any> | null = null;
	private tablePromise: Promise<any> | null = null;
	private readonly tableName = 'chunks';

	private incompatible() {
		return new ConflictException({ code: 'INDEX_REBUILD_REQUIRED', message: 'Векторный индекс несовместим с моделью embeddings. Требуется очистить индексы всех проектов прежней модели и выполнить полную переиндексацию; существующие данные не удалены.' });
	}

	private async getDb() {
		if (!this.dbPromise) {
			const dataDir = path.resolve(process.cwd(), 'data', 'lancedb');
			fs.mkdirSync(dataDir, { recursive: true });
			this.dbPromise = lancedb.connect(dataDir);
		}
		return this.dbPromise;
	}

	private async getTable(createWithRows?: LanceChunkRow[]) {
		if (this.tablePromise) return this.tablePromise;
		const pending = (async () => {
			const db = await this.getDb();
			const names = await db.tableNames();
			if (names.includes(this.tableName)) {
				try {
					return await db.openTable(this.tableName);
				} catch {
					throw this.incompatible();
				}
			}
			if (!createWithRows?.length) return null;
			return db.createTable(this.tableName, createWithRows);
		})();
		this.tablePromise = pending;
		try {
			const table = await pending;
			if (!table) this.tablePromise = null;
			return table;
		} catch (error) {
			this.tablePromise = null;
			throw error;
		}
	}

	async assertCompatibleDimension(dimension: number) {
		if (!Number.isInteger(dimension) || dimension <= 0) throw this.incompatible();
		const table = await this.getTable();
		if (!table) return;
		try {
			const schema = await table.schema();
			const size = schema.fields.find((field: any) => field.name === 'vector')?.type?.listSize;
			if (size !== dimension) {
				if (await table.countRows() !== 0) throw this.incompatible();
				const db = await this.getDb();
				await db.dropTable(this.tableName);
				this.tablePromise = null;
			}
		} catch {
			throw this.incompatible();
		}
	}

	// Reset deliberately avoids opening the table or reading its schema: legacy
	// and damaged tables must remain removable by an explicit admin action.
	async resetIndex() {
		const db = await this.getDb();
		if ((await db.tableNames()).includes(this.tableName)) await db.dropTable(this.tableName);
		this.tablePromise = null;
	}

	async getStoredChunkCount(): Promise<number | null> {
		try {
			const table = await this.getTable();
			return table ? await table.countRows() : 0;
		} catch {
			return null; // An unreadable index requires an explicit reset too.
		}
	}

	private escapeSql(value: string) {
		return value.replace(/'/g, "''");
	}

	async upsertFileChunks(projectId: string, fileId: string, rows: LanceChunkRow[]) {
		if (rows.length) {
			const dimension = rows[0].vector.length;
			if (rows.some((row) => row.vector.length !== dimension)) throw this.incompatible();
			await this.assertCompatibleDimension(dimension);
		}
		const table = await this.getTable(rows);
		if (!table) return;
		await table.delete(`\`fileId\` = '${this.escapeSql(fileId)}'`);
		if (rows.length) await table.add(rows);
	}

	async deleteFileChunks(projectId: string, fileId: string) {
		const table = await this.getTable();
		if (table) await table.delete(`\`fileId\` = '${this.escapeSql(fileId)}'`);
	}

	async clearProject(projectId: string) {
		const table = await this.getTable();
		if (table) await table.delete(`\`projectId\` = '${this.escapeSql(projectId)}'`);
	}

	async vectorSearch(projectId: string, vector: number[], topK: number) {
		if (!vector.length) return [];
		await this.assertCompatibleDimension(vector.length);
		const table = await this.getTable();
		if (!table) return [];
		const rows = await table.vectorSearch(vector).limit(Math.max(topK * 3, 20)).toArray();
		return (rows ?? []).filter((row: any) => row.projectId === projectId)
			.slice(0, topK) as Array<LanceChunkRow & { _distance?: number }>;
	}
}
