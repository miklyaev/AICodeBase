// Keep tests independent of Vite's application configuration and local secrets.
export default {
	envDir: false,
	test: {
		environment: 'node',
		include: ['src/__tests__/**/*.spec.ts'],
	},
};
