import { HttpException } from '@nestjs/common';

export type IndexingStage = 'prepare' | 'scan' | 'read' | 'embeddings' | 'sqlite' | 'vectors' | 'cleanup';

export interface IndexingFailure {
	code: string;
	stage: IndexingStage;
	filePath?: string;
	providerStatus?: number;
}

export class IndexingOperationError extends Error {
	constructor(readonly failure: IndexingFailure) {
		super('Indexing operation failed');
	}
}

const SAFE_CODES = new Set([
	'INDEX_REBUILD_REQUIRED', 'LLM_UNAVAILABLE', 'LLM_INVALID_RESPONSE',
	'LLM_KEY_MISSING', 'INVALID_EMBEDDING_INPUT',
]);

export function describeIndexingFailure(error: unknown, stage: IndexingStage = 'prepare', filePath?: string): IndexingFailure {
	if (error instanceof IndexingOperationError) return error.failure;
	const response = error instanceof HttpException ? error.getResponse() : null;
	const details = response && typeof response === 'object' ? response as Record<string, unknown> : {};
	const code = typeof details.code === 'string' && SAFE_CODES.has(details.code) ? details.code : 'INDEXING_FAILED';
	const providerStatus = typeof details.providerStatus === 'number' && Number.isInteger(details.providerStatus)
		&& details.providerStatus >= 400 && details.providerStatus <= 599 ? details.providerStatus : undefined;
	// Never copy exception.message, upstream bodies, absolute paths or file contents.
	const relative = filePath && !/^(?:[\\/]|[a-z]:)/i.test(filePath)
		? filePath.replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 300) : undefined;
	return { code, stage, ...(relative ? { filePath: relative } : {}), ...(providerStatus ? { providerStatus } : {}) };
}

export function indexingFailureMessage(failure: IndexingFailure): string {
	const stages: Record<IndexingStage, string> = {
		prepare: 'подготовка', scan: 'сканирование', read: 'чтение файла',
		embeddings: 'получение embeddings', sqlite: 'сохранение метаданных',
		vectors: 'сохранение векторов', cleanup: 'очистка удалённых файлов',
	};
	const context = `${failure.filePath ? `Файл «${failure.filePath}». ` : ''}Этап: ${stages[failure.stage]}.`
		+ (failure.providerStatus ? ` HTTP ${failure.providerStatus}.` : '');
	if (failure.code === 'INDEX_REBUILD_REQUIRED') {
		return `${context} Векторный индекс несовместим. Очистите индексы всех проектов прежней модели и выполните полную переиндексацию.`;
	}
	if (failure.code === 'LLM_KEY_MISSING') return `${context} API-ключ не настроен. Обратитесь к администратору.`;
	return `${context} Индексация не выполнена. Проверьте настройки сервера и повторите попытку.`;
}
