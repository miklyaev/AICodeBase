'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '../..');
const frontendRoot = path.join(repoRoot, 'apps', 'frontend');
const reportPath = path.join(repoRoot, 'reports', 'e2e', 'references.json');
const checks = [];
const pageErrors = [];
let browser;
let vite;
let envDir;
let report;
let slowStartedResolve;
let slowFinishedResolve;
let selectionSlowStartedResolve;
let selectionSlowFinishedResolve;
let selectionBRaceResolve;
const slowStarted = new Promise((resolve) => { slowStartedResolve = resolve; });
const slowFinished = new Promise((resolve) => { slowFinishedResolve = resolve; });
const selectionSlowStarted = new Promise((resolve) => { selectionSlowStartedResolve = resolve; });
const selectionSlowFinished = new Promise((resolve) => { selectionSlowFinishedResolve = resolve; });
const selectionBRace = new Promise((resolve) => { selectionBRaceResolve = resolve; });

function ref(filePath, startLine, language = 'ts') {
  return {
    filePath,
    startLine,
    endLine: startLine + 2,
    language,
    reason: `Synthetic reference ${filePath}`,
    snippet: `// synthetic ${filePath}`,
    relevance: 0.99,
  };
}

const chatResponses = {
  B: Array.from({ length: 8 }, (_, index) => ref(`src/chat-b-${index + 1}.ts`, index * 10 + 1)),
  C: [ref('src/chat-c.ts', 81)],
  D: [],
  RACE: [ref('src/slow.ts', 10), ref('src/fast.ts', 20), ref('src/error.ts', 30)],
};
const searchReferences = [ref('src/search-a.ts', 4)];

async function json(route, payload, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(payload),
  });
}

async function routeApi(route) {
  const request = route.request();
  const url = new URL(request.url());
  const pathname = url.pathname;

  if (pathname === '/api/settings/status' && request.method() === 'GET') {
    return json(route, { hasApiKey: true });
  }
  if (pathname === '/api/projects/events') {
    // Stop EventSource reconnects without opening any network connection to a backend.
    return route.fulfill({ status: 204, body: '' });
  }
  if (pathname === '/api/projects/select' && request.method() === 'POST') {
    const body = request.postDataJSON();
    const requestedPath = String(body.path);
    if (requestedPath.includes('project-a-slow-race')) {
      selectionSlowStartedResolve();
      await delay(800);
      selectionSlowFinishedResolve();
    }
    if (requestedPath.includes('project-b-race')) selectionBRaceResolve();
    const isB = requestedPath.includes('project-b');
    return json(route, {
      id: isB ? 'project-b' : 'project-a',
      name: isB ? 'Synthetic Project B' : 'Synthetic Project A',
      path: body.path,
      status: 'ready',
      filesCount: 12,
      chunksCount: 24,
    });
  }
  const statusMatch = pathname.match(/^\/api\/projects\/([^/]+)\/status$/);
  if (statusMatch && request.method() === 'GET') {
    return json(route, {
      projectId: statusMatch[1],
      status: 'ready',
      filesCount: 12,
      chunksCount: 24,
      indexedFiles: 12,
      totalFiles: 12,
      message: 'Synthetic ready status',
    });
  }
  if (pathname === '/api/search' && request.method() === 'GET') {
    return json(route, searchReferences);
  }
  if (pathname === '/api/chat/message' && request.method() === 'POST') {
    const body = request.postDataJSON();
    const answerKey = String(body.message).trim().toUpperCase();
    const references = chatResponses[answerKey] ?? [];
    return json(route, {
      answer: `Answer ${answerKey}`,
      confidence: 'high',
      references,
      conversationId: 'synthetic-conversation',
    });
  }
  if (pathname === '/api/files/snippet' && request.method() === 'GET') {
    const filePath = url.searchParams.get('filePath') || 'unknown';
    if (filePath === 'src/slow.ts') {
      slowStartedResolve();
      await delay(900);
      slowFinishedResolve();
    }
    if (filePath === 'src/error.ts') {
      return json(route, { message: 'Synthetic snippet failure' }, 500);
    }
    const startLine = Number(url.searchParams.get('startLine') || 1);
    return json(route, {
      content: `SNIPPET:${filePath}`,
      startLine,
      endLine: startLine + 2,
      filePath,
    });
  }

  // Fail closed: every API request is intercepted and no real backend is reachable.
  return json(route, { message: `Unmocked synthetic API request: ${request.method()} ${pathname}` }, 404);
}

async function check(name, fn) {
  const item = { name, status: 'running' };
  checks.push(item);
  try {
    await fn();
    item.status = 'passed';
  } catch (error) {
    item.status = 'failed';
    item.error = error && error.stack ? error.stack : String(error);
    throw error;
  }
}

async function waitForValue(page, value) {
  await page.waitForFunction(
    (expected) => document.querySelector('[data-testid="monaco-editor"]')?.value === expected,
    value,
    { timeout: 7000 },
  );
}

async function selectProject(page, name, syntheticPath) {
  const projectSection = page.locator('.left-panel > section.card').nth(0);
  await projectSection.locator('input').nth(0).fill(syntheticPath);
  await projectSection.locator('button').nth(1).click();
  await page.getByText(name, { exact: true }).waitFor({ state: 'visible', timeout: 7000 });
  await page.waitForFunction(() => {
    const input = document.querySelector('.chat-form input');
    return input && !input.disabled;
  }, null, { timeout: 7000 });
}

async function sendChat(page, message, expectedAnswer) {
  const input = page.locator('.chat-form input');
  await input.fill(message);
  await page.locator('.chat-form button[type="submit"]').click();
  await page.getByText(expectedAnswer, { exact: true }).waitFor({ state: 'visible', timeout: 7000 });
}

async function searchA(page) {
  const search = page.locator('.left-panel > section.card').nth(1);
  await search.locator('input').nth(0).fill('A');
  await search.locator('button[type="submit"]').click();
  await page.locator('.refs-list .ref-item').first().waitFor({ state: 'visible', timeout: 7000 });
}

async function main() {
  envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kodik-e2e-env-'));
  const { createServer } = await import('vite');
  const monacoMock = {
    name: 'e2e-monaco-mock',
    enforce: 'pre',
    resolveId(source) {
      return source === '@monaco-editor/react' ? '\0kodik-monaco-e2e-mock' : null;
    },
    load(id) {
      if (id !== '\0kodik-monaco-e2e-mock') return null;
      return `import React from 'react';
        export default function Editor(props) {
          return React.createElement('textarea', {
            'data-testid': 'monaco-editor', 'data-monaco-mock': 'true',
            'aria-label': 'Code editor', readOnly: true,
            value: props.value == null ? '' : props.value,
            style: { width: '100%', height: '100%', resize: 'none' }
          });
        }`;
    },
  };

  vite = await createServer({
    root: frontendRoot,
    configFile: false,
    envFile: false,
    envDir,
    plugins: [monacoMock],
    esbuild: { jsx: 'automatic' },
    appType: 'spa',
    server: { host: '127.0.0.1', port: 0, strictPort: false, open: false },
  });
  await vite.listen();
  const address = vite.httpServer.address();
  const origin = `http://127.0.0.1:${address.port}`;

  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1400 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__e2eUnhandledRejections = [];
    window.addEventListener('unhandledrejection', (event) => {
      window.__e2eUnhandledRejections.push(String(event.reason));
    });
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/api/**', routeApi);
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('.chat-form input').waitFor({ state: 'visible' });

  await check('search A then chat answer B replaces right references; all eight B links render on the left', async () => {
    await selectProject(page, 'Synthetic Project A', 'C:\\synthetic\\project-a');
    await searchA(page);
    assert.match(await page.locator('.refs-list .ref-title').first().innerText(), /src\/search-a\.ts/);
    await sendChat(page, 'B', 'Answer B');
    const rightRefs = page.locator('.refs-list .ref-item');
    assert.equal(await rightRefs.count(), 8);
    for (let i = 0; i < 8; i += 1) {
      const link = page.locator('.chat-list .msg.assistant').nth(0).locator('.link-btn').nth(i);
      assert.equal(await link.isVisible(), true, `Chat reference link ${i + 1} is not visible`);
      assert.match(await link.innerText(), new RegExp(`src/chat-b-${i + 1}\\.ts`));
    }
    assert.equal(await page.locator('.chat-list .msg.assistant').nth(0).locator('.link-btn').count(), 8);
  });

  await check('clicking an older chat reference after a newer answer restores and selects the old reference list', async () => {
    await sendChat(page, 'C', 'Answer C');
    assert.equal(await page.locator('.refs-list .ref-item').count(), 1);
    const oldLink = page.locator('.chat-list .msg.assistant').nth(0).locator('.link-btn').nth(3);
    await oldLink.click();
    assert.equal(await page.locator('.refs-list .ref-item').count(), 8);
    const selected = page.locator('.refs-list .ref-item.active .ref-title');
    await selected.waitFor({ state: 'visible' });
    assert.match(await selected.innerText(), /src\/chat-b-4\.ts/);
  });

  await check('reset search restores the latest non-empty chat answer', async () => {
    await searchA(page);
    const search = page.locator('.left-panel > section.card').nth(1);
    await search.locator('button').nth(1).click();
    assert.equal(await page.locator('.refs-list .ref-item').count(), 1);
    assert.match(await page.locator('.refs-list .ref-title').first().innerText(), /src\/chat-c\.ts/);
  });

  await check('reset search restores latest empty chat answer rather than an earlier answer', async () => {
    await sendChat(page, 'D', 'Answer D');
    assert.equal(await page.locator('.refs-list .ref-item').count(), 0);
    await searchA(page);
    const search = page.locator('.left-panel > section.card').nth(1);
    await search.locator('button').nth(1).click();
    assert.equal(await page.locator('.refs-list .ref-item').count(), 0);
    assert.equal(await page.locator('.refs-list .ref-item.active').count(), 0);
  });

  await check('changing projects clears prior chat and code references', async () => {
    await selectProject(page, 'Synthetic Project B', 'C:\\synthetic\\project-b');
    assert.equal(await page.locator('.chat-list .msg').count(), 0);
    assert.equal(await page.locator('.chat-list .link-btn').count(), 0);
    assert.equal(await page.locator('.refs-list .ref-item').count(), 0);
    assert.equal(await page.locator('.refs-list .ref-item.active').count(), 0);
  });

  await check('a slow stale snippet cannot overwrite a newer selected snippet', async () => {
    await sendChat(page, 'RACE', 'Answer RACE');
    await slowStarted;
    const refs = page.locator('.refs-list .ref-item');
    assert.equal(await refs.count(), 3);
    await refs.nth(1).click();
    await waitForValue(page, 'SNIPPET:src/fast.ts');
    await slowFinished;
    await delay(100);
    assert.equal(await page.locator('[data-testid="monaco-editor"]').inputValue(), 'SNIPPET:src/fast.ts');
    assert.match(await page.locator('.refs-list .ref-item.active .ref-title').innerText(), /src\/fast\.ts/);
  });

  await check('snippet failure is rendered without an unhandled rejection', async () => {
    await page.locator('.refs-list .ref-item').nth(2).click();
    await page.locator('.left-panel .error').waitFor({ state: 'visible', timeout: 7000 });
    assert.match(await page.locator('.left-panel .error').innerText(), /Synthetic snippet failure/);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(await page.evaluate(() => window.__e2eUnhandledRejections), []);
  });

  await check('a delayed project A selection cannot override a later project B selection', async () => {
    const projectSection = page.locator('.left-panel > section.card').nth(0);
    const pathInput = projectSection.locator('input').nth(0);
    const selectButton = projectSection.locator('button').nth(1);
    await pathInput.fill('C:\\synthetic\\project-a-slow-race');
    await selectButton.click();
    await selectionSlowStarted;
    await pathInput.fill('C:\\synthetic\\project-b-race');
    await selectButton.click();
    await selectionBRace;
    await selectionSlowFinished;
    await delay(100);
    assert.equal(await page.locator('.meta > div').first().innerText(), 'Synthetic Project B');
  });

  const apiCalls = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter((entry) => new URL(entry.name).pathname.startsWith('/api/'))
    .map((entry) => new URL(entry.name).pathname));
  report = {
    generatedAt: new Date().toISOString(),
    result: checks.every((item) => item.status === 'passed') ? 'passed' : 'failed',
    browser: 'Playwright Chromium, channel msedge, headless',
    app: 'Actual frontend React App served by programmatic Vite createServer',
    vite: { configFile: false, envFile: false, envDir: 'empty temporary directory', jsx: 'automatic' },
    api: { mode: 'all /api/** requests intercepted; synthetic fixtures only; no backend, LLM, or secrets', observedResourcePaths: apiCalls },
    limitations: ['@monaco-editor/react was replaced with a local read-only textarea stub to avoid CDN/network dependency; Monaco rendering, workers, and editor decorations were not exercised.'],
    checks,
    pageErrors,
    command: 'node scripts/e2e/run-references.cjs',
  };
  console.log(JSON.stringify(report, null, 2));
  await context.close();
}

main().catch((error) => {
  if (!report) {
    report = {
      generatedAt: new Date().toISOString(),
      result: 'failed',
      browser: 'Playwright Chromium, channel msedge, headless (launch or setup may have failed)',
      api: { mode: 'all /api/** requests intercepted; synthetic fixtures only' },
      limitations: ['@monaco-editor/react was configured as a local stub; Monaco itself was not exercised.'],
      checks,
      pageErrors,
      fatalError: error && error.stack ? error.stack : String(error),
      command: 'node scripts/e2e/run-references.cjs',
    };
  } else {
    report.result = 'failed';
    report.fatalError = error && error.stack ? error.stack : String(error);
  }
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (vite) await vite.close().catch(() => {});
  if (envDir) fs.rmSync(envDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
});
