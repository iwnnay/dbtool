<script module lang="ts">
	interface Msg {
		role: 'user' | 'assistant';
		content: string;
	}
	// Chat history survives closing/reopening the modal within a session.
	const histories = new Map<string, Msg[]>();
</script>

<script lang="ts">
	import Modal from './Modal.svelte';
	import { api, type DatamapStatus } from './api';

	let {
		server,
		database,
		onClose,
		onAppendSql
	}: {
		server: string;
		database: string;
		onClose: () => void;
		onAppendSql: (sql: string) => void;
	} = $props();

	const histKey = $derived(`${server}|${database}`);
	// svelte-ignore state_referenced_locally -- modal is recreated per open; initial read is intentional
	let messages = $state<Msg[]>(histories.get(`${server}|${database}`) ?? []);
	let input = $state('');
	let streaming = $state(false);
	let status = $state<DatamapStatus | null>(null);
	let scroller: HTMLDivElement | undefined = $state();

	async function refreshStatus() {
		try {
			status = await api.datamapStatus(server, database);
		} catch {
			// leave stale status
		}
	}

	$effect(() => {
		void refreshStatus();
	});

	// Poll while a build job is running
	$effect(() => {
		if (!status?.job?.running) return;
		const t = setInterval(refreshStatus, 2000);
		return () => clearInterval(t);
	});

	function persist() {
		histories.set(histKey, messages);
	}

	function scrollDown() {
		requestAnimationFrame(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
	}

	async function build(force: boolean) {
		await api.datamapGenerate(server, database, force);
		await refreshStatus();
	}

	async function send() {
		const q = input.trim();
		if (!q || streaming) return;
		input = '';
		messages = [...messages, { role: 'user', content: q }, { role: 'assistant', content: '' }];
		persist();
		scrollDown();
		streaming = true;
		try {
			const res = await fetch('/api/db/ask', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ server, database, messages: messages.slice(0, -1) })
			});
			if (!res.ok || !res.body) {
				throw new Error(await res.text().catch(() => `${res.status}`));
			}
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				messages[messages.length - 1].content += decoder.decode(value, { stream: true });
				messages = messages;
				scrollDown();
			}
		} catch (e) {
			messages[messages.length - 1].content += `\n[error: ${(e as Error).message}]`;
			messages = messages;
		} finally {
			streaming = false;
			persist();
			scrollDown();
		}
	}

	/** Split assistant content into text and ```sql code segments. */
	function segments(content: string): { code: boolean; text: string }[] {
		const out: { code: boolean; text: string }[] = [];
		const re = /```(?:sql)?\s*\n([\s\S]*?)(?:```|$)/g;
		let last = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(content))) {
			if (m.index > last) out.push({ code: false, text: content.slice(last, m.index) });
			out.push({ code: true, text: m[1].trimEnd() });
			last = m.index + m[0].length;
		}
		if (last < content.length) out.push({ code: false, text: content.slice(last) });
		return out;
	}

	const describePct = $derived(
		status?.job?.running && status.job.total > 0
			? Math.round((status.job.done / status.job.total) * 100)
			: null
	);
</script>

<Modal title="Ask — {database}" width={760} {onClose}>
	<div class="ask">
		<div class="status">
			{#if !status}
				<span class="muted">Checking datamap…</span>
			{:else}
				{#if !status.ollama.ok}
					<span class="bad" title={status.ollama.error}>⚠ Ollama unreachable ({status.ollama.model})</span>
				{:else}
					<span class="muted">{status.ollama.model}</span>
				{/if}
				<span class="sep">·</span>
				{#if status.job?.running}
					<span class="accent">
						{status.job.phase === 'snapshot'
							? 'Snapshotting schema…'
							: `Describing tables… ${status.job.done}/${status.job.total}${describePct != null ? ` (${describePct}%)` : ''}`}
					</span>
				{:else if status.job?.phase === 'error'}
					<span class="bad" title={status.job.error}>⚠ build failed: {status.job.error}</span>
				{:else if !status.exists}
					<span class="bad">No datamap yet</span>
				{:else}
					<span class="muted">
						{status.tableCount.toLocaleString()} tables · {status.describedCount} described ·
						built {status.generatedAt?.slice(0, 16).replace('T', ' ')}
					</span>
				{/if}
				<span class="spacer"></span>
				{#if !status.job?.running}
					<button class="mini" onclick={() => build(false)}>
						{status.exists ? 'Update datamap' : 'Build datamap'}
					</button>
					{#if status.exists}
						<button class="mini" title="Discard descriptions and rebuild everything" onclick={() => build(true)}>
							Rebuild
						</button>
					{/if}
				{/if}
			{/if}
		</div>

		<div class="chat" bind:this={scroller}>
			{#if messages.length === 0}
				<div class="empty">
					Ask about {database} in plain English — e.g. <em>"find all patients with a last name
					starting with zzz and an ICD code of I50.9"</em> — and get runnable T-SQL grounded in
					the datamap.
				</div>
			{/if}
			{#each messages as m, i (i)}
				<div class="msg {m.role}">
					{#if m.role === 'user'}
						<div class="bubble">{m.content}</div>
					{:else}
						<div class="bubble">
							{#each segments(m.content) as seg, si (si)}
								{#if seg.code}
									<div class="codeblock">
										<pre>{seg.text}</pre>
										<button class="mini insert" onclick={() => onAppendSql(seg.text)}>
											+ Add to sheet
										</button>
									</div>
								{:else if seg.text.trim()}
									<p>{seg.text.trim()}</p>
								{/if}
							{/each}
							{#if streaming && i === messages.length - 1}<span class="cursor">▋</span>{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>

		<div class="composer">
			<textarea
				placeholder={!status?.exists
					? 'Build the datamap first ↑'
					: status?.job?.running
						? 'Ask about this database… (datamap build in progress — answers will queue behind it)'
						: 'Ask about this database…'}
				bind:value={input}
				disabled={streaming || !status?.exists}
				rows="2"
				onkeydown={(e) => {
					if (e.key === 'Enter' && !e.shiftKey) {
						e.preventDefault();
						void send();
					}
				}}
			></textarea>
			<button class="send" onclick={send} disabled={streaming || !input.trim() || !status?.exists}>
				{streaming ? '…' : 'Send'}
			</button>
		</div>
	</div>
</Modal>

<style>
	.ask {
		display: flex;
		flex-direction: column;
		height: 62vh;
		min-height: 380px;
		gap: 10px;
	}
	.status {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11.5px;
		flex: none;
		flex-wrap: wrap;
	}
	.muted {
		color: var(--muted);
	}
	.bad {
		color: var(--warn);
	}
	.accent {
		color: var(--accent);
	}
	.sep {
		color: var(--border-strong);
	}
	.spacer {
		flex: 1;
	}
	.mini {
		background: var(--panel2);
		border: 1px solid var(--border-strong);
		border-radius: 5px;
		color: var(--text);
		font-size: 11px;
		padding: 3px 10px;
		cursor: pointer;
	}
	.mini:hover {
		border-color: var(--accent);
	}
	.chat {
		flex: 1;
		overflow: auto;
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 4px 2px;
		min-height: 0;
	}
	.empty {
		color: var(--muted);
		font-size: 12.5px;
		line-height: 1.6;
		padding: 20px 30px;
		text-align: center;
	}
	.msg {
		display: flex;
	}
	.msg.user {
		justify-content: flex-end;
	}
	.bubble {
		max-width: 88%;
		border-radius: 10px;
		padding: 8px 12px;
		font-size: 12.5px;
		line-height: 1.55;
	}
	.msg.user .bubble {
		background: var(--accent);
		color: #fff;
		white-space: pre-wrap;
	}
	.msg.assistant .bubble {
		background: var(--panel2);
		border: 1px solid var(--border);
		color: var(--text);
	}
	.bubble p {
		margin: 4px 0;
		white-space: pre-wrap;
	}
	.codeblock {
		position: relative;
		margin: 6px 0;
	}
	.codeblock pre {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 7px;
		padding: 10px 12px;
		margin: 0;
		font-family: var(--mono);
		font-size: 12px;
		overflow-x: auto;
		white-space: pre;
	}
	.codeblock .insert {
		position: absolute;
		top: 6px;
		right: 6px;
		opacity: 0.75;
	}
	.codeblock .insert:hover {
		opacity: 1;
	}
	.cursor {
		color: var(--accent);
		animation: blink 1s step-start infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0;
		}
	}
	.composer {
		display: flex;
		gap: 8px;
		flex: none;
	}
	.composer textarea {
		flex: 1;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--text);
		font-family: var(--sans);
		font-size: 12.5px;
		padding: 8px 10px;
		resize: none;
		outline: none;
	}
	.composer textarea:focus {
		border-color: var(--accent);
	}
	.send {
		background: var(--accent);
		border: none;
		border-radius: 8px;
		color: #fff;
		font-size: 12.5px;
		font-weight: 600;
		padding: 0 18px;
		cursor: pointer;
	}
	.send:disabled {
		opacity: 0.45;
		cursor: default;
	}
</style>
