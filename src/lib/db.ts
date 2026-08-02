import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { MIGRATIONS } from './schema'

export type Db = Database.Database

const DEFAULT_DB_PATH = '.data/variant-lab.db'

/**
 * Apply any migrations the database has not seen yet.
 * Safe to call on every open — already-applied migrations are skipped.
 */
export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)

  const applied = new Set<number>(
    db
      .prepare('SELECT id FROM schema_migrations')
      .all()
      .map((row) => (row as { id: number }).id),
  )

  const record = db.prepare(
    'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)',
  )

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue
    db.transaction(() => {
      db.exec(migration.sql)
      record.run(migration.id, migration.name, new Date().toISOString())
    })()
  }
}

/**
 * Open a database and bring it up to date.
 *
 * Pass `':memory:'` for an isolated throwaway instance — that is what the
 * test suite uses, so tests never touch the developer's real data.
 */
export function openDatabase(path: string = DEFAULT_DB_PATH): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }

  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

/**
 * Process-wide handle used by the API routes.
 *
 * Next.js reloads modules in development, so the connection is parked on
 * `globalThis` to avoid leaking a new SQLite handle on every hot reload.
 */
const globalForDb = globalThis as unknown as { __variantLabDb?: Db }

export function getDatabase(): Db {
  if (!globalForDb.__variantLabDb) {
    globalForDb.__variantLabDb = openDatabase(
      process.env.VARIANT_LAB_DB ?? DEFAULT_DB_PATH,
    )
  }
  return globalForDb.__variantLabDb
}
