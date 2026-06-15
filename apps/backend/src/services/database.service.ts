import { Injectable } from '@nestjs/common';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

@Injectable()
export class DatabaseService {
	private readonly db: Database.Database;

	constructor() {
		const dataDir = path.resolve(process.cwd(), 'data');
		fs.mkdirSync(dataDir, { recursive: true });
		const dbPath = path.join(dataDir, 'app.sqlite');
		this.db = new Database(dbPath);
		this.bootstrap();
	}

	private bootstrap() {
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        rootPath TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        lastIndexedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL,
        relativePath TEXT NOT NULL,
        absolutePath TEXT NOT NULL,
        extension TEXT NOT NULL,
        language TEXT NOT NULL,
        sizeBytes INTEGER NOT NULL,
        contentHash TEXT NOT NULL,
        indexedAt TEXT NOT NULL,
        status TEXT NOT NULL,
        UNIQUE(projectId, relativePath)
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL,
        fileId TEXT NOT NULL,
        relativePath TEXT NOT NULL,
        chunkIndex INTEGER NOT NULL,
        startLine INTEGER NOT NULL,
        endLine INTEGER NOT NULL,
        language TEXT NOT NULL,
        symbolName TEXT,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversationId TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
    `);
	}

	run(sql: string, params?: unknown[]) {
		return this.db.prepare(sql).run(...(params ?? []));
	}

	get<T>(sql: string, params?: unknown[]): T | undefined {
		return this.db.prepare(sql).get(...(params ?? [])) as T | undefined;
	}

	all<T>(sql: string, params?: unknown[]): T[] {
		return this.db.prepare(sql).all(...(params ?? [])) as T[];
	}

	transaction<T>(handler: () => T): T {
		return this.db.transaction(handler)();
	}
}
