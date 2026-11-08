'use strict';

// No screenshots, traces, HAR, raw responses/errors, paid calls or API-key saves.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const RUNTIME = path.join(ROOT, '.e2e-runtime');
const CWD = path.join(RUNTIME, 'backend');
const DATABASE = path.join(CWD, 'data/app.sqlite');
const FIXTURE = path.join(__dirname, 'fixture');
const REPORT = path.join(ROOT, 'reports/e2e/maintenance.json');
const BACKEND = 'http://127.0.0.1:3181';
const FRONTEND = 'http://127.0.0.1:5173';
const STATUS = '/api/settings/indexes/status';
const RESET = '/api/settings/indexes/reset';
const FORBIDDEN = new Set(['/api/projects/index', '/api/search', '/api/chat/message',
	'/api/settings/api-key', '/api/settings/openrouter-key', '/api/projects/clear-index']);
const report = { status: 'fail', checks: [], responses: [], ratios: {}, counts: {},
	requests: { index: 0, search: 0, chat: 0, uiReset: 0, forbidden: 0 } };
let browser;
let context;
let page;
let token;
let control;
let fault;
let stage = 'startup';
const uiResets = [];

class Failure extends Error {
	constructor(code) { super(code); this.code = code; }
}
function check(value, code) { if (!value) throw new Failure(code); }
function record(route, status) {
	// Route names are constants, never runtime URLs, credentials or query strings.
	if (!report.responses.some((item) => item.route === route && item.status === status)) {
		report.responses.push({ route, status });
	}
}
async function step(name, work) {
	stage = name;
	await work();
	check(!fault, fault || 'NETWORK_POLICY_FAILED');
	report.checks.push({ name, status: 'pass' });
	console.log(`PASS ${name}`);
}
function skip(name) { report.checks.push({ name, status: 'skip' }); }
function localOrigin(value, port) {
	try {
		const url = new URL(value);
		return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
			&& url.port === String(port) && url.pathname === '/' && !url.search && !url.hash
			&& !url.username && !url.password;
	} catch { return false; }
}
function samePath(a, b) {
	return typeof a === 'string' && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}
function isolatedContract() {
	check(fs.existsSync(DATABASE), 'ISOLATED_DATABASE_REQUIRED');
	check(samePath(fs.realpathSync(CWD), CWD), 'ISOLATED_CWD_MUST_NOT_BE_LINK');
	check(samePath(fs.realpathSync(DATABASE), DATABASE), 'ISOLATED_DATABASE_MUST_NOT_BE_LINK');
	const current = JSON.parse(fs.readFileSync(path.join(RUNTIME, 'control.json'), 'utf8'));
	check(localOrigin(current.url, 3182) && typeof current.token === 'string' && current.token.length >= 32,
		'LOCAL_SUPERVISOR_REQUIRED');
	check(samePath(current.backendCwd, CWD) && localOrigin(current.backendUrl, 3181)
		&& localOrigin(current.frontendUrl, 5173), 'SUPERVISOR_ISOLATION_CONTRACT_REQUIRED');
	if (control) check(control.token === current.token, 'SUPERVISOR_CHANGED');
	control = current;
}
async function attest() {
	isolatedContract();
	const response = await fetch(`${control.url}/status`, {
		headers: { 'X-E2E-Control': control.token }, signal: AbortSignal.timeout(10000), redirect: 'error',
	});
	check(response.status === 200, 'SUPERVISOR_ATTESTATION_FAILED');
	const state = await response.json();
	check(samePath(state.backendCwd, CWD) && localOrigin(state.backendUrl, 3181)
		&& localOrigin(state.frontendUrl, 5173), 'LIVE_ISOLATION_CONTRACT_REQUIRED');
}
function snapshot() {
	isolatedContract();
	const Database = require('better-sqlite3');
	const db = new Database(DATABASE, { readonly: true, fileMustExist: true });
	try {
		const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
		for (const name of ['projects', 'files', 'chunks', 'conversations', 'messages']) {
			check(tables.has(name), 'ISOLATED_SCHEMA_REQUIRED');
		}
		const counts = {};
		for (const name of ['projects', 'files', 'chunks', 'conversations', 'messages']) {
			counts[name] = db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get().count;
		}
		const projects = db.prepare('SELECT id, name, rootPath, createdAt FROM projects ORDER BY id').all();
		// Compare complete chat rows without ever serializing their contents to the report.
		const history = crypto.createHash('sha256');
		for (const name of ['conversations', 'messages']) {
			history.update(JSON.stringify(db.prepare(`SELECT * FROM ${name} ORDER BY id`).all()));
		}
		return { counts, projects, history: history.digest('hex') };
	} finally { db.close(); }
}
function preserved(before, after) {
	check(JSON.stringify(before.projects) === JSON.stringify(after.projects), 'PROJECT_RECORDS_CHANGED');
	check(before.history === after.history, 'CHAT_HISTORY_CHANGED');
	check(before.counts.conversations === after.counts.conversations
		&& before.counts.messages === after.counts.messages, 'CHAT_COUNTS_CHANGED');
}
async function request(route, { method = 'GET', data, authorized = false } = {}) {
	check(!FORBIDDEN.has(route), 'FORBIDDEN_DIRECT_REQUEST');
	if (route === RESET) await attest();
	const response = await fetch(`${BACKEND}${route}`, {
		method, redirect: 'error', signal: AbortSignal.timeout(20000),
		headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: `Bearer ${token}` } : {}) },
		...(data === undefined ? {} : { body: JSON.stringify(data) }),
	});
	record(route.startsWith('/api/projects/') && route.endsWith('/status') ? '/api/projects/:id/status' : route, response.status);
	return response;
}
function validateStatus(value) {
	check(typeof value.embeddingModel === 'string' && value.embeddingModel.length > 0
		&& (value.storedEmbeddingModel === null || typeof value.storedEmbeddingModel === 'string')
		&& typeof value.requiresReset === 'boolean'
		&& Number.isSafeInteger(value.indexedProjects) && value.indexedProjects >= 0
		&& Number.isSafeInteger(value.indexedChunks) && value.indexedChunks >= 0, 'INDEX_STATUS_SCHEMA');
}
async function indexStatus() {
	// The UI can hold the short status lease concurrently. Retry only free GETs.
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const response = await request(STATUS, { authorized: true });
		if (response.status === 409) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			continue;
		}
		check(response.status === 200, 'INDEX_STATUS_FAILED');
		const value = await response.json();
		validateStatus(value);
		return value;
	}
	throw new Failure('INDEX_STATUS_BUSY');
}
async function clickResponse(locator, route) {
	const pending = page.waitForResponse((response) => new URL(response.url()).pathname === route
		&& response.request().method() === 'POST');
	pending.catch(() => undefined);
	await locator.click();
	return pending;
}
async function selectFixture(fixture) {
	await page.getByLabel('Путь к папке проекта (выбрать через диалог для Windows)', { exact: true }).fill(FIXTURE);
	const response = await clickResponse(page.getByRole('button', { name: 'Выбрать папку проекта', exact: true }), '/api/projects/select');
	check(response.status() === 201 || response.status() === 200, 'FIXTURE_SELECTION_FAILED');
	const selected = await response.json();
	check(selected.id === fixture.id, 'FIXTURE_PROJECT_NOT_PRESERVED');
	return selected;
}
async function measureLogin() {
	const measurements = await page.evaluate(() => {
		const baseline = (input, login = false) => {
			const label = document.createElement('label');
			label.style.cssText = `position:fixed;left:-10000px;top:0;visibility:hidden;width:300px;font-size:${login ? '14px' : getComputedStyle(input).fontSize}`;
			const clone = document.createElement('input');
			clone.type = input.type;
			label.append(clone);
			document.body.append(label);
			try { return clone.getBoundingClientRect().height; } finally { label.remove(); }
		};
		const ratio = (input, login) => input.getBoundingClientRect().height / baseline(input, login);
		return {
			login: ratio(document.querySelector('input[name="login"]'), true),
			password: ratio(document.querySelector('input[name="password"]'), true),
			others: [...document.querySelectorAll('input:not(dialog input)')].map((input) => ratio(input, false)),
		};
	});
	check(Math.abs(measurements.login - 0.8) <= 0.02 && Math.abs(measurements.password - 0.8) <= 0.02,
		'LOGIN_INPUT_HEIGHT_NOT_EIGHTY_PERCENT');
	check(measurements.others.length >= 4 && measurements.others.every((ratio) => Math.abs(ratio - 1) <= 0.02),
		'OTHER_INPUT_HEIGHT_CHANGED');
	report.ratios = { login: measurements.login, password: measurements.password, others: measurements.others };
}
async function main() {
	// Ignore debug flags before loading Playwright so fill() values cannot be logged.
	delete process.env.DEBUG;
	delete process.env.PWDEBUG;
	await step('isolated-server-contract', attest);
	const before = snapshot();
	report.counts.before = before.counts;
	const fixture = before.projects.find((project) => samePath(project.rootPath, FIXTURE));
	let login;
	let password;
	try {
		login = process.env.E2E_ADMIN_LOGIN || 'admin';
		password = fs.readFileSync(path.join(ROOT, 'password.txt'), 'utf8').trim();
	} catch { throw new Failure('CREDENTIAL_FILES_UNAVAILABLE'); }
	check(Boolean(login && password), 'CREDENTIALS_REQUIRED');
	const { chromium } = require('playwright');
	for (const channel of ['msedge', 'chrome', null]) {
		try {
			browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
			break;
		} catch { /* Do not output installed browser diagnostics. */ }
	}
	check(browser, 'NO_INSTALLED_BROWSER');
	context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	// Abort forbidden calls before they reach either the proxy or backend.
	await context.route('**/*', async (route) => {
		const url = new URL(route.request().url());
		if (url.pathname.startsWith('/api/') && (!['127.0.0.1', 'localhost'].includes(url.hostname)
			|| !['3181', '5173'].includes(url.port) || FORBIDDEN.has(url.pathname))) {
			report.requests.forbidden += 1;
			fault ||= 'FORBIDDEN_BROWSER_REQUEST';
			await route.abort();
		} else await route.continue();
	});
	page = await context.newPage();
	page.setDefaultTimeout(20000);
	page.on('request', (req) => {
		const route = new URL(req.url()).pathname;
		if (route === '/api/projects/index') report.requests.index += 1;
		if (route === '/api/search') report.requests.search += 1;
		if (route === '/api/chat/message') report.requests.chat += 1;
		if (route === RESET) {
			report.requests.uiReset += 1;
			let payload;
			try { payload = req.postDataJSON(); } catch { /* Checked below. */ }
			uiResets.push({ confirmed: payload?.confirm === true, authenticated: req.headers().authorization === `Bearer ${token}` });
		}
	});
	let initialKeyStatus;
	await step('settings-key-status-before', async () => {
		const response = await request('/api/settings/status');
		check(response.status === 200, 'SETTINGS_STATUS_FAILED');
		initialKeyStatus = (await response.json()).hasApiKey;
		check(typeof initialKeyStatus === 'boolean', 'INVALID_KEY_STATUS');
	});
	await step('login-height-and-password-mask', async () => {
		await page.goto(FRONTEND, { waitUntil: 'domcontentloaded' });
		if (fixture) await selectFixture(fixture);
		await page.getByRole('button', { name: 'Настройка API', exact: true }).click();
		await page.getByRole('dialog', { name: 'Настройка API', exact: true }).waitFor();
		await measureLogin();
		const passwordInput = page.getByLabel('Пароль администратора', { exact: true });
		check(await passwordInput.getAttribute('type') === 'password', 'PASSWORD_NOT_MASKED');
		await page.getByLabel('Логин администратора', { exact: true }).fill(login);
		await passwordInput.fill(password);
		const response = await clickResponse(page.getByRole('button', { name: 'Войти', exact: true }), '/api/settings/admin/login');
		check(response.status() === 200 || response.status() === 201, 'ADMIN_LOGIN_FAILED');
		token = (await response.json()).token;
		check(typeof token === 'string' && token.length >= 32, 'ADMIN_TOKEN_INVALID');
		password = undefined;
		login = undefined;
	});
	let initialIndexes;
	await step('admin-index-status-and-ui', async () => {
		check((await request(STATUS)).status === 401, 'INDEX_STATUS_UNAUTHORIZED_NOT_REJECTED');
		initialIndexes = await indexStatus();
		const section = page.getByRole('region', { name: 'Индексы', exact: true });
		await section.getByText(`Текущая embedding model: ${initialIndexes.embeddingModel}`, { exact: true }).waitFor();
		await section.getByText(`Проектов с индексом: ${initialIndexes.indexedProjects} · Чанков: ${initialIndexes.indexedChunks}`, { exact: true }).waitFor();
		const apiKeyRatio = await page.getByLabel('Новый API ключ', { exact: true }).evaluate((input) => {
			const label = document.createElement('label');
			label.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;width:300px;font-size:14px';
			const clone = document.createElement('input');
			clone.type = 'password';
			label.append(clone);
			document.body.append(label);
			try { return input.getBoundingClientRect().height / clone.getBoundingClientRect().height; }
			finally { label.remove(); }
		});
		check(Math.abs(apiKeyRatio - 1) <= 0.02, 'API_KEY_INPUT_HEIGHT_CHANGED');
		report.ratios.apiKey = apiKeyRatio;
	});
	if (fixture && before.counts.chunks > 0) {
		await step('legacy-fixture-requires-reset', async () => {
			check(initialIndexes.requiresReset === true, 'LEGACY_INDEX_RESET_NOT_REQUIRED');
		});
	} else skip('legacy-fixture-requires-reset');
	const canReset = initialIndexes.requiresReset || initialIndexes.indexedProjects > 0 || initialIndexes.indexedChunks > 0;
	const resetButton = () => page.getByRole('button', { name: /^(Удалить старые индексы|Сбросить индексы)$/ });
	if (canReset) {
		await step('inline-reset-cancel-no-request', async () => {
			await resetButton().click();
			await page.getByRole('group', { name: 'Подтверждение сброса индексов', exact: true }).waitFor();
			await page.getByRole('button', { name: 'Отмена', exact: true }).click();
			await resetButton().waitFor();
			check(uiResets.length === 0, 'CANCEL_SENT_RESET_REQUEST');
			preserved(before, snapshot());
		});
	} else skip('inline-reset-cancel-no-request');
	await step('reset-auth-and-validation-no-deletion', async () => {
		check((await request(RESET, { method: 'POST', data: { confirm: false }, authorized: true })).status === 400,
			'RESET_FALSE_CONFIRM_NOT_REJECTED');
		check((await request(RESET, { method: 'POST', data: { confirm: true } })).status === 401,
			'RESET_UNAUTHORIZED_NOT_REJECTED');
		const afterValidation = snapshot();
		preserved(before, afterValidation);
		check(JSON.stringify(before.counts) === JSON.stringify(afterValidation.counts), 'VALIDATION_DELETED_DATA');
	});
	if (canReset) {
		await step('single-authenticated-ui-reset', async () => {
			await attest();
			await resetButton().click();
			const response = await clickResponse(page.getByRole('button', { name: 'Подтвердить сброс всех индексов', exact: true }), RESET);
			record(RESET, response.status());
			check(response.status() === 200 || response.status() === 201, 'UI_RESET_FAILED');
			await page.getByText('Индексы всех проектов удалены. Запустите полную переиндексацию нужных проектов.', { exact: true }).waitFor();
			check(uiResets.length === 1 && uiResets[0].confirmed && uiResets[0].authenticated, 'UI_RESET_REQUEST_CONTRACT');
		});
	} else skip('single-authenticated-ui-reset');
	await step('empty-indexes-preserved-projects-and-history', async () => {
		const after = snapshot();
		report.counts.after = after.counts;
		preserved(before, after);
		check(after.counts.files === 0 && after.counts.chunks === 0, 'SQLITE_INDEX_NOT_EMPTY');
		const status = await indexStatus();
		check(status.indexedProjects === 0 && status.indexedChunks === 0 && status.requiresReset === false, 'INDEX_STATUS_NOT_RESET');
	});
	if (before.counts.conversations === 0 || before.counts.messages === 0) skip('nonempty-history-fixture-unavailable');
	if (fixture) {
		await step('reload-fixture-idle-chat-disabled', async () => {
			await page.getByRole('button', { name: 'Закрыть настройку API', exact: true }).click();
			await page.reload({ waitUntil: 'domcontentloaded' });
			const selected = await selectFixture(fixture);
			check(selected.status === 'idle' && selected.filesCount === 0 && selected.chunksCount === 0, 'FIXTURE_NOT_IDLE');
			const response = await request(`/api/projects/${encodeURIComponent(fixture.id)}/status`);
			check(response.status === 200, 'FIXTURE_STATUS_FAILED');
			const status = await response.json();
			check(status.status === 'idle' && status.filesCount === 0 && status.chunksCount === 0, 'FIXTURE_STATUS_NOT_IDLE');
			await page.getByText('Статус: idle · Файлов: 0 · Чанков: 0', { exact: true }).waitFor();
			check(await page.getByPlaceholder('Например: Где реализована авторизация пользователя?').isDisabled(), 'CHAT_INPUT_NOT_DISABLED');
			check(await page.getByTitle('Отправить', { exact: true }).isDisabled(), 'CHAT_SEND_NOT_DISABLED');
		});
	} else skip('reload-fixture-idle-chat-disabled');
	skip('stale-reference-ui-no-paid-search');
	await step('restart-keeps-api-key-status', async () => {
		await attest();
		const response = await fetch(`${control.url}/restart-backend`, {
			method: 'POST', headers: { 'X-E2E-Control': control.token },
			signal: AbortSignal.timeout(15000), redirect: 'error',
		});
		check(response.status === 200, 'BACKEND_RESTART_FAILED');
		let restarted;
		for (let attempt = 0; attempt < 60; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			try {
				const status = await request('/api/settings/status');
				if (status.status === 200) { restarted = await status.json(); break; }
			} catch { /* Local startup polling only; never retry paid operations. */ }
		}
		check(restarted && restarted.hasApiKey === initialKeyStatus, 'KEY_STATUS_CHANGED_AFTER_RESTART');
		preserved(before, snapshot());
	});
	await step('zero-paid-requests-no-api-key-save', async () => {
		check(report.requests.index === 0 && report.requests.search === 0 && report.requests.chat === 0
			&& report.requests.forbidden === 0, 'PAID_OR_SETTINGS_MUTATION_ATTEMPT');
		check(uiResets.length === (canReset ? 1 : 0), 'UNEXPECTED_EXTRA_UI_RESET');
	});
	report.status = 'pass';
}

main().catch((error) => {
	report.status = 'fail';
	report.checks.push({ name: stage, status: 'fail', code: error instanceof Failure ? error.code : 'MAINTENANCE_CHECK_FAILED' });
	console.error(`FAIL ${stage}: ${error instanceof Failure ? error.code : 'MAINTENANCE_CHECK_FAILED'}`);
	process.exitCode = 1;
}).finally(async () => {
	try { if (browser) await browser.close(); } catch { /* No raw errors. */ }
	try {
		fs.mkdirSync(path.dirname(REPORT), { recursive: true });
		fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
		console.log('Report: reports/e2e/maintenance.json');
	} catch { console.error('REPORT_WRITE_FAILED'); process.exitCode = 1; }
});
