<script lang="ts">
	import Modal from './Modal.svelte';
	import { api, type ColumnInfo } from './api';
	import { catalog, bracket } from './catalog.svelte';
	import { app } from './app.svelte';

	let {
		server,
		database,
		schema,
		table,
		onClose,
		onAppendSql
	}: {
		server: string;
		database: string;
		schema: string;
		table: string;
		onClose: () => void;
		onAppendSql: (sql: string) => void;
	} = $props();

	type Mode = 'value' | 'null' | 'default';
	interface Field {
		col: ColumnInfo;
		mode: Mode;
		text: string;
	}

	let fields = $state<Field[]>([]);
	let error = $state('');
	let running = $state(false);
	let success = $state(false);

	const colKey = $derived(`${server}|${database}|${schema}|${table}`);

	$effect(() => {
		void catalog.loadColumns(server, database, schema, table).then(() => {
			const cols = catalog.columns[colKey] ?? [];
			fields = cols
				.filter((c) => !c.identity && !c.computed && !['timestamp', 'rowversion'].includes(c.type))
				.map((c) => ({ col: c, mode: c.nullable ? 'null' : 'value', text: '' }));
		});
	});

	const NUMERIC = new Set([
		'int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney'
	]);
	const NSTRING = new Set(['nvarchar', 'nchar', 'ntext', 'sysname']);
	const BINARY = new Set(['binary', 'varbinary', 'image']);

	function literal(f: Field): string {
		const t = f.col.type;
		const v = f.text;
		if (NUMERIC.has(t)) {
			if (!/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(v.trim())) {
				throw new Error(`"${f.col.name}": "${v}" is not a valid ${t}`);
			}
			return v.trim();
		}
		if (t === 'bit') {
			const b = v.trim().toLowerCase();
			if (['1', 'true'].includes(b)) return '1';
			if (['0', 'false'].includes(b)) return '0';
			throw new Error(`"${f.col.name}": bit must be 0/1/true/false`);
		}
		if (BINARY.has(t)) {
			if (!/^0x[0-9a-fA-F]*$/.test(v.trim())) {
				throw new Error(`"${f.col.name}": ${t} must be hex like 0xFF00`);
			}
			return v.trim();
		}
		const quoted = `'${v.replace(/'/g, "''")}'`;
		return NSTRING.has(t) ? `N${quoted}` : quoted;
	}

	function target(qualified: boolean): string {
		const st = `${bracket(schema)}.${bracket(table)}`;
		return qualified ? `${bracket(database)}.${st}` : st;
	}

	function buildSql(qualified: boolean): string {
		const included = fields.filter((f) => f.mode !== 'default');
		if (included.length === 0) return `INSERT INTO ${target(qualified)} DEFAULT VALUES;`;
		const names = included.map((f) => bracket(f.col.name)).join(', ');
		const values = included.map((f) => (f.mode === 'null' ? 'NULL' : literal(f))).join(', ');
		return `INSERT INTO ${target(qualified)} (${names})\nVALUES (${values});`;
	}

	/** Two-part name if the active sheet is already on this server+db, else three-part. */
	function sheetQualified(): boolean {
		const s = app.activeSheet;
		return !(s && s.server === server && s.database === database);
	}

	function addQuery() {
		error = '';
		try {
			onAppendSql(buildSql(sheetQualified()));
			onClose();
		} catch (e) {
			error = (e as Error).message;
		}
	}

	async function runQuery() {
		error = '';
		let sql: string;
		try {
			sql = buildSql(true);
		} catch (e) {
			error = (e as Error).message;
			return;
		}
		running = true;
		try {
			const res = await api.run({ sheetId: `insert:${server}`, server, database, sql });
			if (res.ok) {
				success = true;
				setTimeout(onClose, 1000);
			} else {
				error = res.error?.text ?? 'Insert failed';
			}
		} catch (e) {
			error = (e as Error).message;
		} finally {
			running = false;
		}
	}
</script>

<Modal title="Insert row — {schema}.{table}" width={640} {onClose}>
	{#if success}
		<div class="banner ok">✓ Query ran successfully</div>
	{:else}
		{#if catalog.loading[colKey]}
			<div class="note">Loading columns…</div>
		{:else if fields.length === 0}
			<div class="note">No insertable columns (identity/computed columns are set by the server).</div>
		{/if}
		{#if fields.length > 0}
			<div class="form">
				{#each fields as f (f.col.name)}
					<div class="row">
						<span class="col-name" title={f.col.isPk ? 'primary key' : ''}>
							{f.col.isPk ? '🔑 ' : ''}{f.col.name}
						</span>
						<span class="col-type">{f.col.display}</span>
						<select bind:value={f.mode}>
							<option value="value">value</option>
							{#if f.col.nullable}<option value="null">NULL</option>{/if}
							<option value="default">default</option>
						</select>
						<input
							bind:value={f.text}
							disabled={f.mode !== 'value'}
							placeholder={f.mode === 'value' ? f.col.display : f.mode.toUpperCase()}
							onfocus={() => (f.mode = 'value')}
						/>
					</div>
				{/each}
			</div>
		{/if}
		{#if error}
			<div class="banner err">✕ {error}</div>
		{/if}
		<div class="actions">
			<button class="btn" onclick={addQuery} disabled={running || fields.length === 0}>
				Add Query
			</button>
			<button class="btn primary" onclick={runQuery} disabled={running || fields.length === 0}>
				{running ? 'Running…' : 'Run Query'}
			</button>
		</div>
	{/if}
</Modal>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 46vh;
		overflow: auto;
		padding-right: 4px;
	}
	.row {
		display: grid;
		grid-template-columns: minmax(120px, 1.2fr) minmax(80px, 0.8fr) 84px 1.6fr;
		gap: 8px;
		align-items: center;
	}
	.col-name {
		font-family: var(--mono);
		font-size: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.col-type {
		color: var(--muted);
		font-family: var(--mono);
		font-size: 11px;
	}
	.row select {
		max-width: none;
		padding: 4px 6px;
	}
	.row input {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--text);
		font-family: var(--mono);
		font-size: 12px;
		padding: 5px 8px;
		outline: none;
		min-width: 0;
	}
	.row input:focus {
		border-color: var(--accent);
	}
	.row input:disabled {
		opacity: 0.45;
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
	.btn.primary {
		background: var(--accent);
		border-color: var(--accent);
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
	.banner.ok {
		background: rgba(88, 201, 139, 0.12);
		border: 1px solid var(--ok);
		color: var(--ok);
	}
	.banner.err {
		background: rgba(255, 107, 107, 0.1);
		border: 1px solid var(--error);
		color: var(--error);
		font-family: var(--mono);
		white-space: pre-wrap;
	}
	.note {
		color: var(--muted);
		font-size: 12.5px;
	}
</style>
