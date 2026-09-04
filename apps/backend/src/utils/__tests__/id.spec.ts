import { makeId, sha256 } from '../id';

describe('makeId', () => {
	it('should return a valid UUID format', () => {
		const id = makeId();
		expect(id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
		);
	});

	it('should return unique values', () => {
		const ids = new Set(Array.from({ length: 100 }, () => makeId()));
		expect(ids.size).toBe(100);
	});
});

describe('sha256', () => {
	it('should hash "hello" correctly', () => {
		expect(sha256('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
	});

	it('should hash empty string', () => {
		expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
	});

	it('should be deterministic', () => {
		const a = sha256('test-input');
		const b = sha256('test-input');
		expect(a).toBe(b);
	});

	it('should produce different hashes for different inputs', () => {
		const a = sha256('input-a');
		const b = sha256('input-b');
		expect(a).not.toBe(b);
	});

	it('should return 64 character hex string', () => {
		const hash = sha256('anything');
		expect(hash).toHaveLength(64);
		expect(hash).toMatch(/^[0-9a-f]+$/);
	});
});
