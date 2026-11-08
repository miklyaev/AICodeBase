import type { CodeReference } from './types';

export interface CodeSnippet {
	content: string;
	startLine: number;
	endLine: number;
}

export interface ReferenceState {
	references: CodeReference[];
	activeReference: CodeReference | null;
	snippet: CodeSnippet | null;
	loading: boolean;
	request: number;
}

export const initialReferenceState: ReferenceState = {
	references: [], activeReference: null, snippet: null, loading: false, request: 0,
};

type ReferenceAction =
	| { type: 'select'; references: CodeReference[]; reference: CodeReference | null; request: number }
	| { type: 'loaded'; snippet: CodeSnippet; request: number }
	| { type: 'failed'; request: number };

export function sameReference(left: CodeReference | null, right: CodeReference): boolean {
	return left?.filePath === right.filePath
		&& left.startLine === right.startLine
		&& left.endLine === right.endLine;
}

export function referenceReducer(state: ReferenceState, action: ReferenceAction): ReferenceState {
	if (action.type === 'select') {
		return {
			references: action.references,
			activeReference: action.reference,
			snippet: null,
			loading: action.reference !== null,
			request: action.request,
		};
	}
	if (action.request !== state.request) return state;
	if (action.type === 'loaded') return { ...state, snippet: action.snippet, loading: false };
	return { ...state, snippet: null, loading: false };
}

export function latestChatReferences(messages: { response?: { references: CodeReference[] } }[]): CodeReference[] {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const response = messages[i].response;
		if (response) return response.references;
	}
	return [];
}

export function snippetLineNumber(line: number, snippet: CodeSnippet | null): string {
	return String(line + (snippet?.startLine ?? 1) - 1);
}
