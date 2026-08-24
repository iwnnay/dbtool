<script lang="ts">
	import { onMount } from 'svelte';
	import Modal from './Modal.svelte';
	import { api, type Sheet } from './api';
	import { app, type ResultTab } from './app.svelte';
	import { catalog } from './catalog.svelte';
	import { parseTableRefs } from './columnCompletion';
	import { buildDeleteSql, findKeyColumns, qualifyTable } from './deleteSql';

	let {
		sheet,
		tab,
		rowIndexes,
		onClose
	}: {
		sheet: Sheet;
		tab: ResultTab;
		rowIndexes: number[];
		onClose: () => void;
	} = $props();

	let sql = $state('');
	let target = $state('');
	let error = $state('');
	let resolving = $state(true);
	let running = $state(false);

	onMount(() => {
		void resolveStatement();
	});

	async function resolveStatement() {
		resolving = true;
		error = '';
		sql = '';
		target = '';
		const sourceSql = tab.resultSet.sourceSql;
		if (!sourceSql) {
			error = `Cannot build a DELETE for "${tab.label}" — the statement that produced these rows was not recorded, so the source table is unknown`;
			resolving = false;
			return;
		}
		const engine = app.connection(sheet.server)?.type ?? 'mssql';
		const refs = parseTableRefs(sourceSql, engine === 'sqlite' ? 'main' : engine === 'postgres' ? 'public' : 'dbo');
		if (refs.length === 0) {
			error = `Cannot build a DELETE — no table was found in the statement that produced "${tab.label}"`;
			resolving = false;
			return;
		}
		const reasons: string[] = [];
		for (const ref of refs) {
			const database = ref.db ?? sheet.database;
			const key = `${sheet.server}|${database}|${ref.schema}|${ref.table}`;
			await catalog.loadColumns(sheet.server, database, ref.schema, ref.table);
			const tableColumns = catalog.columns[key];
			const tableName = `${ref.schema}.${ref.table}`;
			if (!tableColumns?.length) {
				reasons.push(`${tableName}: ${catalog.errors[key] ?? 'no columns could be read'}`);
				continue;
			}
			const lookup = findKeyColumns(tab.resultSet, tableColumns, tableName);
			if (!lookup.ok) {
				reasons.push(lookup.reason);
				continue;
			}
			const sameDatabase = database.toLowerCase() === sheet.database.toLowerCase();
			const qualified = qualifyTable(ref.schema, ref.table, sameDatabase ? undefined : database, engine);
			try {
				sql = buildDeleteSql(qualified, lookup.keyColumns, tab.resultSet, rowIndexes, engine);
				target = qualified;
			} catch (caught) {
				error = (caught as Error).message;
			}
			resolving = false;
			return;
		}
		error = `Cannot build a DELETE for these rows — ${reasons.join('; ')}`;
		resolving = false;
	}

	async function runDelete() {
		if (!sql) return;
		running = true;
		error = '';
		try {
			const result = await api.run({
				sheetId: sheet.id,
				server: sheet.server,
				database: sheet.database,
				sql
			});
			app.completedRuns++;
			if (!result.ok) {
				error = result.error?.text ?? `DELETE failed against ${target} on ${sheet.database}`;
				return;
			}
			app.markRowsDeleted(sheet.id, tab.id, rowIndexes);
			app.flash(
				`Deleted ${result.rowsAffected.toLocaleString()} row(s) from ${target} — see Messages for details`
			);
			onClose();
		} catch (caught) {
			error = (caught as Error).message;
		} finally {
			running = false;
		}
	}
</script>

<Modal title="Delete {rowIndexes.length} row{rowIndexes.length === 1 ? '' : 's'}" width={720} {onClose}>
	{#if resolving}
		<div class="note">Reading the table's primary key…</div>
	{:else if sql}
		<div class="note">
			This will run against <strong>{sheet.database}</strong> on <strong>{sheet.server}</strong>,
			deleting {rowIndexes.length.toLocaleString()} row{rowIndexes.length === 1 ? '' : 's'} from
			<strong>{target}</strong>.
		</div>
		<pre class="sql">{sql}</pre>
	{/if}
	{#if error}
		<div class="banner err">✕ {error}</div>
	{/if}
	<div class="actions">
		<button class="btn" onclick={onClose} disabled={running}>Cancel</button>
		<button class="btn danger" onclick={runDelete} disabled={running || !sql}>
			{running ? 'Running…' : 'Run'}
		</button>
	</div>
</Modal>

<style>
	.note {
		color: var(--muted);
		font-size: 12.5px;
		margin-bottom: 10px;
	}
	.note strong {
		color: var(--text);
	}
	.sql {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 7px;
		padding: 10px 12px;
		margin: 0;
		font-family: var(--mono);
		font-size: 12px;
		white-space: pre;
		overflow: auto;
		max-height: 46vh;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 14px;
	}
	.btn {
		background: var(--panel2);
		border: 1px solid var(--border-strong);
		border-radius: 6px;
		color: var(--text);
		font-size: 12.5px;
		padding: 6px 16px;
		cursor: pointer;
	}
	.btn:hover:not(:disabled) {
		border-color: var(--accent);
	}
	.btn.danger {
		background: var(--error);
		border-color: var(--error);
		color: #fff;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.banner {
		border-radius: 6px;
		padding: 8px 12px;
		font-size: 12.5px;
		margin-top: 10px;
	}
	.banner.err {
		background: rgba(255, 107, 107, 0.1);
		border: 1px solid var(--error);
		color: var(--error);
		font-family: var(--mono);
		white-space: pre-wrap;
	}
</style>
