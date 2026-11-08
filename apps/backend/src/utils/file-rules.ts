import path from 'node:path';

const EXCLUDED_DIRS = new Set([
	'node_modules',
	'.git',
	'dist',
	'build',
	'coverage',
	'.next',
	'.nuxt',
	'.turbo',
	'.cache',
	'.venv',
	'venv',
	'target',
]);

const TEXT_EXTENSIONS = new Set([
	'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.md', '.py',
	'.java', '.kt', '.go', '.rs', '.php', '.rb', '.cs', '.cpp', '.c', '.h', '.hpp', '.css',
	'.scss', '.html', '.vue', '.svelte', '.sql'
]);

const SECRET_FILE_NAMES = new Set(['.env', '.env.local', '.env.production', '.npmrc', 'password.txt']);

const BINARY_EXTENSIONS = new Set([
	'.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.mp4', '.mp3', '.wav', '.zip', '.tar', '.gz', '.pdf', '.exe', '.dll'
]);

export const MAX_FILE_SIZE_BYTES = 1024 * 1024;

export function shouldSkipDirectory(name: string) {
	return EXCLUDED_DIRS.has(name);
}

export function detectLanguage(filePath: string) {
	const ext = path.extname(filePath).toLowerCase();
	return ext.replace('.', '') || 'text';
}

export function isSecretFile(filePath: string) {
	return filePath.split(/[\\/]/).some((part) => {
		const name = part.toLowerCase();
		return SECRET_FILE_NAMES.has(name) || name.startsWith('.env') || name.includes('.env.') || name.startsWith('.llm-config-') ||
			/\.(pem|key|p12|crt)$/.test(name) || /^(credentials|serviceaccount).*\.json$/.test(name);
	});
}

export function isIndexableFile(fileName: string, fullPath: string) {
	if (isSecretFile(fileName) || isSecretFile(fullPath)) return false;

	const ext = path.extname(fullPath).toLowerCase();
	if (BINARY_EXTENSIONS.has(ext)) return false;

	if (fileName === 'env.example' || fileName.endsWith('.env.example')) {
		return true;
	}

	return TEXT_EXTENSIONS.has(ext);
}
