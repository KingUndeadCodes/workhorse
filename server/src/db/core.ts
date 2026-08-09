import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Kysely } from 'kysely';
import { SqlJsDialect } from 'kysely-wasm';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import type { DB, EventsDB } from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');
const STATE_DB_PATH = join(DATA_DIR, 'state.db');
const EVENTS_DB_PATH = join(DATA_DIR, 'events.db');

/**
 * Two genuinely separate SQLite databases (sql.js — SQLite compiled to WASM, so there's no
 * native binary to install or crash; see the segfault we hit with better-sqlite3 on this
 * machine). `stateDb` is the read model the API serves; `eventsDb` is the durable,
 * append-only log. Splitting them into different files, not just different tables, is what
 * makes "audit the database against the log" a meaningful check rather than a query against
 * itself.
 *
 * sql.js keeps the database resident in memory and has no file-backed I/O of its own —
 * {@link persistState}/{@link persistEvents} snapshot the whole thing to disk after a write,
 * the same pattern the old JSON-file store used. That's a deliberate tradeoff for a
 * single-process prototype, not streaming durability; a real deployment would swap this
 * module for a server-backed Postgres/SQLite-with-native-driver without touching anything
 * that calls into it.
 */
let SQL: SqlJsStatic;
export let stateDb: Database;
export let eventsDb: Database;

/**
 * Kysely instances over the same two sql.js databases above. Queries built through these
 * (`db.selectFrom('issues').where('status_id', '=', x)`) are data structures checked against
 * {@link DB}/{@link EventsDB} at compile time — the migration target for the hand-written SQL
 * strings still used by {@link run}/{@link all}/{@link get} elsewhere in this file.
 */
export let db: Kysely<DB>;
export let eventsKysely: Kysely<EventsDB>;

function loadOrCreate(path: string): Database {
  if (existsSync(path)) return new SQL.Database(readFileSync(path));
  return new SQL.Database();
}

export function persistState(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STATE_DB_PATH, Buffer.from(stateDb.export()));
}

export function persistEvents(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(EVENTS_DB_PATH, Buffer.from(eventsDb.export()));
}

/**
 * Boots both databases. Must be awaited before any route/handler runs — sql.js's WASM
 * module load is the only async step; every query after that is synchronous.
 *
 * @returns whether `state.db` didn't already exist (the caller uses this to decide whether to seed).
 */
export async function initDatabases(): Promise<{ isFreshState: boolean }> {
  SQL = await initSqlJs();
  const isFreshState = !existsSync(STATE_DB_PATH);
  stateDb = loadOrCreate(STATE_DB_PATH);
  eventsDb = loadOrCreate(EVENTS_DB_PATH);
  db = new Kysely<DB>({ dialect: new SqlJsDialect({ database: stateDb }) });
  eventsKysely = new Kysely<EventsDB>({ dialect: new SqlJsDialect({ database: eventsDb }) });
  return { isFreshState };
}

/** Runs a statement with no result set (INSERT/UPDATE/DELETE/DDL). */
export function run(db: Database, sql: string, params: unknown[] = []): void {
  db.run(sql, params as (string | number | Uint8Array | null)[]);
}

/** Runs a query and returns every row as a plain object. */
export function all<T = Record<string, unknown>>(db: Database, sql: string, params: unknown[] = []): T[] {
  const stmt = db.prepare(sql);
  stmt.bind(params as (string | number | Uint8Array | null)[]);
  const rows: T[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as T);
  stmt.free();
  return rows;
}

/** Runs a query and returns its first row, if any. */
export function get<T = Record<string, unknown>>(db: Database, sql: string, params: unknown[] = []): T | undefined {
  return all<T>(db, sql, params)[0];
}
