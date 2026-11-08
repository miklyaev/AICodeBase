import 'reflect-metadata';
import { INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SettingsController } from '../settings.controller';
import { SettingsService } from '../../services/settings.service';
import { AdminAuthService } from '../../services/admin-auth.service';
import { IndexLifecycleService } from '../../services/index-lifecycle.service';

const settings = { hasApiKey: jest.fn(() => false), setApiKey: jest.fn() };
const lifecycle = {
	getStatus: jest.fn(async () => ({ embeddingModel: 'new', storedEmbeddingModel: null, requiresReset: true, indexedProjects: 2, indexedChunks: 3 })),
	reset: jest.fn(async () => ({ success: true })),
};
@Module({ controllers: [SettingsController], providers: [AdminAuthService, { provide: SettingsService, useValue: settings }, { provide: IndexLifecycleService, useValue: lifecycle }] })
class SettingsTestModule { }

describe('settings HTTP auth (no AppModule, database or dotenv)', () => {
	let app: INestApplication;
	let url: string;
	const original = { ...process.env };
	beforeAll(async () => {
		process.env.ADMIN_LOGIN = 'synthetic-admin';
		process.env.ADMIN_PASSWORD = 'synthetic-password';
		app = await NestFactory.create(SettingsTestModule, { logger: false });
		app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
		await app.listen(0, '127.0.0.1');
		url = await app.getUrl();
	});
	afterAll(async () => { await app?.close(); process.env = { ...original }; });

	const post = (route: string, body: unknown, token?: string) => fetch(`${url}/api/settings${route}`, {
		method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
	});

	it('authorizes index status/reset and accepts only explicit boolean confirmation', async () => {
		expect((await fetch(`${url}/api/settings/indexes/status`)).status).toBe(401);
		expect((await post('/indexes/reset', { confirm: true })).status).toBe(401);
		expect(lifecycle.getStatus).not.toHaveBeenCalled();
		expect(lifecycle.reset).not.toHaveBeenCalled();
		const session = await (await post('/admin/login', { login: 'synthetic-admin', password: 'synthetic-password' })).json() as { token: string };
		for (const body of [{}, { confirm: false }, { confirm: 'true' }, { confirm: 1 }]) {
			expect((await post('/indexes/reset', body, session.token)).status).toBe(400);
		}
		expect(lifecycle.reset).not.toHaveBeenCalled();
		const status = await fetch(`${url}/api/settings/indexes/status`, { headers: { Authorization: `Bearer ${session.token}` } });
		expect(await status.json()).toEqual({ embeddingModel: 'new', storedEmbeddingModel: null, requiresReset: true, indexedProjects: 2, indexedChunks: 3 });
		expect(await (await post('/indexes/reset', { confirm: true }, session.token)).json()).toEqual({ success: true });
		expect(lifecycle.reset).toHaveBeenCalledTimes(1);
		await post('/admin/logout', {}, session.token);
		expect((await post('/indexes/reset', { confirm: true }, session.token)).status).toBe(401);
	});

	it('protects key writes, removes old endpoint, issues and revokes sessions', async () => {
		const key = { apiKey: 'synthetic-api-key-123456789' };
		expect((await post('/api-key', key)).status).toBe(401);
		expect((await post('/openrouter-key', key)).status).toBe(404);
		expect(await (await fetch(`${url}/api/settings/status`)).json()).toEqual({ hasApiKey: false });
		expect((await post('/admin/login', { login: 'synthetic-admin', password: 'wrong' })).status).toBe(401);
		const login = await post('/admin/login', { login: 'synthetic-admin', password: 'synthetic-password' });
		const session = await login.json() as { token: string; expiresAt: number };
		expect(session.token).toMatch(/^[a-f0-9]{64}$/);
		expect(session.expiresAt).toBeGreaterThan(Date.now());
		expect((await post('/api-key', { apiKey: 'bad' }, session.token)).status).toBe(400);
		expect(await (await post('/api-key', key, session.token)).json()).toEqual({ success: true });
		expect(settings.setApiKey).toHaveBeenCalledWith(key.apiKey);
		expect(await (await post('/admin/logout', {}, session.token)).json()).toEqual({ success: true });
		expect((await post('/api-key', key, session.token)).status).toBe(401);
	});
});
