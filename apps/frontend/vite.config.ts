import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
	// load env from project root (process.cwd()) so repo-level .env is picked up
	const env = loadEnv(mode, process.cwd(), '');

	return {
		plugins: [react()],
		define: {
			// inject only the specific variable so import.meta.env.VITE_API_BASE_URL is available
			'import.meta.env.VITE_API_BASE_URL': JSON.stringify(env.VITE_API_BASE_URL ?? ''),
		},
		server: {
			port: 5173,
			proxy: {
				'/api': {
					target: 'http://127.0.0.1:3001',
					changeOrigin: true,
				},
			},
		},
	};
});
