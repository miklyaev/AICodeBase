import { describe, expect, it } from 'vitest';
import {
	initialReferenceState, latestChatReferences, referenceReducer, sameReference, snippetLineNumber,
} from '../code-references';
import type { CodeReference } from '../types';

const reference = (filePath: string, startLine = 100, endLine = 120): CodeReference => ({
	filePath, startLine, endLine, language: 'ts', reason: 'match', snippet: '', relevance: 1,
});
const search = [reference('search.ts')];
const chat = [reference('chat.ts'), reference('other.ts')];
const snippet = { content: 'const answer = 42;', startLine: 95, endLine: 125 };

describe('code reference panel synchronization', () => {
	it('switches both the list and selected code from search to a chat answer', () => {
		const searched = referenceReducer(initialReferenceState, {
			type: 'select', references: search, reference: search[0], request: 1,
		});
		const loaded = referenceReducer(searched, { type: 'loaded', snippet, request: 1 });
		const answered = referenceReducer(loaded, {
			type: 'select', references: chat, reference: chat[0], request: 2,
		});
		expect(answered).toMatchObject({
			references: chat, activeReference: chat[0], snippet: null, loading: true,
		});
	});

	it('opens an older answer with its own complete reference list', () => {
		const newer = referenceReducer(initialReferenceState, {
			type: 'select', references: search, reference: search[0], request: 1,
		});
		const older = referenceReducer(newer, {
			type: 'select', references: chat, reference: chat[1], request: 2,
		});
		expect(older.references).toEqual(chat);
		expect(older.activeReference).toEqual(chat[1]);
	});

	it('ignores out-of-order snippet responses and errors', () => {
		const selected = referenceReducer(initialReferenceState, {
			type: 'select', references: chat, reference: chat[1], request: 2,
		});
		expect(referenceReducer(selected, { type: 'loaded', snippet, request: 1 })).toBe(selected);
		const loaded = referenceReducer(selected, { type: 'loaded', snippet, request: 2 });
		expect(referenceReducer(loaded, { type: 'failed', request: 1 })).toBe(loaded);
		expect(loaded.snippet).toEqual(snippet);
	});

	it('clears stale code on an error loading the selected file', () => {
		const selected = referenceReducer(initialReferenceState, {
			type: 'select', references: chat, reference: chat[0], request: 1,
		});
		const failed = referenceReducer(selected, { type: 'failed', request: 1 });
		expect(failed.snippet).toBeNull();
		expect(failed.loading).toBe(false);
		expect(failed.activeReference).toEqual(chat[0]);
	});

	it('clears both panels for empty results and invalidates an outstanding snippet', () => {
		const selected = referenceReducer(initialReferenceState, {
			type: 'select', references: chat, reference: chat[0], request: 1,
		});
		const empty = referenceReducer(selected, {
			type: 'select', references: [], reference: null, request: 2,
		});
		expect(empty).toMatchObject({ references: [], activeReference: null, snippet: null, loading: false });
		expect(referenceReducer(empty, { type: 'loaded', snippet, request: 1 })).toBe(empty);
	});

	it('restores only the latest answer, even when it contains no references', () => {
		expect(latestChatReferences([{ response: { references: chat } }, {}])).toEqual(chat);
		expect(latestChatReferences([
			{ response: { references: chat } }, { response: { references: [] } },
		])).toEqual([]);
		expect(latestChatReferences([])).toEqual([]);
	});

	it('distinguishes ranges sharing the same file and start line', () => {
		expect(sameReference(chat[0], reference('chat.ts'))).toBe(true);
		expect(sameReference(chat[0], reference('chat.ts', 100, 140))).toBe(false);
		expect(sameReference(null, chat[0])).toBe(false);
	});

	it('displays original file line numbers, including the surrounding context', () => {
		expect(snippetLineNumber(1, snippet)).toBe('95');
		expect(snippetLineNumber(6, snippet)).toBe('100');
		expect(snippetLineNumber(26, snippet)).toBe('120');
		expect(snippetLineNumber(1, null)).toBe('1');
	});
});
