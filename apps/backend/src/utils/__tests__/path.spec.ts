import { safeResolveInsideRoot } from '../path';
import { ForbiddenException } from '@nestjs/common';

describe('safeResolveInsideRoot', () => {
	it('should resolve valid relative path inside root', () => {
		const result = safeResolveInsideRoot('/project', 'src/index.ts');
		expect(result).toContain('src/index.ts');
		expect(result.startsWith('/project')).toBe(true);
	});

	it('should resolve path with leading slash as relative', () => {
		const result = safeResolveInsideRoot('/project', 'src/file.ts');
		expect(result).toContain('src/file.ts');
	});

	it('should throw on path traversal with ..', () => {
		expect(() => {
			safeResolveInsideRoot('/project', '../etc/passwd');
		}).toThrow(ForbiddenException);
	});

	it('should throw on double traversal', () => {
		expect(() => {
			safeResolveInsideRoot('/project', '../../etc/passwd');
		}).toThrow(ForbiddenException);
	});

	it('should throw on traversal embedded in path', () => {
		expect(() => {
			safeResolveInsideRoot('/project', 'src/../../etc/passwd');
		}).toThrow(ForbiddenException);
	});

	it('should resolve nested valid path', () => {
		const result = safeResolveInsideRoot('/project', 'src/components/Button.tsx');
		expect(result).toContain('src/components/Button.tsx');
	});

	it('should resolve current directory reference', () => {
		const result = safeResolveInsideRoot('/project', './src/index.ts');
		expect(result).toContain('src/index.ts');
	});

	it('should throw ForbiddenException with correct code', () => {
		try {
			safeResolveInsideRoot('/project', '../escape');
			fail('Should have thrown');
		} catch (e) {
			expect(e).toBeInstanceOf(ForbiddenException);
			expect((e as any).getResponse()).toEqual(
				expect.objectContaining({ code: 'PATH_TRAVERSAL' })
			);
		}
	});
});
