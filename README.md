# dbtool

A browser-based SQL Server, PostgreSQL, and SQLite query tool — a fast, dark,
keyboard-first home for everyday database exploration. SQL Server continues to
run with **your Windows identity** (Integrated Security).

## Run

```bash
npm install
npm run dev        # http://localhost:9999
```

Production: `npm run build` then `node build`.

## Features

- **Explorer tree** — connections → databases → schemas → tables/views → columns
  (types, PK 🔑, `•` = NOT NULL). Double-click a database to point the current
  sheet at it; double-click a table to insert `SELECT TOP (100)`.
- **Table search** — instant, client-side, across every database you've expanded
  (built for 9000-table databases; prefix matches rank first).
- **Query sheets** — tabbed, each with its **own live connection** (temp tables
  and session state survive between runs, like an SSMS tab). Auto-saved on every
  run + debounced while typing, to `data/sheets/`. Reopen the app, they're back.
- **Ctrl+Enter** runs the statement under the cursor (or the selection).
  **Ctrl+Shift+Enter** runs the whole sheet. `GO` batches supported.
- **Results** — virtualized grid (10k-row display cap per set), multiple result
  sets as tabs, Messages tab with PRINT output and errors (line numbers map back
  to your sheet text). NULLs styled SSMS-style.
- **Export** — Copy TSV, Copy TSV + headers, Export to Excel (.xlsx, one
  worksheet per result set, real dates, frozen header). Double-click a cell to
  copy just that value.
- **Table context menu** (right-click) — Select top 1000 (new sheet), Insert
  row (form-driven INSERT with Add Query / Run Query), Show columns, Show
  properties.
- **Server context menu** (right-click) — **Close connection** (everything on
  that server, including the metadata connection), Refresh databases, Remove
  server.
- **Database context menu** (right-click) — New Query, **Ask** (LLM chat),
  **Ignore list**, Close connections to this database, Show properties.
  Closed connections reconnect transparently on the next run.
- **Ignore lists** — per-database table masks (ported from aco_db_discovery's
  production-usage mask; NGDev has ~9,500 tables but only the few thousand with
  data matter). Ignored tables disappear from the tree, search, autocomplete,
  datamaps and Ask — but still open when named explicitly (columns/insert).
  Manage from the database menu (one `schema.table` or bare name per line), or
  import an allowlist TSV (`TableName` + `EstimatedRowCount` exported from
  production, e.g. aco_db_discovery's `data/ngdev_table_info.tsv`) — tables with
  no production rows get ignored. Quick-ignore any table from its own
  right-click menu. Stored in `data/ignore/` (gitignored).

## Ask (datamap-grounded LLM chat)

Right-click a database → **Ask** to chat with local Ollama about it in plain
English ("find all patients with a last name starting with zzz and an ICD code
of I50.9") and get runnable SQL in the active connection's dialect with an *Add to sheet* button.

Grounding comes from a per-database **datamap** in `data/datamaps/` (gitignored):
a full schema snapshot (every table: row count, PK, and columns) where each table
is fingerprinted, plus one-line table descriptions
written by Ollama in batches (largest `DATAMAP_DESCRIBE_LIMIT` tables, since the
tail of a 9000-table DB is empty templates). Rebuilds are incremental: only
new/schema-changed tables are re-described. The Ask prompt packs
question-relevant tables first, then the largest, capped at ~70k chars — so even
huge databases stay grounded. Model/URL config in `.env` (see `.env.example`);
the model auto-detects from installed Ollama models if unset.

## Database connections

Click **+** in Database Explorer and choose an engine:

- **SQL Server** uses the persistent PowerShell/.NET SqlClient bridge and Windows
  integrated authentication.
- **PostgreSQL** uses a persistent `pg` client per sheet. Supply host, port, user,
  initial database and optional TLS. For passwords, enter the **name** of an
  environment variable (for example `DBTOOL_PG_PASSWORD`) and set that variable
  before starting dbtool; password values are never stored in `data/config.json`.
- **SQLite** takes a database file path and can be opened read-only. It runs in a
  separate persistent Node worker, preserving per-sheet temp/session state and
  allowing cancellation without blocking the web process.

Existing configs containing the original `servers: string[]` shape migrate
automatically. Existing sheets retain their connection because the old server
name becomes the stable connection ID.

Generated SQL, identifier quoting, editor highlighting, metadata, row editing,
datamaps, and Ask prompts follow the selected engine. Engine-specific features
are shown only where they exist (SQLite, for example, has no procedures).

## How Windows Auth works

Browsers can't speak TDS, and on Node 24 the native SQL drivers are broken for
passwordless Windows auth (`msnodesqlv8` hangs; `tedious` can't do it — see
`../aco_db_discovery`, where this was first fought). So the SvelteKit server
spawns **persistent PowerShell bridge processes** (`scripts/sql-bridge.ps1`):
.NET `SqlClient` with `Integrated Security=True`, held open, speaking JSON-lines
over stdin/stdout. One bridge per sheet + one metadata bridge per server.
Cancel = kill the bridge; the next run respawns it transparently.

## Layout

```
scripts/sql-bridge.ps1            the persistent SQL worker (auth lives here)
scripts/db-worker.mjs             persistent PostgreSQL/SQLite worker
src/lib/server/db/bridgeManager.ts  spawn/queue/timeout/cancel of bridges
src/lib/server/db/meta.ts           catalog queries for the explorer tree
src/lib/server/db/dialectMeta.ts    PostgreSQL/SQLite catalog adapters
src/lib/server/store.ts             ./data persistence (connections, sheets)
src/lib/sql/split.ts                GO/; statement splitter (shared, tested)
src/lib/client/                     UI: Explorer, Editor (CodeMirror 6), Grid…
src/routes/api/db/*                 servers/databases/objects/columns/run/cancel
src/routes/api/sheets/*             sheet CRUD
data/                               (gitignored) config.json + sheets/*.json
```

Registered connections live in `data/config.json` — edit there or use the `+` button
in the explorer.

## nacelle

This app was generated from the nacelle template; the LangGraph flow machinery
(`/debug`, `src/lib/server/flows`, `/api/ask`) is intact and unused for now —
earmarked for bringing over the AI features from `../aco_db_discovery`
(schema graph, datamap chat) as a future phase.
