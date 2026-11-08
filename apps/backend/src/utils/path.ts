import fs from 'node:fs';
import path from 'node:path';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

const FORBIDDEN_ROOTS = new Set(['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)']);

export function ensureDirectoryExists(dirPath: string): string {
	const normalized = path.resolve(dirPath);
	if (!fs.existsSync(normalized)) {
		throw new BadRequestException({ code: 'PATH_NOT_FOUND', message: 'Указанный путь не существует' });
	}

	const stat = fs.statSync(normalized);
	if (!stat.isDirectory()) {
		throw new BadRequestException({ code: 'PATH_NOT_DIRECTORY', message: 'Путь должен быть директорией' });
	}

	if (FORBIDDEN_ROOTS.has(normalized)) {
		throw new ForbiddenException({ code: 'PATH_FORBIDDEN', message: 'Эта директория запрещена для индексации' });
	}

	return normalized;
}

export function safeResolveInsideRoot(rootPath: string, relativePath: string): string {
	const resolved = path.resolve(rootPath, relativePath);
	const normalizedRoot = path.resolve(rootPath);
	const assertContained = (root: string, target: string) => {
		const relative = path.relative(root, target);
		if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
			throw new ForbiddenException({ code: 'PATH_TRAVERSAL', message: 'Недопустимый путь вне project root' });
		}
	};
	assertContained(normalizedRoot, resolved);
	// Resolve existing ancestors too: a missing child must not conceal a symlink escape.
	const canonical = (target: string): string => {
		if (fs.existsSync(target)) return fs.realpathSync(target);
		const parent = path.dirname(target);
		if (parent === target) return target;
		return path.join(canonical(parent), path.basename(target));
	};
	const canonicalRoot = canonical(normalizedRoot);
	const canonicalTarget = canonical(resolved);
	assertContained(canonicalRoot, canonicalTarget);
	return canonicalTarget;
}
