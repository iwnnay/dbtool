// App hooks. `nacelleHandle` (from nacelle-core) provides request context,
// logging, and the console heartbeat. Compose your own hooks around it with
// `sequence(...)` from '@sveltejs/kit/hooks' if needed.
//
// Flows and tools are auto-discovered from their directories: drop a file in
// src/lib/server/flows or src/lib/server/tools and it's registered — no index
// to maintain. (The globs live here so Vite resolves them against this app.)
import { nacelleHandle } from 'nacelle-core/hooks';
import {
	registerAliases,
	registerDiscoveredFlows,
	registerDiscoveredTools
} from 'nacelle-core/server';

registerAliases({
	ask: { ollama: 'gemma4:12b', openai: 'gpt-4.1-nano' }
});

registerDiscoveredFlows(import.meta.glob('./lib/server/flows/*.ts', { eager: true }));
registerDiscoveredTools(import.meta.glob('./lib/server/tools/*.ts', { eager: true }));

export const handle = nacelleHandle;
