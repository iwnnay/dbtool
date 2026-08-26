# dbtool

A browser-based, dark, keyboard-first query tool for SQL Server, PostgreSQL,
and SQLite. SQL Server runs under your Windows identity; PostgreSQL credentials
come from environment variables; SQLite databases are opened directly from
their files.

For a guided tour of connections, querying, result controls, saved data, and
troubleshooting, see [docs/onboarding.md](docs/onboarding.md).

## Prerequisites

- Windows 10/11 or Windows Server
- Node.js 24.x and npm (`node:sqlite` is used by the SQLite worker)
- Git and SSH access to the private `Wilmington-Health/nacelle-svelte`
  repository for a cold install
- PowerShell 7 (`pwsh`) for SQL Server connections
- Network and database permissions for the databases you intend to use

## Quick start

From PowerShell:

```powershell
Copy-Item .env.example .env
npm install
npm run check
npm test
npm run dev
```

Open <http://localhost:9999>. Change `PORT` or `HOST` in `.env` if needed.

`npm install` fetches the pinned nacelle dependency over Git SSH. If that step
fails, verify `git` is installed and `ssh -T git@github.com` succeeds for an
account with repository access.

## Production build

```powershell
npm ci
npm run db:migrate
npm run build
$env:HOST = '127.0.0.1'
$env:PORT = '9999'
npm start
```

Run the process under the Windows account whose integrated identity should be
used for SQL Server. Put deployment values in the service environment; do not
commit `.env` or database passwords.

## Database connections

Click **+** in Database Explorer and choose an engine:

- **SQL Server** uses a persistent PowerShell/.NET SqlClient bridge with Windows
  integrated authentication.
- **PostgreSQL** uses a persistent `pg` client per sheet. Enter the name of a
  password environment variable (for example `DBTOOL_PG_PASSWORD`) and set its
  value before dbtool starts. Password values are not stored in
  `data/config.json`.
- **SQLite** takes a database file path and supports read-only mode. It uses a
  persistent Node worker so temporary tables and session state survive between
  runs in a sheet.

Existing configs with the original `servers: string[]` shape migrate
automatically. Existing connection IDs remain stable.

## Features

- Explorer tree for connections, databases, schemas, tables, views, procedures,
  and columns
- Tabbed, auto-saved query sheets with a persistent connection per sheet
- `Ctrl+Enter` to run the selection or current statement;
  `Ctrl+Shift+Enter` to run the whole sheet; SQL Server `GO` batches supported
- Virtualized results with a 10,000-row display cap per result set
- Full loaded-result search: click the grid, press `Ctrl+F`, then use `Enter` and
  `Shift+Enter` to move through matches
- Tri-state column sorting: click for ascending, descending, then unsorted;
  `Shift+click` builds a prioritized multi-column sort
- Multiple result-set tabs, server messages, mapped errors, query history,
  safe row deletion, TSV copy, and Excel export
- Dialect-aware generated SQL, identifier quoting, editor completion, metadata,
  datamaps, and Ask prompts
- Per-database ignore lists for hiding unused tables from the explorer, search,
  autocomplete, datamaps, and Ask

## Ask and datamaps

Right-click a database and choose **Ask** to generate dialect-appropriate SQL
from a grounded schema snapshot. Datamaps are stored in `data/datamaps/` and are
rebuilt incrementally. Configure Ollama or OpenAI in `.env`; local defaults and
available variables are described in `.env.example`.

## Development commands

```powershell
npm run dev          # development server with hot reload
npm run check        # Svelte and TypeScript checks
npm test             # Vitest suite plus HTML/text coverage
npm run test:watch   # focused test development
npm run build        # production bundle
npm run preview      # preview the production bundle
npm run db:migrate   # apply local data migrations
```

The HTML coverage report is written to `coverage/index.html`.

## Architecture

```text
scripts/sql-bridge.ps1              persistent SQL Server worker
scripts/db-worker.mjs               persistent PostgreSQL/SQLite worker
src/lib/server/db/bridgeManager.ts  bridge lifecycle, queueing, timeout, cancel
src/lib/server/db/meta.ts           SQL Server catalog queries
src/lib/server/db/dialectMeta.ts    PostgreSQL/SQLite catalog adapters
src/lib/server/store.ts             connection and sheet persistence
src/lib/sql/split.ts                GO/semicolon statement splitter
src/lib/client/                     explorer, editor, grid, dialogs
src/routes/api/db/                  database API endpoints
src/routes/api/sheets/              sheet CRUD endpoints
data/                               gitignored local configuration and content
```

Browsers cannot use the current Windows identity directly for TDS. The server
therefore keeps a `.NET SqlClient` process open per SQL Server sheet, communicates
with it using JSON lines, and restarts it transparently after cancellation.

Registered connections live in `data/config.json`; query sheets, ignore lists,
datamaps, history, and logs also live under gitignored local paths. Back up the
`data/` directory if those artifacts matter to your workflow.
