# dbtool onboarding

dbtool is one browser interface for exploring and querying SQL Server,
PostgreSQL, and SQLite. This guide covers what is already implemented and the
safest path from a clean checkout to daily use.

## 1. Install and start it

You need Windows, Node.js 24.x, npm, Git, and PowerShell 7 (`pwsh`). A cold npm
install also needs GitHub SSH access to the private
`Wilmington-Health/nacelle-svelte` repository.

From the repository root in PowerShell:

```powershell
Copy-Item .env.example .env
npm install
npm run check
npm test
npm run dev
```

Browse to <http://localhost:9999>. The same process serves the UI and API. Edit
`PORT` and `HOST` in `.env` if needed. An LLM is optional for normal querying;
configure Ollama or OpenAI only if you want Ask and datamap descriptions.

Before developing or deploying, verify `npm run check`, `npm test`, and
`npm run build`. Tests print coverage and create `coverage/index.html`.

## 2. Add a connection

Select **+** in Database Explorer, choose an engine, and complete its fields.

### SQL Server

Enter the server and optional initial database. Connections use Windows
Integrated Security, so dbtool must run under an account with database access.
PowerShell 7 hosts the persistent .NET bridge; confirm `pwsh --version` works if
startup fails. Each sheet has its own live bridge, preserving temporary tables
and session settings. Cancellation ends that bridge and the next run reconnects.

### PostgreSQL

Enter host, port, user, initial database, and TLS preference. In the password
field enter an environment variable **name**, not its value. Set it before
starting dbtool:

```powershell
$env:DBTOOL_PG_PASSWORD = 'your-password-from-a-secret-store'
npm run dev
```

Only `DBTOOL_PG_PASSWORD` is saved in the profile; its value is not written to
`data/config.json`. A launcher or service must supply it on future starts.

### SQLite

Enter an absolute or working-directory-relative database-file path. Use
read-only mode for files that must not change. A persistent Node worker maintains
sheet-local temporary state. SQLite has no server database list or stored
procedures, so unsupported actions are hidden.

## 3. Explore and query

Expand a connection to browse databases, schemas, objects, and columns.
Double-click a database to select it for the current sheet. Double-click a table
or use its context menu to create a dialect-appropriate sample `SELECT`.
Right-click objects for refresh, properties, definition, insert, ignore, close,
and removal actions where supported.

Sheets are tabbed and auto-saved while typing and whenever SQL runs:

- `Ctrl+Enter`: run the selection or statement under the cursor
- `Ctrl+Shift+Enter`: run the entire sheet
- `Ctrl+Space`: request editor completion

SQL Server `GO` batches are recognized. Generated SQL, quoting, completion,
metadata, row editing, and Ask follow the active engine's dialect.

## 4. Work with results

Each result set has a tab. The grid displays at most 10,000 loaded rows per set;
searching and sorting cover those rows, not rows the query did not return.

Click in the result area and press `Ctrl+F` to search every cell
case-insensitively, including displayed `NULL` values. `Enter` moves forward,
`Shift+Enter` moves backward, and `Escape` closes search. The current match is
scrolled into view and highlighted.

Click a column header to cycle ascending, descending, and unsorted. `Shift+click`
adds a column to a prioritized multi-column sort; badges show direction and
priority. Sorting is stable, equal values retain database order, and `NULL`
sorts last ascending. Copy/export follows displayed order. Deletion retains the
original row identity so sorting cannot target another record.

Result actions copy TSV with or without headers or export result sets to Excel.
Double-click a cell to copy its value. The Messages tab shows server output and
mapped errors, and query history is stored locally.

## 5. Ignore lists and Ask

Database ignore lists hide unhelpful tables from the explorer, table search,
autocomplete, datamaps, and Ask, while explicit SQL can still query them. Add a
bare table name or `schema.table` per line, import a supported allowlist TSV, or
quick-ignore from a table context menu.

Ask uses a datamap of schema, row counts, keys, columns, and optional LLM table
descriptions to generate SQL for the active engine. On large databases it puts
question-relevant and large tables first in the prompt.

## 6. Local data and secrets

Local gitignored content includes:

- `data/config.json`: connection profiles, excluding password values
- `data/sheets/`: query sheets
- `data/ignore/`: ignore lists
- `data/datamaps/`: Ask context
- local history and optional logs

Back up `data/` to preserve the workspace. Do not commit `.env`, passwords,
sensitive database files, or exports. Use a secret manager or service environment
for production credentials.

## 7. Production operation

```powershell
npm ci
npm run db:migrate
npm run build
$env:HOST = '127.0.0.1'
$env:PORT = '9999'
npm start
```

Run under the intended Windows service identity for SQL Server and supply
PostgreSQL password variables to that process. Persist `data/` separately from
disposable build output.

## 8. Troubleshooting

### npm install cannot fetch nacelle

Run `ssh -T git@github.com`; confirm the GitHub account can access
`Wilmington-Health/nacelle-svelte` and Git is on `PATH`.

### SQL Server does not connect

Confirm `pwsh --version`, the process's Windows identity, database permissions,
and network access. Closing a failed connection and rerunning starts a new bridge.

### PostgreSQL reports a missing password

Set the environment variable named in the profile **before** starting dbtool,
then restart it. Check host, port, database, TLS, and network access separately.

### SQLite cannot open or modify a file

Check the path from dbtool's working directory and the Windows account's file
permissions. For writes, disable read-only mode and check external file locking.

### A result search misses expected rows

Search covers loaded grid rows only. Narrow the query or add a SQL predicate when
the desired row may be beyond the 10,000-row display cap.
