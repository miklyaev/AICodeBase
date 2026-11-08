import { validate } from 'class-validator';
import { SettingsService } from '../settings.service';
import { persistApiKey } from '../../config/environment';
import { AdminLoginDto, SetApiKeyDto } from '../../dto/settings.dto';

jest.mock('../../config/environment', () => ({ persistApiKey: jest.fn() }));

describe('SettingsService', () => {
	const original = { ...process.env };
	beforeEach(() => { delete process.env.LLM_API_KEY; jest.clearAllMocks(); });
	afterEach(() => { process.env = { ...original }; });

	it('does not use legacy provider credentials and reports missing key safely', () => {
		process.env.OPENROUTER_API_KEY = 'legacy-server-key';
		const settings = new SettingsService();
		expect(settings.hasApiKey()).toBe(false);
		expect(() => settings.getApiKeyOrThrow()).toThrow();
	});

	it('persists before changing memory and process environment', () => {
		const settings = new SettingsService();
		jest.mocked(persistApiKey).mockImplementationOnce(() => {
			expect(settings.hasApiKey()).toBe(false);
			expect(process.env.LLM_API_KEY).toBeUndefined();
		});
		settings.setApiKey('synthetic-api-key-123456789');
		expect(settings.getApiKeyOrThrow()).toBe('synthetic-api-key-123456789');
		expect(process.env.LLM_API_KEY).toBe('synthetic-api-key-123456789');
	});

	it('retains old memory and hides disk errors on write failure', () => {
		process.env.LLM_API_KEY = 'previous-synthetic-key';
		const settings = new SettingsService();
		jest.mocked(persistApiKey).mockImplementationOnce(() => { throw new Error('sensitive disk content'); });
		expect(() => settings.setApiKey('synthetic-api-key-123456789')).toThrow('Не удалось сохранить настройки сервера');
		expect(settings.getApiKeyOrThrow()).toBe('previous-synthetic-key');
		expect(process.env.LLM_API_KEY).toBe('previous-synthetic-key');
	});

	it('rejects env injection and excessively long keys before disk access', () => {
		const settings = new SettingsService();
		for (const key of ['short', 'x'.repeat(4097), 'key-123456789012345678\nADMIN_LOGIN=attacker', 'key-123456789012345678"']) {
			expect(() => settings.setApiKey(key)).toThrow();
		}
		expect(persistApiKey).not.toHaveBeenCalled();
	});

	it('bounds DTO strings', async () => {
		for (const value of ['', 'x'.repeat(4097), 'a\nb']) {
			expect((await validate(Object.assign(new SetApiKeyDto(), { apiKey: value }))).length).toBeGreaterThan(0);
		}
		expect(await validate(Object.assign(new SetApiKeyDto(), { apiKey: 'synthetic-api-key-123456789' }))).toHaveLength(0);
		expect((await validate(Object.assign(new AdminLoginDto(), { login: 'x'.repeat(129), password: 'x'.repeat(1025) }))).length).toBe(2);
	});
});
