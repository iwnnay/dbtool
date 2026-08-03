<script lang="ts">
	import Modal from './Modal.svelte';
	import { api, type DbObject } from './api';
	import { catalog } from './catalog.svelte';

	let {
		server,
		database,
		onClose
	}: { server: string; database: string; onClose: () => void } = $props();

	let text = $state('');
	let allObjects = $state<DbObject[] | null>(null);
	let loaded = $state(false);
	let saving = $state(false);
	let savedNote = $state('');
	let error = $state('');
	let fileInput: HTMLInputElement | undefined = $state();

	$effect(() => {
		void (async () => {
			try {
				const [{ ignored }, { objects }] = await Promise.all([
					api.getIgnore(server, database),
					api.objects(server, database, true)
				]);
				text = ignored.join('\n');
				allObjects = objects;
			} catch (e) {
				error = (e as Error).message;
			} finally {
				loaded = true;
			}
		})();
	});

	const lineCount = $derived(text.split('\n').filter((l) => l.trim()).length);
	const tableCount = $derived(allObjects?.filter((o) => o.type === 'table').length ?? 0);

	/**
	 * Import an allowlist TSV (aco_db_discovery format: TableName +
	 * EstimatedRowCount from production). Tables with production rows stay
	 * visible; everything else in this database becomes ignored.
	 */
	function importTsv(file: File) {
		error = '';
		void file.text().then((content) => {
			const lines = content.split(/\r?\n/).filter((l) => l.trim());
			if (lines.length < 2) return (error = 'TSV appears empty');
			const header = lines[0].split('\t').map((h) => h.trim().toLowerCase());
			const nameIdx = header.indexOf('tablename');
			const rowsIdx = header.indexOf('estimatedrowcount');
			if (nameIdx < 0 || rowsIdx < 0) {
				return (error = 'Expected TSV columns: TableName, EstimatedRowCount');
			}
			const allow = new Set<string>();
			for (const line of lines.slice(1)) {
				const cols = line.split('\t');
				const name = cols[nameIdx]?.trim().toLowerCase();
				const rows = Number(cols[rowsIdx]);
				if (name && Number.isFinite(rows) && rows > 0) allow.add(name);
			}
			if (allow.size === 0) return (error = 'No tables with rows found in TSV');
			const ignored = (allObjects ?? [])
				.filter((o) => o.type === 'table')
				.filter((o) => !allow.has(o.name.toLowerCase()) && !allow.has(`${o.schema}.${o.name}`.toLowerCase()))
				.map((o) => `${o.schema}.${o.name}`);
			text = ignored.join('\n');
			savedNote = `${allow.size.toLocaleString()} tables in allowlist → ${ignored.length.toLocaleString()} of ${tableCount.toLocaleString()} local tables ignored (not saved yet)`;
		});
	}

	async function save() {
		saving = true;
		error = '';
		try {
			const { ignored } = await api.saveIgnore(
				server,
				database,
				text.split('\n').map((l) => l.trim()).filter(Boolean)
			);
			text = ignored.join('\n');
			savedNote = `Saved — ${ignored.length.toLocaleString()} tables ignored`;
			// Refresh everything fed by the objects endpoint (tree, search, autocomplete)
			void catalog.loadObjects(server, database, true);
		} catch (e) {
			error = (e as Error).message;
		} finally {
			saving = false;
		}
	}
</script>

<Modal title="Ignore list — {database}" width={620} {onClose}>
	<div class="ignore">
		<p class="explain">
			One table per line (<code>schema.table</code> or bare name, case-insensitive). Ignored
			tables are hidden from the tree, search, autocomplete, datamaps and Ask — but still open
			when named explicitly. Or import a production-usage TSV
			(<code>TableName&nbsp;+&nbsp;EstimatedRowCount</code>): tables with no production rows
			get ignored.
		</p>

		<div class="bar">
			<span class="muted">
				{#if !loaded}Loading…{:else}{lineCount.toLocaleString()} ignored · {tableCount.toLocaleString()} tables in database{/if}
			</span>
			<span class="spacer"></span>
			<button class="mini" onclick={() => fileInput?.click()}>Import allowlist TSV…</button>
			<button class="mini" onclick={() => (text = '')}>Clear</button>
		</div>
		<input
			type="file"
			accept=".tsv,.txt,text/tab-separated-values"
			bind:this={fileInput}
			style="display:none"
			onchange={(e) => {
				const f = e.currentTarget.files?.[0];
				if (f) importTsv(f);
				e.currentTarget.value = '';
			}}
		/>

		<textarea bind:value={text} spellcheck="false" placeholder="dbo.some_template_table"></textarea>

		{#if error}<div class="note err">✕ {error}</div>{/if}
		{#if savedNote && !error}<div class="note ok">{savedNote}</div>{/if}

		<div class="actions">
			<button class="btn primary" onclick={save} disabled={saving || !loaded}>
				{saving ? 'Saving…' : 'Save'}
			</button>
		</div>
	</div>
</Modal>

<style>
	.ignore {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.explain {
		margin: 0;
		color: var(--muted);
		font-size: 12px;
		line-height: 1.55;
	}
	.explain code {
		font-family: var(--mono);
		font-size: 11px;
		color: var(--text);
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11.5px;
	}
	.muted {
		color: var(--muted);
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
	textarea {
		height: 34vh;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 7px;
		color: var(--text);
		font-family: var(--mono);
		font-size: 12px;
		padding: 8px 10px;
		resize: vertical;
		outline: none;
		white-space: pre;
	}
	textarea:focus {
		border-color: var(--accent);
	}
	.note {
		font-size: 12px;
	}
	.note.err {
		color: var(--error);
	}
	.note.ok {
		color: var(--ok);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
	}
	.btn {
		border-radius: 6px;
		font-size: 12.5px;
		padding: 6px 18px;
		cursor: pointer;
	}
	.btn.primary {
		background: var(--accent);
		border: 1px solid var(--accent);
		color: #fff;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
