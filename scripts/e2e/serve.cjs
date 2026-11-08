const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { randomBytes, timingSafeEqual } = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const runtime = path.join(root, '.e2e-runtime');

async function main() {
	if (process.argv[2] === 'backend') {
		fs.mkdirSync(path.join(runtime, 'backend'), { recursive: true });
		process.chdir(path.join(runtime, 'backend'));
		process.env.PORT = '3181';
		require('ts-node').register({
			project: path.join(root, 'apps/backend/tsconfig.json'),
			transpileOnly: true,
		});
		require(path.join(root, 'apps/backend/src/main.ts'));
		return;
	}
	if (process.argv[2] === 'frontend') {
		const { createServer } = await import('vite');
		const { default: react } = await import('@vitejs/plugin-react');
		const server = await createServer({
			configFile: false,
			envDir: false,
			root: path.join(root, 'apps/frontend'),
			plugins: [react()],
			define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('') },
			server: {
				host: '127.0.0.1',
				port: 5173,
				strictPort: true,
				proxy: { '/api': { target: 'http://127.0.0.1:3181', changeOrigin: true } },
			},
		});
		await server.listen();
		console.log('E2E frontend listening on http://127.0.0.1:5173');
		return;
	}

	fs.mkdirSync(runtime, { recursive: true });
	const children = new Map();
	const token = randomBytes(24).toString('hex');
	fs.writeFileSync(path.join(runtime, 'control.json'), JSON.stringify({
		url: 'http://127.0.0.1:3182',
		token,
		backendCwd: path.join(runtime, 'backend'),
		backendUrl: 'http://127.0.0.1:3181',
		frontendUrl: 'http://127.0.0.1:5173',
	}), { mode: 0o600 });
	const start = (name) => {
		const child = spawn(process.execPath, [__filename, name], {
			cwd: root,
			stdio: ['ignore', 'inherit', 'inherit'],
			windowsHide: true,
		});
		children.set(name, child);
		child.on('error', () => console.error(`E2E ${name} failed to launch`));
		return child;
	};
	const stopChild = async (name) => {
		const child = children.get(name);
		if (!child || child.exitCode !== null || child.signalCode !== null) return;
		await new Promise((resolve) => {
			const timer = setTimeout(resolve, 5000);
			child.once('exit', () => { clearTimeout(timer); resolve(); });
			child.kill();
		});
	};
	start('backend');
	start('frontend');

	const control = http.createServer(async (request, response) => {
		const supplied = Buffer.from(String(request.headers['x-e2e-control'] || ''));
		const expected = Buffer.from(token);
		if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
			response.writeHead(403).end();
			return;
		}
		if (request.method === 'GET' && request.url === '/status') {
			response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
				backendCwd: path.join(runtime, 'backend'),
				backendUrl: 'http://127.0.0.1:3181',
				frontendUrl: 'http://127.0.0.1:5173',
			}));
			return;
		}
		if (request.method !== 'POST') {
			response.writeHead(405).end();
			return;
		}
		if (request.url === '/restart-backend') {
			await stopChild('backend');
			start('backend');
			response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"restarted":true}');
			return;
		}
		if (request.url === '/stop') {
			await Promise.all([...children.keys()].map(stopChild));
			response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"stopped":true}');
			control.close();
			try { fs.unlinkSync(path.join(runtime, 'control.json')); } catch { /* Already removed. */ }
			return;
		}
		response.writeHead(404).end();
	});
	control.listen(3182, '127.0.0.1', () => console.log('E2E supervisor ready (secrets hidden)'));
}

main().catch(() => {
	console.error('E2E server startup failed; inspect installed runtime dependencies.');
	process.exitCode = 1;
});
