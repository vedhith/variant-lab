/**
 * Schema for the Variant Lab store.
 *
 * Kept as plain SQL rather than behind an ORM: the data model is four tables
 * and the queries are the interesting part. Migrations are applied in order
 * and recorded in `schema_migrations`, so a database is upgraded by appending
 * to this array — never by editing an entry that has already shipped.
 */

export interface Migration {
  id: number
  name: string
  sql: string
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE experiments (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        baseline_html TEXT NOT NULL,
        source_url    TEXT,
        status        TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'running', 'stopped')),
        created_at    TEXT NOT NULL
      );

      CREATE TABLE variants (
        id            TEXT PRIMARY KEY,
        experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
        key           TEXT NOT NULL,
        html          TEXT NOT NULL,
        weight        REAL NOT NULL DEFAULT 1 CHECK (weight >= 0),
        is_control    INTEGER NOT NULL DEFAULT 0 CHECK (is_control IN (0, 1)),
        created_at    TEXT NOT NULL,
        UNIQUE (experiment_id, key)
      );

      CREATE INDEX idx_variants_experiment ON variants(experiment_id);

      -- One row per (experiment, visitor). The primary key is what makes
      -- assignment sticky even if weights change later.
      CREATE TABLE assignments (
        experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
        visitor_id    TEXT NOT NULL,
        variant_id    TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
        assigned_at   TEXT NOT NULL,
        PRIMARY KEY (experiment_id, visitor_id)
      );

      CREATE INDEX idx_assignments_variant ON assignments(variant_id);

      CREATE TABLE events (
        id            TEXT PRIMARY KEY,
        experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
        visitor_id    TEXT NOT NULL,
        variant_id    TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        value         REAL,
        created_at    TEXT NOT NULL
      );

      CREATE INDEX idx_events_experiment_name ON events(experiment_id, name);
      CREATE INDEX idx_events_variant ON events(variant_id);
    `,
  },
]
