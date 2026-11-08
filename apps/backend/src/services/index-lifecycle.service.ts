import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { LanceDbService } from './lancedb.service';
import { LlmService } from './llm.service';

interface EmbeddingFingerprint {
	baseUrl: string;
	embeddingModel: string;
}

@Injectable()
export class IndexLifecycleService {
	// Process-local leases, not persisted project statuses: a crash/restart cannot
	// leave the administrator permanently locked out of recovery.
	private busy = false;
	private readonly fingerprintKey = 'embeddingFingerprint';
	private readonly resetPendingKey = 'indexResetPending';

	constructor(
		private readonly db: DatabaseService,
		private readonly lance: LanceDbService,
		private readonly llm: LlmService,
	) { }

	acquire(): () => void {
		if (this.busy) {
			throw new ConflictException({ code: 'INDEXING_IN_PROGRESS', message: 'Индекс занят. Дождитесь завершения текущей операции и повторите попытку.' });
		}
		this.busy = true;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.busy = false;
		};
	}

	private hasPendingCleanup() {
		return Boolean(this.db.get('SELECT value FROM metadata WHERE key = ?', [this.resetPendingKey]));
	}

	private savePendingCleanup() {
		this.db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', [this.resetPendingKey, 'true']);
	}

	// Internal store protocol: callers hold the lifecycle lease and invoke
	// completion only inside the successful SQLite cleanup transaction.
	beginIndexCleanup() {
		if (this.hasPendingCleanup()) {
			throw new ConflictException({ code: 'INDEX_REBUILD_REQUIRED', message: 'Предыдущая очистка индекса не завершена. Администратору необходимо сбросить индексы всех проектов.' });
		}
		this.savePendingCleanup();
	}

	completeIndexCleanup() {
		this.db.run('DELETE FROM metadata WHERE key = ?', [this.resetPendingKey]);
	}

	private storedFingerprint(): EmbeddingFingerprint | null {
		const row = this.db.get<{ value: string }>('SELECT value FROM metadata WHERE key = ?', [this.fingerprintKey]);
		try {
			const parsed = JSON.parse(row?.value ?? 'null');
			return parsed && typeof parsed.baseUrl === 'string' && typeof parsed.embeddingModel === 'string'
				? { baseUrl: parsed.baseUrl, embeddingModel: parsed.embeddingModel } : null;
		} catch {
			return null;
		}
	}

	private saveFingerprint() {
		this.db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', [this.fingerprintKey, JSON.stringify(this.llm.getEmbeddingFingerprint())]);
	}

	private async inspect() {
		const current = this.llm.getEmbeddingFingerprint();
		const stored = this.storedFingerprint();
		const resetPending = this.hasPendingCleanup();
		const sqliteChunks = this.db.get<{ count: number }>('SELECT COUNT(*) as count FROM chunks')?.count ?? 0;
		const lanceChunks = await this.lance.getStoredChunkCount();
		const indexedChunks = Math.max(sqliteChunks, lanceChunks ?? 0);
		const mismatch = stored && (stored.baseUrl !== current.baseUrl || stored.embeddingModel !== current.embeddingModel);
		return {
			embeddingModel: current.embeddingModel,
			storedEmbeddingModel: stored?.embeddingModel ?? null,
			requiresReset: resetPending || lanceChunks === null || (indexedChunks > 0 && (!stored || Boolean(mismatch))),
			indexedProjects: this.db.get<{ count: number }>('SELECT COUNT(DISTINCT projectId) as count FROM chunks')?.count ?? 0,
			indexedChunks,
		};
	}

	async getStatus() {
		const release = this.acquire();
		try {
			return await this.inspect();
		} finally {
			release();
		}
	}

	async assertCompatible() {
		if ((await this.inspect()).requiresReset) {
			throw new ConflictException({ code: 'INDEX_REBUILD_REQUIRED', message: 'Модель embeddings изменилась или индекс устарел. Администратору необходимо сбросить индексы всех проектов и выполнить полную индексацию.' });
		}
	}

	// Called after preflight succeeds, before the first index mutation. Persisting
	// even if indexing later fails identifies any partially written chunks.
	initializeFingerprint() {
		this.saveFingerprint();
	}

	async reset() {
		const release = this.acquire();
		try {
			// Commit recovery intent before touching either store. If Lance deletion
			// succeeds but SQL cleanup fails (or the process crashes), unchanged
			// SQLite files must never be mistaken for a complete vector index.
			this.savePendingCleanup();
			await this.lance.resetIndex();
			this.db.transaction(() => {
				this.db.run('DELETE FROM chunks');
				this.db.run('DELETE FROM files');
				this.db.run('UPDATE projects SET status = ?, lastIndexedAt = NULL, updatedAt = ?', ['idle', new Date().toISOString()]);
				this.saveFingerprint();
				this.completeIndexCleanup();
			});
			return { success: true as const };
		} catch {
			throw new ServiceUnavailableException({ code: 'INDEX_RESET_FAILED', message: 'Не удалось сбросить индексы. Повторите попытку.' });
		} finally {
			release();
		}
	}
}
