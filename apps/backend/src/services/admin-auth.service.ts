import { HttpException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_TTL = 60 * 60 * 1000;
const ATTEMPT_WINDOW = 60 * 1000;
const MAX_SESSIONS = 10;
const MAX_CLIENTS = 1000;

@Injectable()
export class AdminAuthService {
	private readonly sessions = new Map<string, number>();
	private readonly attempts = new Map<string, { count: number; expiresAt: number }>();
	private globalAttempts = { count: 0, expiresAt: 0 };

	login(login: string, password: string, client: string) {
		const now = Date.now();
		this.prune(now);
		if (this.globalAttempts.expiresAt <= now) this.globalAttempts = { count: 0, expiresAt: now + ATTEMPT_WINDOW };
		const attempt = this.attempts.get(client) ?? { count: 0, expiresAt: now + ATTEMPT_WINDOW };
		if (attempt.count >= 5 || this.globalAttempts.count >= 100 || (!this.attempts.has(client) && this.attempts.size >= MAX_CLIENTS)) {
			throw new HttpException({ code: 'ADMIN_RATE_LIMIT', message: 'Слишком много попыток входа. Попробуйте позже.' }, 429);
		}
		attempt.count += 1;
		this.globalAttempts.count += 1;
		this.attempts.set(client, attempt);
		const expectedLogin = process.env.ADMIN_LOGIN;
		const expectedPassword = process.env.ADMIN_PASSWORD;
		if (!expectedLogin || !expectedPassword) {
			throw new ServiceUnavailableException({ code: 'ADMIN_NOT_CONFIGURED', message: 'Вход администратора не настроен' });
		}
		const loginMatches = this.equal(login, expectedLogin);
		const passwordMatches = this.equal(password, expectedPassword);
		if (!loginMatches || !passwordMatches) throw this.unauthorized();
		if (this.sessions.size >= MAX_SESSIONS) {
			throw new HttpException({ code: 'ADMIN_SESSION_LIMIT', message: 'Достигнут лимит сессий администратора' }, 429);
		}
		const token = randomBytes(32).toString('hex');
		const expiresAt = now + SESSION_TTL;
		this.sessions.set(this.hash(token), expiresAt);
		return { token, expiresAt };
	}

	authorize(authorization?: string) {
		this.prune(Date.now());
		const match = /^Bearer ([a-f0-9]{64})$/.exec(authorization ?? '');
		if (!match || !this.sessions.has(this.hash(match[1]))) throw this.unauthorized();
		return this.hash(match[1]);
	}

	logout(authorization?: string) {
		this.sessions.delete(this.authorize(authorization));
	}

	private hash(value: string) {
		return createHash('sha256').update(value).digest('hex');
	}

	private equal(actual: string, expected: string) {
		return timingSafeEqual(Buffer.from(this.hash(actual), 'hex'), Buffer.from(this.hash(expected), 'hex'));
	}

	private unauthorized() {
		return new UnauthorizedException({ code: 'ADMIN_UNAUTHORIZED', message: 'Необходима авторизация администратора' });
	}

	private prune(now: number) {
		for (const [token, expiresAt] of this.sessions) if (expiresAt <= now) this.sessions.delete(token);
		for (const [client, attempt] of this.attempts) if (attempt.expiresAt <= now) this.attempts.delete(client);
	}
}
