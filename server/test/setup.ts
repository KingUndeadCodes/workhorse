import { beforeEach, vi } from 'vitest';

/**
 * Replaces `db/core`'s module-level `stateDb`/`eventsDb`/`db`/`eventsKysely` with fresh,
 * disk-free instances for every test file, and turns `persistState`/`persistEvents` into
 * no-ops. Everything that reads those bindings — schema.ts's migrations, every repository,
 * eventLog.ts — imports them from `./core` (or `../db/core`), so mocking this one module is
 * enough to make the whole app run entirely in memory without ever touching the real
 * `server/data/state.db`/`events.db` the dev server also writes to.
 *
 * Vitest gives each test file its own module registry by default, so this async factory
 * (it awaits `initSqlJs()`) runs once per file — each file gets its own isolated database.
 */
vi.mock('../src/db/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/db/core')>();
  const { default: initSqlJs } = await import('sql.js');
  const { Kysely } = await import('kysely');
  const { SqlJsDialect } = await import('kysely-wasm');

  const SQL = await initSqlJs();
  const stateDb = new SQL.Database();
  const eventsDb = new SQL.Database();
  const db = new Kysely({ dialect: new SqlJsDialect({ database: stateDb }) });
  const eventsKysely = new Kysely({ dialect: new SqlJsDialect({ database: eventsDb }) });

  return {
    ...actual,
    stateDb,
    eventsDb,
    db,
    eventsKysely,
    persistState: () => {},
    persistEvents: () => {},
  };
});

// Runs the real schema migrations against the mocked (in-memory) stateDb/eventsDb above —
// same idempotent CREATE TABLE IF NOT EXISTS statements the real server boots with.
const { migrateStateDb, migrateEventsDb } = await import('../src/db/schema');
migrateStateDb();
migrateEventsDb();

// Vitest gives each test *file* a fresh module registry (and so a fresh database, from the
// mock above), but every `it()` within one file shares that same database — without this,
// a second test in the same file reusing a fixture id/email (a very natural thing to do)
// collides with a row the previous test already inserted. Clearing every table between
// tests is simpler and more robust than requiring every fixture everywhere to be unique.
beforeEach(async () => {
  const { stateDb, eventsDb, run, all } = await import('../src/db/core');
  for (const database of [stateDb, eventsDb]) {
    const tables = all<{ name: string }>(database, `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`);
    for (const { name } of tables) run(database, `DELETE FROM "${name}"`);
  }
});
