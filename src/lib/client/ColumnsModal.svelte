<script lang="ts">
	import Modal from './Modal.svelte';
	import { catalog } from './catalog.svelte';

	let {
		server,
		database,
		schema,
		table,
		onClose
	}: { server: string; database: string; schema: string; table: string; onClose: () => void } =
		$props();

	const colKey = $derived(`${server}|${database}|${schema}|${table}`);
	$effect(() => {
		void catalog.loadColumns(server, database, schema, table);
	});
	const cols = $derived(catalog.columns[colKey] ?? []);
</script>

<Modal title="Columns — {schema}.{table}" width={680} {onClose}>
	{#if catalog.loading[colKey]}
		<div class="note">Loading…</div>
	{:else if catalog.errors[colKey]}
		<div class="note err">⚠ {catalog.errors[colKey]}</div>
	{:else}
		<table>
			<thead>
				<tr><th></th><th>Name</th><th>Type</th><th>Nullable</th><th>Identity</th><th>Computed</th></tr>
			</thead>
			<tbody>
				{#each cols as c (c.name)}
					<tr>
						<td class="pk">{c.isPk ? '🔑' : ''}</td>
						<td class="name">{c.name}</td>
						<td class="type">{c.display}</td>
						<td class="flag">{c.nullable ? 'yes' : 'no'}</td>
						<td class="flag">{c.identity ? 'yes' : ''}</td>
						<td class="flag">{c.computed ? 'yes' : ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<div class="count">{cols.length} columns</div>
	{/if}
</Modal>

<style>
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12.5px;
	}
	th {
		text-align: left;
		color: var(--muted);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 4px 10px 6px;
		border-bottom: 1px solid var(--border-strong);
		position: sticky;
		top: -14px;
		background: var(--panel);
	}
	td {
		padding: 5px 10px;
		border-bottom: 1px solid var(--border);
	}
	.pk {
		width: 22px;
		padding-right: 0;
		font-size: 10px;
	}
	.name {
		font-family: var(--mono);
	}
	.type {
		font-family: var(--mono);
		color: var(--warn);
	}
	.flag {
		color: var(--muted);
	}
	.count {
		margin-top: 10px;
		color: var(--muted);
		font-size: 11.5px;
	}
	.note {
		color: var(--muted);
		font-size: 12.5px;
	}
	.note.err {
		color: var(--error);
	}
</style>
