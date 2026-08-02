// Route handlers reach for the process-wide database. Point that at an
// in-memory instance so tests never touch a developer's real .data directory.
// Vitest isolates module state per test file, so each file gets a fresh one.
process.env.VARIANT_LAB_DB = ':memory:'
