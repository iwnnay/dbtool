import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// Single full-stack app: the debug UI lives under /routes/debug (served at
		// /debug) and the API under /routes/api (served at /api). No SvelteKit
		// `base` path — that keeps the API at /api like the old FastAPI contract
		// while pages sit at /debug. adapter-node gives us one Node process / one
		// port for both, replacing the old API + Svelte-dev split.
		adapter: adapter()
	}
};

export default config;
