'use strict';

// Intentionally no traces, screenshots, HAR, console forwarding or raw errors.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const FIXTURE = path.join(__dirname, 'fixture');
const REPORT = path.join(ROOT, 'reports/e2e/latest.json');
const FRONTEND = (process.env.E2E_FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const BACKEND = (process.env.E2E_BACKEND_URL || 'http://localhost:3181').replace(/\/$/, '');
const report = {
	status: 'fail',
	startedAt: new Date().toISOString(),
	scope: 'Local browser E2E with real Polza API and isolated application data',
	checks: [],
	responses: [],
	indexing: null,
	answer: null,
};
const secrets = new Set();
let browser;
let context;
let page;
let token;
let firstLoginAt;
let stage = 'startup';
let browserFault = null;
const observers = new Set();
const counters = { index: 0, search: 0, chat: 0 };

class CheckFailure extends Error {
	constructor(code) { super(code); this.code = code; }
}
function check(condition, code) {
	if (!condition) throw new CheckFailure(code);
}
function remember(value) {
	if (typeof value === 'string' && value) secrets.add(value);
	return value;
}
function containsSecret(value) {
	let text = typeof value === 'string' ? value : JSON.stringify(value);
	// The project path is public metadata and may coincidentally contain a short
	// password. Ignore only this exact, independently known path, not arbitrary
	// response fields or credential values.
	for (const knownPath of [ROOT, ROOT.replace(/\\/g, '/'), JSON.stringify(ROOT).slice(1, -1)]) {
		text = text.split(knownPath).join('[PROJECT_ROOT]');
	}
	return [...secrets].some((secret) => text.includes(secret));
}
function safeText(value) {
	let text = String(value ?? '');
	for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
		text = text.split(secret).join('[REDACTED]');
		text = text.split(encodeURIComponent(secret)).join('[REDACTED]');
	}
	return text.replace(/Bearer\s+\S+/gi, '[REDACTED]')
		.replace(/\b[a-f0-9]{64}\b/gi, '[REDACTED]')
		.replace(/\b(?:sk|pk)-[\w-]+/gi, '[REDACTED]').slice(0, 6000);
}
function endpoint(url) {
	const pathname = new URL(url).pathname;
	if (/^\/api\/projects\/[^/]+\/status$/.test(pathname)) return '/api/projects/:id/status';
	const known = ['/api/settings/status', '/api/settings/admin/login', '/api/settings/admin/logout',
		'/api/settings/api-key', '/api/settings/openrouter-key', '/api/projects/select',
		'/api/projects/index', '/api/projects/events', '/api/search', '/api/chat/message', '/api/files/snippet'];
	return known.includes(pathname) ? pathname : '/api/other';
}
function recordResponse(response) {
	const route = endpoint(response.url());
	// Status polling can be frequent; record only distinct route/status pairs.
	const status = response.status();
	if (!report.responses.some((item) => item.route === route && item.status === status)) {
		report.responses.push({ route, status });
	}
}
async function responseJson(response) {
	recordResponse(response);
	let value;
	try { value = await response.json(); } catch { throw new CheckFailure('EXPECTED_JSON_RESPONSE'); }
	check(!apiResponseContainsSecret(value, response.url()), 'SECRET_IN_API_RESPONSE');
	return value;
}
function apiResponseContainsSecret(body, url) {
	if (endpoint(url) === '/api/projects/select' && body && typeof body === 'object') {
		const publicNames = [path.basename(ROOT), path.basename(FIXTURE)];
		if (publicNames.includes(body.name)) return containsSecret({ ...body, name: '[PROJECT_NAME]' });
	}
	return containsSecret(body);
}
function watch(task) {
	observers.add(task);
	task.catch((error) => { browserFault ||= error instanceof CheckFailure ? error.code : 'NETWORK_OBSERVER_FAILED'; })
		.finally(() => observers.delete(task));
}
async function step(name, work) {
	stage = name;
	await work();
	await Promise.allSettled([...observers]);
	check(!browserFault, browserFault || 'NETWORK_OBSERVER_FAILED');
	report.checks.push({ name, status: 'pass' });
	console.log(`PASS ${name}`);
}
async function noBrowserLeaks(checkHtml = true) {
	const state = await page.evaluate(() => ({
		html: document.documentElement.outerHTML,
		// Monaco embeds large font/style payloads. A short password can occur in
		// those static bytes by coincidence; inspect live DOM markup separately.
		markup: (() => {
			const clone = document.documentElement.cloneNode(true);
			clone.querySelectorAll('style').forEach((style) => style.remove());
			return clone.outerHTML;
		})(),
		local: JSON.stringify(Object.entries(localStorage)),
		session: JSON.stringify(Object.entries(sessionStorage)),
	}));
	if (checkHtml) {
		check(!containsSecret(state.markup), 'SECRET_IN_PAGE_HTML');
		check(![...secrets].some((secret) => secret.length >= 20 && state.html.includes(secret)), 'SECRET_IN_STYLE_OR_PAGE_HTML');
	}
	check(!containsSecret(await page.locator('body').innerText()), 'SECRET_IN_PAGE_TEXT');
	check(!containsSecret(state.local), 'SECRET_IN_LOCAL_STORAGE');
	check(!containsSecret(state.session), 'SECRET_IN_SESSION_STORAGE');
}
async function visible(locator, code) {
	try { await locator.waitFor({ state: 'visible', timeout: 20000 }); }
	catch { throw new CheckFailure(code); }
}
function waitResponse(route, method = 'POST', timeout = 120000) {
	return page.waitForResponse((response) => new URL(response.url()).pathname === route && response.request().method() === method, { timeout });
}
async function clickResponse(locator, route, method = 'POST', timeout) {
	const pending = waitResponse(route, method, timeout);
	// Avoid unhandled timeout rejections if the click itself fails.
	pending.catch(() => undefined);
	await locator.click();
	return pending;
}
async function post(route, data, headers) {
	const response = await page.request.post(`${BACKEND}${route}`, { data, headers });
	return { response, body: await responseJson(response) };
}
async function launch() {
	// Playwright debug mode can print fill() values; disable it in this process before loading.
	delete process.env.DEBUG;
	delete process.env.PWDEBUG;
	let chromium;
	try { ({ chromium } = require('playwright')); }
	catch { throw new CheckFailure('PLAYWRIGHT_NOT_INSTALLED'); }
	for (const channel of ['msedge', 'chrome', null]) {
		try {
			browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
			report.browser = channel || 'bundled-chromium';
			return;
		} catch { /* Never print browser launch errors: no downloads and no raw diagnostics. */ }
	}
	throw new CheckFailure('NO_INSTALLED_BROWSER');
}
async function main() {
	check([FRONTEND, BACKEND].every((value) => {
		const url = new URL(value);
		return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
			&& !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
	}), 'LOCALHOST_URLS_REQUIRED');
	// Runtime only: never echo source files, values, errors or environment objects.
	let login;
	let password;
	let apiKey;
	try {
		login = process.env.E2E_ADMIN_LOGIN || 'admin';
		password = fs.readFileSync(path.join(ROOT, 'password.txt'), 'utf8').trim();
		apiKey = fs.readFileSync('D:/NeuroNet/Routers/Polza.ai/api_key.txt', 'utf8').trim();
	} catch { throw new CheckFailure('CREDENTIAL_FILES_UNAVAILABLE'); }
	check(Boolean(login && password && apiKey), 'CREDENTIALS_MISSING');
	remember(password);
	remember(apiKey);
	await launch();
	context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	page = await context.newPage();
	page.setDefaultTimeout(20000);
	page.on('request', (request) => {
		const route = endpoint(request.url());
		const requestUrl = new URL(request.url());
		const secretInQuery = [...requestUrl.searchParams.values()].some(containsSecret);
		const longSecretInUrl = [...secrets].some((secret) => secret.length >= 20 && request.url().includes(secret));
		// Vite's filesystem URLs can contain ordinary words that happen to equal
		// a short password. Credential-bearing query values are never permitted.
		if (secretInQuery || longSecretInUrl) browserFault ||= 'SECRET_IN_REQUEST_URL';
		if (route === '/api/projects/index') counters.index += 1;
		if (route === '/api/search') counters.search += 1;
		if (route === '/api/chat/message') {
			counters.chat += 1;
			watch((async () => {
				const headers = await request.allHeaders();
				check(!Object.keys(headers).some((name) => name === 'authorization' || /^x-.*key$/i.test(name)), 'CHAT_HAS_PRIVILEGED_HEADERS');
				check(!containsSecret(request.postData() || ''), 'CHAT_HAS_SECRET_BODY');
			})());
		}
	});
	page.on('response', (response) => {
		if (!new URL(response.url()).pathname.startsWith('/api/')) return;
		recordResponse(response);
		if (endpoint(response.url()) === '/api/projects/events') return;
		watch((async () => {
			const body = await response.json();
			if (endpoint(response.url()) === '/api/settings/admin/login' && response.ok()) {
				check(typeof body.token === 'string' && body.token.length >= 32, 'INVALID_LOGIN_SESSION');
				token = remember(body.token);
				// Token is permitted only in the login response, never in the report.
				check(!containsSecret({ ...body, token: '[REDACTED]' }), 'SECRET_IN_LOGIN_RESPONSE');
			} else check(!apiResponseContainsSecret(body, response.url()), 'SECRET_IN_API_RESPONSE');
		})());
	});

	await step('home-and-notice', async () => {
		await page.goto(FRONTEND, { waitUntil: 'domcontentloaded' });
		await visible(page.getByRole('heading', { name: 'AI Codebase RAG Agent', exact: true }), 'HOME_NOT_VISIBLE');
		const response = await page.request.get(`${BACKEND}/api/settings/status`);
		const body = await responseJson(response);
		check(response.ok() && typeof body.hasApiKey === 'boolean', 'SETTINGS_STATUS_FAILED');
		check(await page.locator('input[type="password"]').count() === 0, 'OLD_KEY_FORM_ON_HOME');
		check(await page.getByRole('button', { name: /Сохранить.*ключ/i }).count() === 0, 'OLD_SAVE_BUTTON_ON_HOME');
		if (!body.hasApiKey) await visible(page.getByText('API не настроен. Обратитесь к администратору', { exact: true }), 'MISSING_KEY_NOTICE');
		await noBrowserLeaks();
	});
	const openSettings = () => page.getByRole('button', { name: 'Настройка API', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Настройка API', exact: true });
	await step('dialog-escape-close-reopen', async () => {
		await openSettings();
		await visible(dialog, 'DIALOG_NOT_ACCESSIBLY_LABELLED');
		await page.keyboard.press('Escape');
		check(await dialog.count() === 0, 'ESCAPE_DID_NOT_CLOSE');
		await openSettings();
		await dialog.getByRole('button', { name: 'Закрыть настройку API' }).click();
		check(await dialog.count() === 0, 'CLOSE_DID_NOT_CLOSE');
		await openSettings();
		await visible(dialog.getByLabel('Логин администратора'), 'LOGIN_NOT_RESET');
	});
	await step('wrong-password-then-login', async () => {
		await dialog.getByLabel('Логин администратора').fill(login);
		const passwordInput = dialog.getByLabel('Пароль администратора');
		check(await passwordInput.getAttribute('type') === 'password', 'PASSWORD_NOT_MASKED');
		await passwordInput.fill(`e2e-wrong-${crypto.randomUUID()}`);
		firstLoginAt = Date.now();
		let response = await clickResponse(dialog.getByRole('button', { name: 'Войти', exact: true }), '/api/settings/admin/login');
		check(response.status() === 401, 'WRONG_PASSWORD_NOT_REJECTED');
		await visible(dialog.getByRole('alert'), 'WRONG_PASSWORD_NO_UI_ERROR');
		await passwordInput.fill(password);
		await noBrowserLeaks(false);
		response = await clickResponse(dialog.getByRole('button', { name: 'Войти', exact: true }), '/api/settings/admin/login');
		check(response.ok(), 'ADMIN_LOGIN_FAILED');
		await visible(dialog.getByLabel('Новый API ключ'), 'ADMIN_FORM_NOT_VISIBLE');
		await Promise.allSettled([...observers]);
		check(Boolean(token), 'SESSION_NOT_CAPTURED');
		await noBrowserLeaks();
	});
	await step('save-real-api-key', async () => {
		const input = dialog.getByLabel('Новый API ключ');
		check(await input.getAttribute('type') === 'password', 'KEY_NOT_MASKED');
		await input.fill(apiKey);
		await noBrowserLeaks(false);
		const response = await clickResponse(dialog.getByRole('button', { name: 'Сохранить ключ', exact: true }), '/api/settings/api-key');
		check(response.ok(), 'KEY_SAVE_FAILED');
		await visible(dialog.getByText('API ключ сохранён.', { exact: true }), 'KEY_SAVE_NOTICE_MISSING');
		check(await input.inputValue() === '', 'KEY_INPUT_NOT_CLEARED');
		await noBrowserLeaks();
	});
	await step('logout-revocation-and-setters', async () => {
		const oldToken = token;
		const response = await clickResponse(dialog.getByRole('button', { name: 'Выйти', exact: true }), '/api/settings/admin/logout');
		check(response.ok(), 'LOGOUT_FAILED');
		await visible(dialog.getByLabel('Пароль администратора'), 'LOGOUT_NO_LOGIN_FORM');
		let result = await post('/api/settings/api-key', { apiKey }, { Authorization: `Bearer ${oldToken}` });
		check(result.response.status() === 401, 'REVOKED_SESSION_ACCEPTED');
		result = await post('/api/settings/api-key', { apiKey });
		check(result.response.status() === 401, 'UNAUTHENTICATED_SETTER_ACCEPTED');
		result = await post('/api/settings/openrouter-key', { apiKey });
		check(result.response.status() === 404, 'OLD_SETTER_STILL_EXISTS');
		await dialog.getByRole('button', { name: 'Закрыть настройку API' }).click();
		await noBrowserLeaks();
	});
	await step('five-login-attempts-per-minute', async () => {
		// Account for the two UI attempts; use a fresh window if UI interaction took too long.
		let attempts = 3;
		if (Date.now() - firstLoginAt >= 50000) {
			await new Promise((resolve) => setTimeout(resolve, Math.max(0, firstLoginAt + 61000 - Date.now())));
			attempts = 5;
		}
		for (let attempt = 0; attempt < attempts; attempt += 1) {
			const result = await post('/api/settings/admin/login', { login, password: `invalid-${crypto.randomUUID()}` });
			check(result.response.status() === 401, 'RATE_LIMIT_WINDOW_NOT_CLEAN');
		}
		const result = await post('/api/settings/admin/login', { login, password: `invalid-${crypto.randomUUID()}` });
		check(result.response.status() === 429 && result.body.code === 'ADMIN_RATE_LIMIT', 'LOGIN_RATE_LIMIT_MISSING');
	});
	const controlPath = path.join(ROOT, '.e2e-runtime/control.json');
	if (fs.existsSync(controlPath)) {
		await step('restart-key-persistence-and-session-revocation', async () => {
			let control;
			try { control = JSON.parse(fs.readFileSync(controlPath, 'utf8')); }
			catch { throw new CheckFailure('CONTROL_CONFIG_UNAVAILABLE'); }
			const url = new URL(control.url);
			check(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
				&& !url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'INVALID_CONTROL_URL');
			check(typeof control.token === 'string' && control.token.length >= 32, 'INVALID_CONTROL_TOKEN');
			remember(control.token);
			const response = await page.request.post(`${url.origin}/restart-backend`, {
				headers: { 'X-E2E-Control': control.token }, timeout: 60000,
			});
			check(response.status() === 200, 'BACKEND_RESTART_FAILED');
			const deadline = Date.now() + 60000;
			let restored = false;
			while (Date.now() < deadline) {
				let status;
				try { status = await page.request.get(`${BACKEND}/api/settings/status`, { timeout: 3000 }); }
				catch { await new Promise((resolve) => setTimeout(resolve, 500)); continue; }
				if (status.ok()) {
					const body = await responseJson(status);
					check(body.hasApiKey === true, 'KEY_NOT_PERSISTED_AFTER_RESTART');
					restored = true;
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
			check(restored, 'BACKEND_RESTART_READY_TIMEOUT');
			const result = await post('/api/settings/api-key', { apiKey }, { Authorization: `Bearer ${token}` });
			check(result.response.status() === 401, 'OLD_SESSION_ACCEPTED_AFTER_RESTART');
		});
	} else {
		report.checks.push({ name: 'restart-key-persistence-and-session-revocation', status: 'skip', code: 'NO_LOCAL_CONTROL_CONFIG' });
		console.log('SKIP restart-key-persistence-and-session-revocation: NO_LOCAL_CONTROL_CONFIG');
	}
	await step('secret-snippets-and-prefix-traversal', async () => {
		const selected = await post('/api/projects/select', { path: ROOT });
		check(selected.response.ok() && selected.body.id, 'ROOT_SELECT_FAILED');
		// Selecting is metadata-only. NEVER index this root and never read a successful secret response.
		for (const filePath of ['.env', 'password.txt', `../${path.basename(ROOT)}-other/payment.ts`]) {
			const query = new URLSearchParams({ projectId: selected.body.id, filePath, startLine: '1', endLine: '1' });
			const response = await page.request.get(`${BACKEND}/api/files/snippet?${query}`);
			recordResponse(response);
			check(response.status() === 403, filePath.startsWith('../') ? 'PREFIX_TRAVERSAL_NOT_BLOCKED' : 'SECRET_SNIPPET_NOT_BLOCKED');
			const body = await responseJson(response);
			check(body.code === (filePath.startsWith('../') ? 'PATH_TRAVERSAL' : 'FILE_FORBIDDEN'), 'SECURITY_ERROR_CODE_MISMATCH');
		}
	});
	await step('fixture-select-and-single-index', async () => {
		await page.getByLabel('Путь к папке проекта (выбрать через диалог для Windows)').fill(FIXTURE);
		const selected = await clickResponse(page.getByRole('button', { name: 'Выбрать папку проекта', exact: true }), '/api/projects/select');
		check(selected.ok(), 'FIXTURE_SELECT_FAILED');
		const project = await selected.json();
		check(project.id && path.resolve(project.path || project.rootPath || '') === FIXTURE, 'WRONG_FIXTURE_SELECTED');
		const started = await clickResponse(page.getByRole('button', { name: 'Индексировать', exact: true }), '/api/projects/index');
		check(started.ok(), 'INDEX_START_FAILED');
		const deadline = Date.now() + 180000;
		while (Date.now() < deadline) {
			const response = await page.request.get(`${BACKEND}/api/projects/${encodeURIComponent(project.id)}/status`, {
				timeout: Math.max(1, Math.min(3000, deadline - Date.now())),
			});
			const status = await responseJson(response);
			check(response.ok(), 'INDEX_STATUS_FAILED');
			report.indexing = { status: ['ready', 'failed', 'indexing', 'idle'].includes(status.status) ? status.status : 'other', message: safeText(status.message) };
			if (status.status === 'failed') throw new CheckFailure('INDEXING_FAILED');
			if (status.status === 'ready') {
				check(status.filesCount === 1 && status.chunksCount >= 1, 'UNEXPECTED_FIXTURE_INDEX_SIZE');
				await visible(page.getByText(/Статус: ready/), 'READY_NOT_VISIBLE');
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
		throw new CheckFailure('INDEXING_TIMEOUT_180S');
	});
	await step('single-search-refs-and-monaco', async () => {
		await page.getByRole('textbox', { name: 'Запрос', exact: true }).fill('calculateOrderTotal');
		const response = await clickResponse(page.getByRole('button', { name: 'Найти', exact: true }), '/api/search', 'GET');
		check(response.ok(), 'SEARCH_HTTP_FAILED');
		const refs = await responseJson(response);
		check(Array.isArray(refs) && refs.some((ref) => ref.filePath === 'payment.ts' && ref.language === 'ts'), 'SEARCH_TS_REFERENCE_MISSING');
		await visible(page.locator('.refs-list .ref-item').filter({ hasText: 'payment.ts' }).first(), 'SEARCH_REFS_NOT_VISIBLE');
		await visible(page.locator('.monaco-editor .view-lines').filter({ hasText: 'calculateOrderTotal' }).first(), 'MONACO_SNIPPET_NOT_VISIBLE');
		const code = (await page.locator('.monaco-editor .view-lines').innerText()).replace(/\u00a0/g, ' ');
		check(code.includes('subtotal - discount'), 'MONACO_CALCULATION_MISSING');
	});
	await step('single-chat-answer-and-refs', async () => {
		await page.getByPlaceholder('Например: Где реализована авторизация пользователя?').fill('Объясни calculateOrderTotal: как subtotal и discount определяют итоговую сумму? Вычисли результат для prices=[100,50] и discount=20. Укажи файл и строки.');
		const response = await clickResponse(page.getByTitle('Отправить', { exact: true }), '/api/chat/message');
		check(response.ok(), 'CHAT_HTTP_FAILED');
		const body = await responseJson(response);
		check(typeof body.answer === 'string' && body.answer.trim().length > 20, 'CHAT_ANSWER_MISSING');
		report.answer = safeText(body.answer);
		check(!body.answer.includes('Нашел потенциально релевантные места в коде.'), 'CHAT_PROVIDER_FALLBACK');
		check(/\b130\b/.test(body.answer) && /(?:discount|скидк)/i.test(body.answer), 'CHAT_CALCULATION_NOT_GROUNDED');
		check(Array.isArray(body.references) && body.references.some((ref) => ref.filePath === 'payment.ts'), 'CHAT_REFERENCE_MISSING');
		await visible(page.locator('.msg.assistant'), 'CHAT_ANSWER_NOT_VISIBLE');
		await visible(page.locator('.msg.assistant .refs-inline').getByRole('button', { name: /payment\.ts:/ }).first(), 'CHAT_REFS_NOT_VISIBLE');
		await noBrowserLeaks();
		check(counters.index === 1 && counters.search === 1 && counters.chat === 1, 'PAID_REQUEST_BUDGET_EXCEEDED');
	});

	report.status = 'pass';
}

main().catch((error) => {
	report.checks.push({ name: stage, status: 'fail', code: error instanceof CheckFailure ? error.code : 'RUNNER_OPERATION_FAILED' });
	console.log(`FAIL ${stage}: ${error instanceof CheckFailure ? error.code : 'RUNNER_OPERATION_FAILED'}`);
	process.exitCode = 1;
}).finally(async () => {
	await Promise.allSettled([...observers]);
	if (context) await context.close().catch(() => undefined);
	if (browser) await browser.close().catch(() => undefined);
	if (browserFault && report.status === 'pass') {
		report.status = 'fail';
		report.checks.push({ name: 'network-security', status: 'fail', code: browserFault });
		process.exitCode = 1;
	}
	try {
		report.finishedAt = new Date().toISOString();
		fs.mkdirSync(path.dirname(REPORT), { recursive: true });
		fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
		console.log(`E2E ${report.status.toUpperCase()}; report: reports/e2e/latest.json`);
	} catch { console.log('FAIL REPORT_WRITE_FAILED'); process.exitCode = 1; }
	secrets.clear();
	token = undefined;
});
