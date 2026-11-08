import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import * as dotenv from 'dotenv';

export function findRepositoryRoot(start = __dirname): string {
	let directory = path.resolve(start);
	while (true) {
		if (fs.existsSync(path.join(directory, 'apps', 'backend', 'package.json'))) return directory;
		const parent = path.dirname(directory);
		if (parent === directory) throw new Error('Repository root not found');
		directory = parent;
	}
}

export function getBackendDirectory(root = findRepositoryRoot()): string {
	return path.join(root, 'apps', 'backend');
}

export function getBackendEnvPath(root = findRepositoryRoot()): string {
	return path.join(getBackendDirectory(root), '.env');
}

export function loadEnvironment() {
	const result = dotenv.config({ path: getBackendEnvPath(), ...{ quiet: true } });
	if (result.error && (result.error as NodeJS.ErrnoException).code !== 'ENOENT') {
		throw new Error('Cannot load server configuration');
	}
}

export function replaceApiKey(contents: string, apiKey: string): string {
	const assignment = /^([ \t]*(?:export[ \t]+)?)([\w.-]+)([ \t]*=[ \t]*)(?:"(?:\\[\s\S]|[^"\\])*"|'[^']*'|`[^`]*`|[^#\r\n]*)/gm;
	let found = false;
	const updated = contents.replace(assignment, (original, prefix: string, name: string, equals: string) => {
		if (name !== 'LLM_API_KEY') return original;
		found = true;
		const trailingSpace = original.match(/[ \t]+$/)?.[0] ?? '';
		return `${prefix}${name}${equals}"${apiKey}"${trailingSpace}`;
	});
	if (found) return updated;
	const newline = contents.includes('\r\n') ? '\r\n' : '\n';
	return `${contents}${contents && !contents.endsWith('\n') ? newline : ''}LLM_API_KEY="${apiKey}"${newline}`;
}

// A same-directory rename preserves the previous file if the write/replace fails.
// In particular, never unlink the destination as a Windows rename fallback.
export function persistApiKey(apiKey: string, root = findRepositoryRoot()) {
	const destination = getBackendEnvPath(root);
	let contents = '';
	try {
		const stat = fs.lstatSync(destination);
		if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe configuration file');
		contents = fs.readFileSync(destination, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
	const temporary = path.join(getBackendDirectory(root), `.llm-config-${randomBytes(16).toString('hex')}.tmp`);
	let descriptor: number | undefined;
	try {
		descriptor = fs.openSync(temporary, 'wx', 0o600);
		fs.writeFileSync(descriptor, replaceApiKey(contents, apiKey), 'utf8');
		fs.fsyncSync(descriptor);
		fs.closeSync(descriptor);
		descriptor = undefined;
		try {
			fs.renameSync(temporary, destination);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EBUSY') throw error;
			// Docker single-file bind mounts cannot be renamed. Retain an original
			// backup until both writing+fsync or restoration has succeeded.
			const backup = `${temporary}.backup`;
			fs.writeFileSync(backup, contents, { flag: 'wx', mode: 0o600 });
			const writeInPlace = (value: string) => {
				const fd = fs.openSync(destination, 'r+');
				try {
					fs.writeFileSync(fd, value, 'utf8');
					fs.ftruncateSync(fd, Buffer.byteLength(value, 'utf8'));
					fs.fsyncSync(fd);
				} finally {
					fs.closeSync(fd);
				}
			};
			try {
				writeInPlace(replaceApiKey(contents, apiKey));
			} catch (writeError) {
				try {
					writeInPlace(contents);
					fs.unlinkSync(backup);
				} catch {
					// Leave the private backup for an administrator to restore.
				}
				throw writeError;
			}
			try { fs.unlinkSync(backup); } catch { /* The committed key must remain active. */ }
		}
	} finally {
		if (descriptor !== undefined) fs.closeSync(descriptor);
		try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { /* Private orphan cleanup is best-effort. */ }
	}
}
