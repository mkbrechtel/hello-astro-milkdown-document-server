---
status: draft
---

# Postgres persistence for the Yjs document backend

## Goal

The document backend stores every Yjs transaction, the transformed Markdown and named versions through Drizzle, currently on SQLite (`better-sqlite3`, `data/app.sqlite`).
Move it to PostgreSQL: switch the schema to `drizzle-orm/pg-core` (`bytea` for `updates.update`), the driver to `drizzle-orm/node-postgres`, and replace the bootstrap DDL with `drizzle-kit` migrations, configured via `DATABASE_URL`.
The document manager (`src/server/docs.js`) only uses Drizzle's query builder, so no other architecture changes are expected.
