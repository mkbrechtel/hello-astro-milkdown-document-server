// Drizzle schema. This prototype uses the SQLite dialect (drizzle-orm/sqlite-core).
// Drizzle also supports Postgres (drizzle-orm/pg-core) and MySQL (drizzle-orm/mysql-core);
// swapping means changing the column builders' import + the driver in db/index.js.
import { sqliteTable, text, integer, blob, index } from "drizzle-orm/sqlite-core";

// One row per collaborative document. `markdown` is the transformed,
// human-readable persistent representation, kept in sync by the server.
export const documents = sqliteTable("documents", {
  name: text("name").primaryKey(),
  markdown: text("markdown").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedBy: text("updated_by"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
});

// Every Yjs transaction (update) is stored as its own row — an append-only log.
// The current document state is the replay of all updates for a document, in id order.
export const updates = sqliteTable(
  "updates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    documentName: text("document_name")
      .notNull()
      .references(() => documents.name, { onDelete: "cascade" }),
    update: blob("update", { mode: "buffer" }).notNull(),
    username: text("username").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("updates_document_idx").on(t.documentName, t.id)],
);

// A named version is just a pointer into the update log: "the document as of update N".
export const versions = sqliteTable(
  "versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    documentName: text("document_name")
      .notNull()
      .references(() => documents.name, { onDelete: "cascade" }),
    name: text("name").notNull(),
    upToUpdateId: integer("up_to_update_id").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("versions_document_idx").on(t.documentName)],
);
