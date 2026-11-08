import { AdminAuthService } from '../admin-auth.service';

describe('AdminAuthService', () => {
	let auth: AdminAuthService;
	const original = { ...process.env };
	beforeEach(() => {
		process.env.ADMIN_LOGIN = 'test-admin';
		process.env.ADMIN_PASSWORD = 'test-password';
		auth = new AdminAuthService();
		jest.useFakeTimers();
	});
	afterEach(() => { process.env = { ...original }; jest.useRealTimers(); });

	it('issues 32-byte tokens, one-hour expiry, and revokes on logout', () => {
		const session = auth.login('test-admin', 'test-password', 'client');
		expect(session.token).toMatch(/^[a-f0-9]{64}$/);
		expect(session.expiresAt).toBe(Date.now() + 3600000);
		expect(auth.authorize(`Bearer ${session.token}`)).toBeTruthy();
		auth.logout(`Bearer ${session.token}`);
		expect(() => auth.authorize(`Bearer ${session.token}`)).toThrow();
	});

	it('expires sessions and rejects absent/malformed tokens', () => {
		const { token } = auth.login('test-admin', 'test-password', 'client');
		jest.advanceTimersByTime(3600000);
		for (const header of [undefined, '', 'Bearer invalid', `Bearer ${token}`]) expect(() => auth.authorize(header)).toThrow();
	});

	it('has no default credentials', () => {
		delete process.env.ADMIN_LOGIN;
		delete process.env.ADMIN_PASSWORD;
		expect(() => auth.login('admin', 'admin', 'client')).toThrow(expect.objectContaining({ status: 503 }));
	});

	it('rejects wrong credentials without echoing values', () => {
		try { auth.login('test-admin', 'private-invalid', 'client'); } catch (error) {
			expect(JSON.stringify(error)).not.toMatch(/test-admin|test-password|private-invalid/);
		}
	});

	it('limits attempts by client, resets the window and caps sessions', () => {
		for (let i = 0; i < 5; i++) expect(() => auth.login('bad', 'bad', 'client')).toThrow();
		expect(() => auth.login('test-admin', 'test-password', 'client')).toThrow(expect.objectContaining({ status: 429 }));
		jest.advanceTimersByTime(60000);
		expect(auth.login('test-admin', 'test-password', 'client').token).toBeTruthy();
		for (let i = 0; i < 9; i++) auth.login('test-admin', 'test-password', `client-${i}`);
		expect(() => auth.login('test-admin', 'test-password', 'extra')).toThrow(expect.objectContaining({ status: 429 }));
	});

	it('globally bounds distributed attempts', () => {
		for (let i = 0; i < 100; i++) expect(() => auth.login('bad', 'bad', `client-${i}`)).toThrow();
		expect(() => auth.login('test-admin', 'test-password', 'new')).toThrow(expect.objectContaining({ status: 429 }));
	});
});
