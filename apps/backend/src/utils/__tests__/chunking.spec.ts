import { chunkText } from '../chunking';

describe('chunkText', () => {
	it('should return single chunk with empty content for empty string', () => {
		const result = chunkText('');
		expect(result).toHaveLength(1);
		expect(result[0].content).toBe('');
		expect(result[0].startLine).toBe(1);
		expect(result[0].endLine).toBe(1);
	});

	it('should return single chunk for short content', () => {
		const result = chunkText('line1\nline2\nline3');
		expect(result).toHaveLength(1);
		expect(result[0].chunkIndex).toBe(0);
		expect(result[0].startLine).toBe(1);
		expect(result[0].endLine).toBe(3);
		expect(result[0].content).toBe('line1\nline2\nline3');
	});

	it('should split content into chunks of maxLines', () => {
		const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
		const content = lines.join('\n');
		const result = chunkText(content, 80, 15);

		expect(result.length).toBeGreaterThanOrEqual(2);
		expect(result[0].startLine).toBe(1);
		expect(result[0].endLine).toBe(80);
	});

	it('should apply overlap between chunks', () => {
		const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
		const content = lines.join('\n');
		const result = chunkText(content, 80, 15);

		if (result.length >= 2) {
			const secondStart = result[1].startLine;
			expect(secondStart).toBeLessThanOrEqual(80);
			expect(secondStart).toBeGreaterThan(1);
		}
	});

	it('should set correct chunkIndex', () => {
		const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`);
		const content = lines.join('\n');
		const result = chunkText(content, 80, 15);

		result.forEach((chunk, i) => {
			expect(chunk.chunkIndex).toBe(i);
		});
	});

	it('should detect function symbol', () => {
		const content = Array.from({ length: 80 }, (_, i) =>
			i === 5 ? 'function myFunc() {' : `line ${i}`
		).join('\n');
		const result = chunkText(content, 80, 15);

		expect(result[0].symbolName).toBe('myFunc');
	});

	it('should detect class symbol', () => {
		const content = Array.from({ length: 80 }, (_, i) =>
			i === 10 ? 'class MyClass {' : `line ${i}`
		).join('\n');
		const result = chunkText(content, 80, 15);

		expect(result[0].symbolName).toBe('MyClass');
	});

	it('should detect const arrow function', () => {
		const content = Array.from({ length: 80 }, (_, i) =>
			i === 3 ? 'const myArrow = () => {' : `line ${i}`
		).join('\n');
		const result = chunkText(content, 80, 15);

		expect(result[0].symbolName).toBe('myArrow');
	});

	it('should detect export const', () => {
		const content = Array.from({ length: 80 }, (_, i) =>
			i === 0 ? 'export const MY_CONST = 42;' : `line ${i}`
		).join('\n');
		const result = chunkText(content, 80, 15);

		expect(result[0].symbolName).toBe('MY_CONST');
	});

	it('should return empty symbolName when no symbol found', () => {
		const content = Array.from({ length: 10 }, (_, i) => `just text line ${i}`).join('\n');
		const result = chunkText(content, 80, 15);

		expect(result[0].symbolName).toBe('');
	});

	it('should use last detected symbol in chunk', () => {
		const lines = Array.from({ length: 80 }, (_, i) => {
			if (i === 2) return 'function first() {';
			if (i === 50) return 'function second() {';
			return `line ${i}`;
		});
		const result = chunkText(lines.join('\n'), 80, 15);

		expect(result[0].symbolName).toBe('second');
	});

	it('should handle single line content', () => {
		const result = chunkText('only one line', 80, 15);
		expect(result).toHaveLength(1);
		expect(result[0].startLine).toBe(1);
		expect(result[0].endLine).toBe(1);
	});

	it('should handle content with Windows line endings', () => {
		const content = 'line1\r\nline2\r\nline3';
		const result = chunkText(content, 80, 15);
		expect(result).toHaveLength(1);
		expect(result[0].content).toBe('line1\nline2\nline3');
	});

	it('should handle exact multiple of maxLines', () => {
		const lines = Array.from({ length: 80 }, (_, i) => `line ${i}`);
		const result = chunkText(lines.join('\n'), 80, 15);
		expect(result).toHaveLength(1);
		expect(result[0].endLine).toBe(80);
	});
});
