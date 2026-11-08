import fs from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';
import { findRepositoryRoot, getBackendDirectory, getBackendEnvPath, loadEnvironment, persistApiKey, replaceApiKey } from '../environment';

jest.mock('node:fs', () => ({ __esModule: true, default: {
	existsSync: jest.fn(), lstatSync: jest.fn(), readFileSync: jest.fn(), openSync: jest.fn(), writeFileSync: jest.fn(),
	fsyncSync: jest.fn(), closeSync: jest.fn(), renameSync: jest.fn(), unlinkSync: jest.fn(), ftruncateSync: jest.fn(),
} }));
jest.mock('dotenv', () => ({ config: jest.fn(() => ({})) }));

describe('environment (synthetic filesystem only)', () => {
	beforeEach(() => {
		jest.resetAllMocks();
		jest.mocked(fs.existsSync).mockReturnValue(true);
		jest.mocked(fs.lstatSync).mockReturnValue({ isFile: () => true, isSymbolicLink: () => false } as any);
		jest.mocked(fs.readFileSync).mockReturnValue('OTHER="unchanged"\r\nLLM_API_KEY=previous\r\n');
		jest.mocked(fs.openSync).mockReturnValue(10);
		jest.mocked(dotenv.config).mockReturnValue({});
	});

	it('preserves comments, unrelated values, whitespace and multiline assignments', () => {
		const before = '# comment\r\nADMIN_PASSWORD="first\nLLM_API_KEY=inside-password\nlast"\r\nOTHER=abc # keep\r\n  export LLM_API_KEY = old\r\n';
		expect(replaceApiKey(before, 'new')).toBe('# comment\r\nADMIN_PASSWORD="first\nLLM_API_KEY=inside-password\nlast"\r\nOTHER=abc # keep\r\n  export LLM_API_KEY = "new"\r\n');
		expect(replaceApiKey('OTHER=value', 'new')).toBe('OTHER=value\nLLM_API_KEY="new"\n');
	});

	it('updates duplicate and multiline key assignments', () => {
		expect(replaceApiKey('LLM_API_KEY="old\nvalue"\nLLM_API_KEY=duplicate\n', 'new')).toBe('LLM_API_KEY="new"\nLLM_API_KEY="new"\n');
	});

	it.each(['src', 'dist'])('finds repository root independent of %s launch folder', (folder) => {
		const root = path.resolve('synthetic-root');
		jest.mocked(fs.existsSync).mockImplementation((target) => String(target) === path.join(root, 'apps', 'backend', 'package.json'));
		expect(findRepositoryRoot(path.join(root, 'apps', 'backend', folder, 'config'))).toBe(root);
	});

	it('loads only backend dotenv independently of the working directory', () => {
		const root = path.resolve('synthetic-root');
		jest.mocked(fs.existsSync).mockImplementation((target) => String(target) === path.join(root, 'apps', 'backend', 'package.json'));
		expect(getBackendDirectory(root)).toBe(path.join(root, 'apps', 'backend'));
		expect(getBackendEnvPath(root)).toBe(path.join(root, 'apps', 'backend', '.env'));
		// Root discovery starts at the module, not process.cwd().
		jest.mocked(fs.existsSync).mockReturnValue(true);
		loadEnvironment();
		expect(dotenv.config).toHaveBeenCalledTimes(1);
		expect(dotenv.config).toHaveBeenCalledWith(expect.objectContaining({ path: path.join(getBackendDirectory(), '.env') }));
	});

	it('uses a private synced sibling followed by atomic rename', () => {
		persistApiKey('synthetic', path.resolve('synthetic-root'));
		expect(fs.openSync).toHaveBeenCalledWith(expect.stringMatching(/\.llm-config-.*\.tmp$/), 'wx', 0o600);
		expect(fs.fsyncSync).toHaveBeenCalledWith(10);
		expect(fs.renameSync).toHaveBeenCalledTimes(1);
		const [temporary, destination] = jest.mocked(fs.renameSync).mock.calls[0];
		expect(path.dirname(String(temporary))).toBe(path.resolve('synthetic-root', 'apps', 'backend'));
		expect(destination).toBe(path.resolve('synthetic-root', 'apps', 'backend', '.env'));
		expect(jest.mocked(fs.fsyncSync).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(fs.renameSync).mock.invocationCallOrder[0]);
	});

	it('supports Docker EBUSY using an original backup and fsync in place', () => {
		jest.mocked(fs.renameSync).mockImplementation(() => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); });
		persistApiKey('synthetic', path.resolve('synthetic-root'));
		expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringMatching(/\.backup$/), expect.stringContaining('LLM_API_KEY=previous'), { flag: 'wx', mode: 0o600 });
		expect(fs.openSync).toHaveBeenCalledWith(expect.stringMatching(/\.env$/), 'r+');
		expect(fs.ftruncateSync).toHaveBeenCalled();
	});

	it('does not turn a committed write into failure when orphan cleanup fails', () => {
		jest.mocked(fs.renameSync).mockImplementation(() => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); });
		jest.mocked(fs.unlinkSync).mockImplementation(() => { throw new Error('cleanup denied'); });
		expect(() => persistApiKey('synthetic', path.resolve('synthetic-root'))).not.toThrow();
	});

	it('restores the original content after an in-place write failure', () => {
		jest.mocked(fs.renameSync).mockImplementation(() => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); });
		jest.mocked(fs.writeFileSync).mockImplementationOnce(() => undefined).mockImplementationOnce(() => undefined).mockImplementationOnce(() => { throw new Error('write failed'); });
		expect(() => persistApiKey('synthetic', path.resolve('synthetic-root'))).toThrow('write failed');
		expect(fs.writeFileSync).toHaveBeenLastCalledWith(10, 'OTHER="unchanged"\r\nLLM_API_KEY=previous\r\n', 'utf8');
	});

	it('never falls back for EACCES or removes the old destination', () => {
		jest.mocked(fs.renameSync).mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); });
		expect(() => persistApiKey('synthetic', path.resolve('synthetic-root'))).toThrow('denied');
		expect(fs.openSync).not.toHaveBeenCalledWith(expect.stringMatching(/\.env$/), 'r+');
		expect(fs.unlinkSync).not.toHaveBeenCalledWith(expect.stringMatching(/\.env$/));
	});

	it('rejects symlink destinations', () => {
		jest.mocked(fs.lstatSync).mockReturnValue({ isFile: () => false, isSymbolicLink: () => true } as any);
		expect(() => persistApiKey('synthetic', path.resolve('synthetic-root'))).toThrow();
		expect(fs.readFileSync).not.toHaveBeenCalled();
	});
});
