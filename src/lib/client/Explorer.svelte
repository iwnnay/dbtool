<script lang="ts">
	import { app } from './app.svelte';
	import { catalog, bracket } from './catalog.svelte';
	import type { DbObject } from './api';
	import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
	import InsertRowModal from './InsertRowModal.svelte';
	import ColumnsModal from './ColumnsModal.svelte';
	import PropertiesModal from './PropertiesModal.svelte';
	import AskModal from './AskModal.svelte';
	import IgnoreModal from './IgnoreModal.svelte';
	import { api } from './api';

	let {
		onInsert,
		onAppendSql,
		onUseDatabase
	}: {
		onInsert: (text: string) => void;
		onAppendSql: (sql: string) => void;
		onUseDatabase: (server: string, database: string) => void;
	} = $props();

	let search = $state('');
	let expanded = $state<Record<string, boolean>>({});
	let addingServer = $state(false);
	let newServerName = $state('');

	interface TableRef {
		server: string;
		db: string;
		schema: string;
		table: string;
	}
	let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
	let modal = $state<
		| (TableRef & { kind: 'insert' | 'columns' | 'properties' | 'askTable' })
		| { kind: 'ask' | 'ignore'; server: string; db: string }
		| null
	>(null);

	function toggle(key: string) {
		expanded[key] = !expanded[key];
	}

	function toggleServer(server: string) {
		toggle(`s|${server}`);
		if (expanded[`s|${server}`]) void catalog.loadDatabases(server);
	}

	function toggleDb(server: string, db: string) {
		const key = `d|${server}|${db}`;
		toggle(key);
		if (expanded[key]) void catalog.loadObjects(server, db);
	}

	function toggleTable(t: TableRef) {
		const key = `t|${t.server}|${t.db}|${t.schema}|${t.table}`;
		toggle(key);
		if (expanded[key]) void catalog.loadColumns(t.server, t.db, t.schema, t.table);
	}

	function schemasOf(objects: DbObject[]): { name: string; objects: DbObject[] }[] {
		const map = new Map<string, DbObject[]>();
		for (const o of objects) {
			let list = map.get(o.schema);
			if (!list) map.set(o.schema, (list = []));
			list.push(o);
		}
		return [...map.entries()].map(([name, objs]) => ({ name, objects: objs }));
	}

	function insertSelect(schema: string, table: string) {
		onInsert(`SELECT TOP (100) *\nFROM ${bracket(schema)}.${bracket(table)}\n`);
	}

	function objIcon(type: DbObject['type']): string {
		return type === 'view' ? '▤' : type === 'procedure' ? '⚙' : '▦';
	}

	/** Open the procedure's T-SQL source in a new sheet named after it. */
	async function viewDefinition(ref: TableRef) {
		try {
			const { definition } = await api.definition(ref.server, ref.db, ref.schema, ref.table);
			await app.newSheet({
				server: ref.server,
				database: ref.db,
				name: `${ref.schema}.${ref.table}`,
				sql: definition
			});
		} catch (caught) {
			app.flash(`Could not load definition of ${ref.schema}.${ref.table}: ${(caught as Error).message}`);
		}
	}

	function openMenu(e: MouseEvent, items: MenuItem[]) {
		e.preventDefault();
		menu = { x: e.clientX, y: e.clientY, items };
	}

	function serverMenuItems(server: string): MenuItem[] {
		return [
			{
				label: 'Close connection',
				action: () =>
					void api.disconnect(server).then(({ closed }) => {
						app.flash(
							closed > 0
								? `Closed ${closed} connection${closed === 1 ? '' : 's'} to ${server}`
								: `No open connections to ${server}`
						);
					})
			},
			{ label: 'Refresh databases', action: () => void catalog.loadDatabases(server, true) },
			{
				label: 'Remove server…',
				action: () => {
					if (confirm(`Remove ${server} from the server list? (Closes its connections; you can re-add it any time.)`)) {
						void api.disconnect(server).then(() => app.removeServer(server));
					}
				}
			}
		];
	}

	function dbMenuItems(server: string, db: string): MenuItem[] {
		return [
			{ label: 'New Query', action: () => void app.newSheet({ server, database: db }) },
			{ label: 'Ask…', action: () => (modal = { kind: 'ask', server, db }) },
			{ label: 'Ignore list…', action: () => (modal = { kind: 'ignore', server, db }) },
			{
				label: 'Close connections to this database',
				action: () =>
					void api.disconnect(server, db).then(({ closed }) => {
						app.flash(
							closed > 0
								? `Closed ${closed} connection${closed === 1 ? '' : 's'} to ${db}`
								: `No open connections to ${db}`
						);
					})
			},
			{
				label: 'Show properties',
				action: () => (modal = { kind: 'properties', server, db, schema: '', table: '' })
			}
		];
	}

	/** Quick-add one table to the database's ignore list and refresh the tree. */
	async function ignoreTable(t: TableRef) {
		const { ignored } = await api.getIgnore(t.server, t.db);
		await api.saveIgnore(t.server, t.db, [...ignored, `${t.schema}.${t.table}`]);
		void catalog.loadObjects(t.server, t.db, true);
	}

	function menuItems(t: TableRef): MenuItem[] {
		return [
			{
				label: 'Select top 1000',
				action: () =>
					void app.newSheet({
						server: t.server,
						database: t.db,
						sql: `SELECT TOP (1000) *\nFROM ${bracket(t.schema)}.${bracket(t.table)};\n`
					})
			},
			{ label: 'Ask about this table…', action: () => (modal = { ...t, kind: 'askTable' }) },
			{ label: 'Insert row…', action: () => (modal = { ...t, kind: 'insert' }) },
			{ label: 'Show columns', action: () => (modal = { ...t, kind: 'columns' }) },
			{ label: 'Show properties', action: () => (modal = { ...t, kind: 'properties' }) },
			{ label: 'Ignore table', action: () => void ignoreTable(t) }
		];
	}

	function procMenuItems(ref: TableRef): MenuItem[] {
		return [
			{ label: 'View definition', action: () => void viewDefinition(ref) },
			{
				label: 'Insert EXEC',
				action: () => onInsert(`EXEC ${bracket(ref.schema)}.${bracket(ref.table)};\n`)
			},
			{ label: 'Ignore procedure', action: () => void ignoreTable(ref) }
		];
	}

	// ---- search: instant, across every database whose objects are loaded ----
	interface Hit {
		server: string;
		db: string;
		o: DbObject;
	}
	const MAX_HITS = 400;
	const hits = $derived.by<Hit[]>(() => {
		const q = search.trim().toLowerCase();
		if (!q) return [];
		const starts: Hit[] = [];
		const contains: Hit[] = [];
		for (const [key, objects] of Object.entries(catalog.objects)) {
			const sep = key.indexOf('|');
			const server = key.slice(0, sep);
			const db = key.slice(sep + 1);
			for (const o of objects) {
				const name = o.name.toLowerCase();
				const full = `${o.schema.toLowerCase()}.${name}`;
				if (name.startsWith(q) || full.startsWith(q)) starts.push({ server, db, o });
				else if (full.includes(q)) contains.push({ server, db, o });
				if (starts.length >= MAX_HITS) break;
			}
		}
		return [...starts, ...contains].slice(0, MAX_HITS);
	});
	const searchedDbCount = $derived(Object.keys(catalog.objects).length);

	async function addServer() {
		const name = newServerName.trim();
		if (!name) return;
		await app.addServer(name);
		newServerName = '';
		addingServer = false;
		toggleServer(name);
	}
</script>

<div class="explorer">
	<div class="head">
		<span class="title">Database Explorer</span>
		<button class="icon-btn" title="Add server" onclick={() => (addingServer = !addingServer)}>+</button>
	</div>
	{#if addingServer}
		<div class="add-server">
			<!-- svelte-ignore a11y_autofocus -->
			<input
				placeholder="server\instance"
				bind:value={newServerName}
				autofocus
				onkeydown={(e) => e.key === 'Enter' && addServer()}
			/>
			<button class="icon-btn" onclick={addServer}>✓</button>
		</div>
	{/if}
	<div class="search">
		<input placeholder="Search tables & procedures…" bind:value={search} />
		{#if search}
			<button class="icon-btn clear" onclick={() => (search = '')}>✕</button>
		{/if}
	</div>

	<div class="tree">
		{#if search.trim()}
			<div class="search-info">
				{hits.length}{hits.length >= MAX_HITS ? '+' : ''} matches in {searchedDbCount} indexed database{searchedDbCount === 1 ? '' : 's'}
				{#if searchedDbCount === 0}<br /><em>Expand a database once to index it.</em>{/if}
			</div>
			{#each hits as h (h.server + h.db + h.o.schema + h.o.name)}
				{@const hitRef = { server: h.server, db: h.db, schema: h.o.schema, table: h.o.name }}
				{@const isProc = h.o.type === 'procedure'}
				<div
					class="node hit"
					role="button"
					tabindex="0"
					ondblclick={() => (isProc ? void viewDefinition(hitRef) : insertSelect(h.o.schema, h.o.name))}
					oncontextmenu={(e) => openMenu(e, isProc ? procMenuItems(hitRef) : menuItems(hitRef))}
					onkeydown={(e) => {
						if (e.key !== 'Enter') return;
						if (isProc) void viewDefinition(hitRef);
						else insertSelect(h.o.schema, h.o.name);
					}}
					title="{h.server} · {h.db} — double-click to {isProc ? 'open definition' : 'insert SELECT'}, right-click for actions"
				>
					<span class="obj-icon" class:view={h.o.type === 'view'} class:proc={isProc}>{objIcon(h.o.type)}</span>
					<span class="hit-name">{h.o.schema}.{h.o.name}</span>
					<span class="hit-db">{h.db}</span>
				</div>
			{/each}
		{:else}
			{#each app.servers as server (server)}
				{@const sKey = `s|${server}`}
				<div class="node server" role="button" tabindex="0"
					onclick={() => toggleServer(server)}
					onkeydown={(e) => e.key === 'Enter' && toggleServer(server)}
					oncontextmenu={(e) => openMenu(e, serverMenuItems(server))}
					title="Right-click: connection actions">
					<span class="chev" class:open={expanded[sKey]}>▸</span>
					<span class="srv-icon">⛁</span>
					<span class="name">{server}</span>
				</div>
				{#if expanded[sKey]}
					{#if catalog.loading[server]}<div class="note">loading…</div>{/if}
					{#if catalog.errors[server]}<div class="note err" title={catalog.errors[server]}>⚠ {catalog.errors[server]}</div>{/if}
					{#each catalog.databases[server] ?? [] as db (db.name)}
						{@const dKey = `d|${server}|${db.name}`}
						{@const oKey = `${server}|${db.name}`}
						<div class="node db" class:system={db.isSystem} role="button" tabindex="0"
							onclick={() => toggleDb(server, db.name)}
							onkeydown={(e) => e.key === 'Enter' && toggleDb(server, db.name)}
							ondblclick={() => onUseDatabase(server, db.name)}
							oncontextmenu={(e) => openMenu(e, dbMenuItems(server, db.name))}
							title="Double-click: point current sheet at this database · right-click: actions">
							<span class="chev" class:open={expanded[dKey]}>▸</span>
							<span class="db-icon">◫</span>
							<span class="name">{db.name}</span>
							{#if expanded[dKey]}
								<button class="icon-btn refresh" title="Refresh"
									onclick={(e) => { e.stopPropagation(); void catalog.loadObjects(server, db.name, true); }}>⟳</button>
							{/if}
						</div>
						{#if expanded[dKey]}
							{#if catalog.loading[oKey]}<div class="note deep">loading…</div>{/if}
							{#if catalog.errors[oKey]}<div class="note deep err" title={catalog.errors[oKey]}>⚠ {catalog.errors[oKey]}</div>{/if}
							{#each schemasOf(catalog.objects[oKey] ?? []) as sch (sch.name)}
								{@const schKey = `h|${server}|${db.name}|${sch.name}`}
								<div class="node schema" role="button" tabindex="0"
									onclick={() => toggle(schKey)}
									onkeydown={(e) => e.key === 'Enter' && toggle(schKey)}>
									<span class="chev" class:open={expanded[schKey]}>▸</span>
									<span class="name">{sch.name}</span>
									<span class="badge">{sch.objects.length}</span>
								</div>
								{#if expanded[schKey]}
									{#each sch.objects as o (o.name)}
										{@const tRef = { server, db: db.name, schema: sch.name, table: o.name }}
										{@const tKey = `t|${server}|${db.name}|${sch.name}|${o.name}`}
										{@const cKey = `${server}|${db.name}|${sch.name}|${o.name}`}
										{#if o.type === 'procedure'}
											<div class="node table" role="button" tabindex="0"
												ondblclick={() => void viewDefinition(tRef)}
												onkeydown={(e) => {
													if (e.key === 'Enter') void viewDefinition(tRef);
												}}
												oncontextmenu={(e) => openMenu(e, procMenuItems(tRef))}
												title="Double-click: open definition · right-click: actions">
												<span class="chev"></span>
												<span class="obj-icon proc">⚙</span>
												<span class="name">{o.name}</span>
											</div>
										{:else}
										<div class="node table" role="button" tabindex="0"
											onclick={() => toggleTable(tRef)}
											onkeydown={(e) => e.key === 'Enter' && toggleTable(tRef)}
											ondblclick={() => insertSelect(sch.name, o.name)}
											oncontextmenu={(e) => openMenu(e, menuItems(tRef))}
											title="Double-click: insert SELECT · right-click: actions">
											<span class="chev" class:open={expanded[tKey]}>▸</span>
											<span class="obj-icon" class:view={o.type === 'view'}>{o.type === 'view' ? '▤' : '▦'}</span>
											<span class="name">{o.name}</span>
										</div>
										{/if}
										{#if expanded[tKey]}
											{#if catalog.loading[cKey]}<div class="note deeper">loading…</div>{/if}
											{#each catalog.columns[cKey] ?? [] as c (c.name)}
												<div class="node col" role="button" tabindex="0"
													ondblclick={() => onInsert(bracket(c.name))}
													title="Double-click: insert column name">
													<span class="col-key">{c.isPk ? '🔑' : ''}</span>
													<span class="name">{c.name}</span>
													<span class="col-type">{c.display}{c.nullable ? '' : ' •'}</span>
												</div>
											{/each}
										{/if}
									{/each}
								{/if}
							{/each}
						{/if}
					{/each}
				{/if}
			{/each}
			{#if app.servers.length === 0}
				<div class="note">No servers yet — click <strong>+</strong> above and add one, e.g. <code>localhost\SQLEXPRESS</code></div>
			{/if}
		{/if}
	</div>
</div>

{#if menu}
	<ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
{/if}

{#if modal?.kind === 'ask'}
	<AskModal
		scope="database"
		server={modal.server}
		database={modal.db}
		{onAppendSql}
		onClose={() => (modal = null)}
	/>
{:else if modal?.kind === 'askTable'}
	<AskModal
		scope="table"
		server={modal.server}
		database={modal.db}
		schema={modal.schema}
		table={modal.table}
		{onAppendSql}
		onClose={() => (modal = null)}
	/>
{:else if modal?.kind === 'ignore'}
	<IgnoreModal server={modal.server} database={modal.db} onClose={() => (modal = null)} />
{:else if modal?.kind === 'insert'}
	<InsertRowModal
		server={modal.server}
		database={modal.db}
		schema={modal.schema}
		table={modal.table}
		{onAppendSql}
		onClose={() => (modal = null)}
	/>
{:else if modal?.kind === 'columns'}
	<ColumnsModal
		server={modal.server}
		database={modal.db}
		schema={modal.schema}
		table={modal.table}
		onClose={() => (modal = null)}
	/>
{:else if modal?.kind === 'properties'}
	<PropertiesModal server={modal.server} database={modal.db} onClose={() => (modal = null)} />
{/if}

<style>
	.explorer {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: var(--panel);
		border-right: 1px solid var(--border);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 12px 6px;
	}
	.title {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.add-server {
		display: flex;
		gap: 4px;
		padding: 0 10px 6px;
	}
	.search {
		position: relative;
		padding: 0 10px 8px;
	}
	.search input,
	.add-server input {
		width: 100%;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--text);
		font-size: 12.5px;
		padding: 6px 9px;
		outline: none;
	}
	.search input:focus,
	.add-server input:focus {
		border-color: var(--accent);
	}
	.search .clear {
		position: absolute;
		right: 16px;
		top: 5px;
	}
	.icon-btn {
		background: transparent;
		border: none;
		color: var(--muted);
		cursor: pointer;
		font-size: 13px;
		padding: 2px 6px;
		border-radius: 4px;
	}
	.icon-btn:hover {
		color: var(--text);
		background: var(--panel2);
	}
	.tree {
		flex: 1;
		overflow: auto;
		padding: 0 4px 20px;
		font-size: 12.5px;
		user-select: none;
	}
	.node {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 3px 6px;
		border-radius: 5px;
		cursor: pointer;
		white-space: nowrap;
		color: var(--text);
	}
	.node:hover {
		background: var(--panel2);
	}
	.node .name {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.chev {
		flex: none;
		width: 12px;
		color: var(--muted);
		font-size: 10px;
		transition: transform 0.12s;
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.srv-icon,
	.db-icon,
	.obj-icon {
		flex: none;
		color: var(--accent);
		font-size: 12px;
	}
	.obj-icon.view {
		color: var(--ok);
	}
	.obj-icon.proc {
		color: var(--warn);
	}
	.node.db {
		padding-left: 20px;
	}
	.node.db.system {
		opacity: 0.55;
	}
	.node.schema {
		padding-left: 36px;
		color: var(--muted);
	}
	.node.table {
		padding-left: 52px;
	}
	.node.col {
		padding-left: 76px;
		cursor: default;
	}
	.node.col .name {
		color: var(--text);
	}
	.col-key {
		flex: none;
		width: 14px;
		font-size: 9px;
	}
	.col-type {
		margin-left: auto;
		color: var(--muted);
		font-size: 11px;
		font-family: var(--mono);
	}
	.badge {
		margin-left: auto;
		background: var(--panel2);
		color: var(--muted);
		border-radius: 8px;
		font-size: 10px;
		padding: 0 6px;
	}
	.refresh {
		margin-left: auto;
		font-size: 11px;
	}
	.note {
		padding: 3px 6px 3px 26px;
		color: var(--muted);
		font-size: 11.5px;
	}
	.note.deep {
		padding-left: 42px;
	}
	.note.deeper {
		padding-left: 76px;
	}
	.note.err {
		color: var(--error);
		white-space: normal;
	}
	.search-info {
		padding: 4px 8px 8px;
		color: var(--muted);
		font-size: 11.5px;
	}
	.node.hit .hit-name {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.node.hit .hit-db {
		margin-left: auto;
		color: var(--muted);
		font-size: 10.5px;
	}
	code {
		font-family: var(--mono);
		font-size: 11px;
	}
</style>
