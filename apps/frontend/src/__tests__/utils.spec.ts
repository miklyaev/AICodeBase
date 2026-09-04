import { describe, it, expect } from 'vitest';

function toMonacoLanguage(lang?: string): string {
	switch ((lang ?? '').toLowerCase()) {
		case 'ts':
		case 'tsx':
			return 'typescript';
		case 'js':
		case 'jsx':
			return 'javascript';
		case 'py':
			return 'python';
		case 'rs':
			return 'rust';
		case 'go':
			return 'go';
		case 'cs':
			return 'csharp';
		case 'cpp':
		case 'c':
		case 'h':
		case 'hpp':
			return 'cpp';
		case 'md':
			return 'markdown';
		case 'yaml':
		case 'yml':
			return 'yaml';
		default:
			return 'plaintext';
	}
}

function normalizeEnvUrl(value: unknown): string {
	if (typeof value !== 'string' || !value) return '';
	return value.replace(/^\s*['"](.*)['"]\s*$/, '$1');
}

describe('toMonacoLanguage', () => {
	it('should map ts to typescript', () => {
		expect(toMonacoLanguage('ts')).toBe('typescript');
	});

	it('should map tsx to typescript', () => {
		expect(toMonacoLanguage('tsx')).toBe('typescript');
	});

	it('should map js to javascript', () => {
		expect(toMonacoLanguage('js')).toBe('javascript');
	});

	it('should map jsx to javascript', () => {
		expect(toMonacoLanguage('jsx')).toBe('javascript');
	});

	it('should map py to python', () => {
		expect(toMonacoLanguage('py')).toBe('python');
	});

	it('should map rs to rust', () => {
		expect(toMonacoLanguage('rs')).toBe('rust');
	});

	it('should map go to go', () => {
		expect(toMonacoLanguage('go')).toBe('go');
	});

	it('should map cs to csharp', () => {
		expect(toMonacoLanguage('cs')).toBe('csharp');
	});

	it('should map cpp to cpp', () => {
		expect(toMonacoLanguage('cpp')).toBe('cpp');
	});

	it('should map c to cpp', () => {
		expect(toMonacoLanguage('c')).toBe('cpp');
	});

	it('should map h to cpp', () => {
		expect(toMonacoLanguage('h')).toBe('cpp');
	});

	it('should map hpp to cpp', () => {
		expect(toMonacoLanguage('hpp')).toBe('cpp');
	});

	it('should map md to markdown', () => {
		expect(toMonacoLanguage('md')).toBe('markdown');
	});

	it('should map yaml to yaml', () => {
		expect(toMonacoLanguage('yaml')).toBe('yaml');
	});

	it('should map yml to yaml', () => {
		expect(toMonacoLanguage('yml')).toBe('yaml');
	});

	it('should return plaintext for unknown', () => {
		expect(toMonacoLanguage('xyz')).toBe('plaintext');
	});

	it('should return plaintext for undefined', () => {
		expect(toMonacoLanguage(undefined)).toBe('plaintext');
	});

	it('should return plaintext for empty string', () => {
		expect(toMonacoLanguage('')).toBe('plaintext');
	});

	it('should be case-insensitive', () => {
		expect(toMonacoLanguage('TS')).toBe('typescript');
		expect(toMonacoLanguage('Py')).toBe('python');
		expect(toMonacoLanguage('GO')).toBe('go');
	});
});

describe('normalizeEnvUrl', () => {
	it('should strip double quotes', () => {
		expect(normalizeEnvUrl('"http://localhost:3001"')).toBe('http://localhost:3001');
	});

	it('should strip single quotes', () => {
		expect(normalizeEnvUrl("'http://localhost:3001'")).toBe('http://localhost:3001');
	});

	it('should return unchanged string without quotes', () => {
		expect(normalizeEnvUrl('http://localhost:3001')).toBe('http://localhost:3001');
	});

	it('should return empty string for null', () => {
		expect(normalizeEnvUrl(null)).toBe('');
	});

	it('should return empty string for undefined', () => {
		expect(normalizeEnvUrl(undefined)).toBe('');
	});

	it('should return empty string for empty string', () => {
		expect(normalizeEnvUrl('')).toBe('');
	});

	it('should return empty string for number', () => {
		expect(normalizeEnvUrl(42)).toBe('');
	});

	it('should strip surrounding whitespace and quotes', () => {
		expect(normalizeEnvUrl('  "value"  ')).toBe('value');
	});
});
