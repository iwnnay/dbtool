/**
 * Minimal Ollama chat client (ported from aco_db_discovery). Streams deltas,
 * auto-sizes num_ctx from the prompt so schema grounding is never silently
 * truncated (Ollama drops the OLDEST tokens — i.e. the system message — when
 * the prompt exceeds num_ctx).
 */
import { env } from '$env/dynamic/private';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export const ollamaConfig = {
	get baseUrl() {
		return env.OLLAMA_URL || env.OLLAMA_BASE_URL || 'http://localhost:11434';
	},
	get maxCtx() {
		return parseInt(env.OLLAMA_MAX_CTX || '32768', 10);
	}
};

let detectedModel: string | null = null;

/** OLLAMA_MODEL if set, otherwise the first installed model (gemma preferred). */
async function resolveModel(): Promise<string> {
	if (env.OLLAMA_MODEL) return env.OLLAMA_MODEL;
	if (detectedModel) return detectedModel;
	const res = await fetch(`${ollamaConfig.baseUrl}/api/tags`);
	if (!res.ok) throw new Error(`Ollama unreachable (${res.status})`);
	const data = (await res.json()) as { models?: { name: string }[] };
	const names = (data.models ?? []).map((m) => m.name);
	if (names.length === 0) throw new Error('No models installed in Ollama');
	detectedModel = names.find((n) => n.startsWith('gemma')) ?? names[0];
	return detectedModel;
}

const CHARS_PER_TOKEN = 3.2;
const RESPONSE_HEADROOM = 2048;
const MIN_CTX = 8192;

function autoNumCtx(messages: ChatMessage[]): number {
	const chars = messages.reduce((n, m) => n + m.content.length, 0);
	const needed = Math.ceil(chars / CHARS_PER_TOKEN) + RESPONSE_HEADROOM;
	const rounded = Math.ceil(needed / 1024) * 1024;
	return Math.min(Math.max(rounded, MIN_CTX), ollamaConfig.maxCtx);
}

export async function* chatStream(
	messages: ChatMessage[],
	opts: { temperature?: number } = {}
): AsyncGenerator<string> {
	const model = await resolveModel();
	const res = await fetch(`${ollamaConfig.baseUrl}/api/chat`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			model,
			messages,
			stream: true,
			options: { temperature: opts.temperature ?? 0.2, num_ctx: autoNumCtx(messages) }
		})
	});
	if (!res.ok || !res.body) {
		throw new Error(`Ollama error ${res.status}: ${await res.text().catch(() => res.statusText)}`);
	}

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let nl: number;
		while ((nl = buffer.indexOf('\n')) >= 0) {
			const line = buffer.slice(0, nl).trim();
			buffer = buffer.slice(nl + 1);
			if (!line) continue;
			try {
				const json = JSON.parse(line);
				const delta = json?.message?.content;
				if (delta) yield delta as string;
			} catch {
				// partial line
			}
		}
	}
}

export async function chat(
	messages: ChatMessage[],
	opts: { temperature?: number } = {}
): Promise<string> {
	let out = '';
	for await (const delta of chatStream(messages, opts)) out += delta;
	return out;
}

export async function ollamaStatus(): Promise<{ ok: boolean; model: string; error?: string }> {
	try {
		return { ok: true, model: await resolveModel() };
	} catch (e) {
		return { ok: false, model: env.OLLAMA_MODEL || '(auto)', error: (e as Error).message };
	}
}
