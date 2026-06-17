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
	symbolName: string;
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
				// Пытаемся открыть существующую таблицу
				return await db.openTable(this.tableName);
			} catch (err: any) {
				// Если таблица повреждена или не существует, удаляем и создаём заново
				if (err.message?.includes('Schema error') || err.message?.includes('No field')) {
					try {
						await db.dropTable(this.tableName);
					} catch {
						// Если не удалось удалить, продолжаем
					}
				}

				if (!createWithRows?.length) {
					return null;
				}
				// LanceDB автоматически определяет схему из данных
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

		// Удаляем старые данные для этого файла через fileId
		// Используем двойные кавычки для имен колонок, чтобы избежать приведения к нижнему регистру
		const fileIdEscaped = this.escapeSql(fileId);
		await table.delete(`"fileId" = '${fileIdEscaped}'`);

		if (rows.length) {
			await table.add(rows);
		}
	}

	async deleteFileChunks(projectId: string, fileId: string) {
		const table = await this.getTable();
		if (!table) return;

		const fileIdEscaped = this.escapeSql(fileId);
		await table.delete(`"fileId" = '${fileIdEscaped}'`);
	}

	async clearProject(projectId: string) {
		const table = await this.getTable();
		if (!table) return;

		const projectIdEscaped = this.escapeSql(projectId);
		await table.delete(`"projectId" = '${projectIdEscaped}'`);
	}

	async vectorSearch(projectId: string, vector: number[], topK: number) {
		const table = await this.getTable();
		if (!table || !vector.length) return [];

		const rows = await table.vectorSearch(vector).limit(Math.max(topK * 3, 20)).toArray();
		// В LanceDB 0.33+ имена полей в возвращаемых объектах соответствуют схеме (camelCase)
		return (rows ?? []).filter((row: any) => row.projectId === projectId)
			.slice(0, topK) as Array<LanceChunkRow & { _distance?: number; }>;
	}
}
