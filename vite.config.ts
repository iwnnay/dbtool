import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

// Single port for everything (UI + API). Override with PORT in .env.
export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	const PORT = parseInt(env.PORT || process.env.PORT || '9999', 10);
	return {
		plugins: [sveltekit()],
		server: {
			port: PORT,
			strictPort: false
		},
		// nacelle-core ships TypeScript/Svelte source (no build step), so the app's
		// bundler must compile it rather than treat it as an external dependency.
		ssr: {
			noExternal: ['nacelle-core']
		},
		test: {
			include: ['src/**/*.{test,spec}.{js,ts}'],
			coverage: {
				provider: 'v8',
				reporter: ['text', 'html'],
				include: ['src/**/*.{js,ts}'],
				exclude: ['src/**/*.{test,spec}.{js,ts}', 'src/**/*.d.ts']
			}
		}
	};
});
