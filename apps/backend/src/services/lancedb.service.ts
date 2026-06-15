import { Injectable } from '@nestjs/common';
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
	symbolName: string | null;
	content: string;
	vector: number[];
}

@Injectable()
export class LanceDbService {
	private dbPromise: Promise<any> | null = null;
	private tablePromise: Promise<any> | null = null;
	private readonly tableName = 'chunks';

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

		this.tablePromise = (async () => {
			const db = await this.getDb();
			try {
				return await db.openTable(this.tableName);
			} catch {
				if (!createWithRows?.length) {
					return null;
				}
				return db.createTable(this.tableName, createWithRows);
			}
		})();

		return this.tablePromise;
	}

	private escapeSql(value: string) {
		return value.replace(/'/g, "''");
	}

	async upsertFileChunks(projectId: string, fileId: string, rows: LanceChunkRow[]) {
		const table = await this.getTable(rows);
		if (!table) return;

		const project = this.escapeSql(projectId);
		const file = this.escapeSql(fileId);
		await table.delete(`projectId = '${project}' AND fileId = '${file}'`);
		if (rows.length) {
			await table.add(rows);
		}
	}

	async deleteFileChunks(projectId: string, fileId: string) {
		const table = await this.getTable();
		if (!table) return;
		const project = this.escapeSql(projectId);
		const file = this.escapeSql(fileId);
		await table.delete(`projectId = '${project}' AND fileId = '${file}'`);
	}

	async clearProject(projectId: string) {
		const table = await this.getTable();
		if (!table) return;
		const project = this.escapeSql(projectId);
		await table.delete(`projectId = '${project}'`);
	}

	async vectorSearch(projectId: string, vector: number[], topK: number) {
		const table = await this.getTable();
		if (!table || !vector.length) return [];

		const rows = await table.vectorSearch(vector).limit(Math.max(topK * 3, 20)).toArray();
		return (rows ?? [])
			.filter((row: any) => row.projectId === projectId)
			.slice(0, topK) as Array<
				LanceChunkRow & {
					_distance?: number;
				}
			>;
	}
}
