import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema.js";

const DB_PATH = process.env.DATABASE_PATH ?? "./data/app.sqlite";

function open() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  // Prototype: create tables directly. For real projects use `drizzle-kit generate`
  // + `migrate()` (works for sqlite/pg/mysql alike).
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      name TEXT PRIMARY KEY,
      markdown TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_by TEXT,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_name TEXT NOT NULL REFERENCES documents(name) ON DELETE CASCADE,
      "update" BLOB NOT NULL,
      username TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS updates_document_idx ON updates(document_name, id);
    CREATE TABLE IF NOT EXISTS versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_name TEXT NOT NULL REFERENCES documents(name) ON DELETE CASCADE,
      name TEXT NOT NULL,
      up_to_update_id INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS versions_document_idx ON versions(document_name);
  `);
  return drizzle(sqlite, { schema });
}

// Shared across Vite-SSR module instances and the plain-node WebSocket server.
globalThis.__appDb ??= open();
/** @type {ReturnType<typeof open>} */
export const db = globalThis.__appDb;
export { schema };
