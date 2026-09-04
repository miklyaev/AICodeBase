import { shouldSkipDirectory, detectLanguage, isIndexableFile, MAX_FILE_SIZE_BYTES } from '../file-rules';

describe('shouldSkipDirectory', () => {
	it('should skip node_modules', () => {
		expect(shouldSkipDirectory('node_modules')).toBe(true);
	});

	it('should skip .git', () => {
		expect(shouldSkipDirectory('.git')).toBe(true);
	});

	it('should skip dist', () => {
		expect(shouldSkipDirectory('dist')).toBe(true);
	});

	it('should skip build', () => {
		expect(shouldSkipDirectory('build')).toBe(true);
	});

	it('should skip venv', () => {
		expect(shouldSkipDirectory('venv')).toBe(true);
	});

	it('should skip .venv', () => {
		expect(shouldSkipDirectory('.venv')).toBe(true);
	});

	it('should not skip src', () => {
		expect(shouldSkipDirectory('src')).toBe(false);
	});

	it('should not skip app', () => {
		expect(shouldSkipDirectory('app')).toBe(false);
	});

	it('should not skip empty string', () => {
		expect(shouldSkipDirectory('')).toBe(false);
	});
});

describe('detectLanguage', () => {
	it('should detect .ts', () => {
		expect(detectLanguage('file.ts')).toBe('ts');
	});

	it('should detect .tsx', () => {
		expect(detectLanguage('file.tsx')).toBe('tsx');
	});

	it('should detect .js', () => {
		expect(detectLanguage('file.js')).toBe('js');
	});

	it('should detect .py', () => {
		expect(detectLanguage('main.py')).toBe('py');
	});

	it('should detect .go', () => {
		expect(detectLanguage('server.go')).toBe('go');
	});

	it('should detect .rs', () => {
		expect(detectLanguage('lib.rs')).toBe('rs');
	});

	it('should return text for no extension', () => {
		expect(detectLanguage('Makefile')).toBe('text');
	});

	it('should handle uppercase extension', () => {
		expect(detectLanguage('file.TS')).toBe('ts');
	});

	it('should handle nested path', () => {
		expect(detectLanguage('src/components/Button.tsx')).toBe('tsx');
	});
});

describe('isIndexableFile', () => {
	it('should reject .env', () => {
		expect(isIndexableFile('.env', '/project/.env')).toBe(false);
	});

	it('should reject .env.local', () => {
		expect(isIndexableFile('.env.local', '/project/.env.local')).toBe(false);
	});

	it('should reject .env.production', () => {
		expect(isIndexableFile('.env.production', '/project/.env.production')).toBe(false);
	});

	it('should reject .npmrc', () => {
		expect(isIndexableFile('.npmrc', '/project/.npmrc')).toBe(false);
	});

	it('should reject files with .env. in name', () => {
		expect(isIndexableFile('docker.env.dev', '/project/docker.env.dev')).toBe(false);
	});

	it('should reject .pem files', () => {
		expect(isIndexableFile('cert.pem', '/project/cert.pem')).toBe(false);
	});

	it('should reject .key files', () => {
		expect(isIndexableFile('server.key', '/project/server.key')).toBe(false);
	});

	it('should reject .p12 files', () => {
		expect(isIndexableFile('cert.p12', '/project/cert.p12')).toBe(false);
	});

	it('should reject .crt files', () => {
		expect(isIndexableFile('ca.crt', '/project/ca.crt')).toBe(false);
	});

	it('should reject binary .png', () => {
		expect(isIndexableFile('image.png', '/project/image.png')).toBe(false);
	});

	it('should reject binary .jpg', () => {
		expect(isIndexableFile('photo.jpg', '/project/photo.jpg')).toBe(false);
	});

	it('should reject binary .zip', () => {
		expect(isIndexableFile('archive.zip', '/project/archive.zip')).toBe(false);
	});

	it('should reject binary .pdf', () => {
		expect(isIndexableFile('doc.pdf', '/project/doc.pdf')).toBe(false);
	});

	it('should accept env.example', () => {
		expect(isIndexableFile('env.example', '/project/env.example')).toBe(true);
	});

	it('should accept .ts files', () => {
		expect(isIndexableFile('index.ts', '/project/index.ts')).toBe(true);
	});

	it('should accept .tsx files', () => {
		expect(isIndexableFile('App.tsx', '/project/App.tsx')).toBe(true);
	});

	it('should accept .js files', () => {
		expect(isIndexableFile('app.js', '/project/app.js')).toBe(true);
	});

	it('should accept .py files', () => {
		expect(isIndexableFile('main.py', '/project/main.py')).toBe(true);
	});

	it('should accept .md files', () => {
		expect(isIndexableFile('README.md', '/project/README.md')).toBe(true);
	});

	it('should accept .json files', () => {
		expect(isIndexableFile('package.json', '/project/package.json')).toBe(true);
	});

	it('should accept .yaml files', () => {
		expect(isIndexableFile('config.yaml', '/project/config.yaml')).toBe(true);
	});

	it('should accept .go files', () => {
		expect(isIndexableFile('main.go', '/project/main.go')).toBe(true);
	});

	it('should accept .rs files', () => {
		expect(isIndexableFile('lib.rs', '/project/lib.rs')).toBe(true);
	});

	it('should accept .sql files', () => {
		expect(isIndexableFile('schema.sql', '/project/schema.sql')).toBe(true);
	});

	it('should reject unknown extension', () => {
		expect(isIndexableFile('file.xyz', '/project/file.xyz')).toBe(false);
	});

	it('should be case-insensitive for secret names', () => {
		expect(isIndexableFile('.ENV', '/project/.ENV')).toBe(false);
	});
});

describe('MAX_FILE_SIZE_BYTES', () => {
	it('should be 1MB', () => {
		expect(MAX_FILE_SIZE_BYTES).toBe(1024 * 1024);
	});
});
