import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
	// Frontend settings are VITE_* only; backend credentials are loaded separately.
	const env = loadEnv(mode, process.cwd(), 'VITE_');

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
