# migrations

State-shape migrations run by `npm run db:migrate` (the deployment console's
`migrateCommand` for svelte apps). They run on every deploy, between build and
start.

This app ships with **no migrations** — its SQLite tables are created on demand
(`CREATE TABLE IF NOT EXISTS`), and config is plain YAML — so `db:migrate` is a
clean no-op until you add one. The runner exists so there's always a migration
step to hook into.

## Deliberately not tied to an ORM

A migration is just a script. Reshape whatever persistent state you keep:

- rewrite fields in a JSON file under `data/`
- run DDL/DML against the SQLite store via Node's built-in `node:sqlite`
- talk to an external database with whatever client you add

There is no Drizzle (or any ORM) here. If you adopt one later, its migration
command can either replace `db:migrate` or be invoked from a migration file.

## Conventions

- Filename: `NNNN_short-description.js` (e.g. `0001_seed-defaults.js`). The
  zero-padded numeric prefix sets order.
- Each file exports `export async function up(context)`. One-way only — no `down`.
- `context.paths`:
  - `projectRoot` — the app directory
  - `dataRoot` — the app's `data/` dir (override with `DATA_ROOT`)
- **Be idempotent** and **tolerate missing state** — a first-install host may have
  nothing yet. Check before you mutate.

Applied migrations are tracked in `data/.migrations-applied.json`
(override with `MIGRATIONS_STATE_FILE`); a successful migration won't re-run.

## Example

`0001_seed-defaults.js`:

```js
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function up({ paths }) {
  const file = path.join(paths.dataRoot, 'settings.json');
  if (!existsSync(file)) return; // nothing to reshape yet
  const data = JSON.parse(await readFile(file, 'utf-8'));
  if (data.theme === undefined) {
    data.theme = 'light';
    await writeFile(file, JSON.stringify(data, null, 2), 'utf-8');
  }
}
```

## Removing the migration step

Delete this `migrations/` directory, `scripts/migrate.js`, and the `db:migrate`
script in `package.json`. Then set `migrateCommand` to empty in the app's
`wh.json` (or in the console) so the deploy skips the step.
