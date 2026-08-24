<script lang="ts">
	import Modal from './Modal.svelte';
	import { app } from './app.svelte';
	import type { DatabaseEngine } from './api';

	let { onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void } = $props();
	let type = $state<DatabaseEngine>('mssql');
	let name = $state('');
	let server = $state('');
	let host = $state('localhost');
	let port = $state('5432');
	let user = $state('');
	let database = $state('postgres');
	let passwordEnv = $state('');
	let ssl = $state(false);
	let path = $state('');
	let readOnly = $state(false);
	let error = $state('');
	let saving = $state(false);

	async function save() {
		error = '';
		saving = true;
		try {
			const displayName = name.trim() || (type === 'mssql' ? server.trim() : type === 'postgres' ? `${host}:${port}` : path.trim());
			if (!displayName) throw new Error('A connection name or address is required.');
			const before = new Set(app.connections.map((connection) => connection.id));
			if (type === 'mssql') {
				if (!server.trim()) throw new Error('SQL Server name is required.');
				await app.addConnection({ type, name: displayName, server: server.trim() });
			} else if (type === 'postgres') {
				if (!host.trim()) throw new Error('PostgreSQL host is required.');
				await app.addConnection({ type, name: displayName, host: host.trim(), port: Number(port) || 5432, user: user.trim(), database: database.trim() || 'postgres', passwordEnv: passwordEnv.trim() || undefined, ssl });
			} else {
				if (!path.trim()) throw new Error('SQLite file path is required.');
				await app.addConnection({ type, name: displayName, path: path.trim(), readOnly });
			}
			const added = app.connections.find((connection) => !before.has(connection.id));
			if (added) onAdded(added.id);
			onClose();
		} catch (caught) {
			error = (caught as Error).message;
		} finally {
			saving = false;
		}
	}
</script>

<Modal title="Add database connection" width={520} {onClose}>
	<div class="form">
		<label>Database type<select bind:value={type}><option value="mssql">SQL Server</option><option value="postgres">PostgreSQL</option><option value="sqlite">SQLite file</option></select></label>
		<label>Display name <input bind:value={name} placeholder="Optional friendly name" /></label>
		{#if type === 'mssql'}
			<label>Server <input bind:value={server} placeholder="localhost\SQLEXPRESS" /></label>
			<p>Uses your current Windows identity, matching the existing SQL Server behavior.</p>
		{:else if type === 'postgres'}
			<div class="row"><label>Host <input bind:value={host} /></label><label class="port">Port <input bind:value={port} inputmode="numeric" /></label></div>
			<div class="row"><label>User <input bind:value={user} /></label><label>Initial database <input bind:value={database} /></label></div>
			<label>Password environment variable <input bind:value={passwordEnv} placeholder="e.g. DBTOOL_PG_PASSWORD" /></label>
			<label class="check"><input type="checkbox" bind:checked={ssl} /> Use TLS</label>
			<p>Passwords are not stored in dbtool. Leave this blank to use PostgreSQL/PG environment defaults or a passwordless local connection.</p>
		{:else}
			<label>SQLite file path <input bind:value={path} placeholder="C:\data\application.db" /></label>
			<label class="check"><input type="checkbox" bind:checked={readOnly} /> Open read-only</label>
		{/if}
		{#if error}<div class="error">{error}</div>{/if}
		<div class="actions"><button onclick={onClose}>Cancel</button><button class="primary" onclick={save} disabled={saving}>{saving ? 'Adding…' : 'Add connection'}</button></div>
	</div>
</Modal>

<style>
	.form { display: grid; gap: 12px; }
	label { display: grid; gap: 5px; color: var(--muted); font-size: 12px; }
	input, select { background: var(--bg); border: 1px solid var(--border); border-radius: 5px; color: var(--text); padding: 7px 9px; }
	.row { display: flex; gap: 10px; } .row label { flex: 1; } .row .port { flex: 0 0 90px; }
	.check { display: flex; grid-template-columns: auto 1fr; flex-direction: row; align-items: center; gap: 7px; }
	p { margin: -4px 0 0; color: var(--muted); font-size: 11.5px; }
	.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 5px; }
	button { border: 1px solid var(--border); background: var(--panel2); color: var(--text); border-radius: 5px; padding: 6px 12px; cursor: pointer; }
	button.primary { background: var(--accent); color: white; border-color: var(--accent); }
	.error { color: var(--error); font-size: 12px; }
</style>
