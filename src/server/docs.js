// In-memory document manager backed by the append-only update log in the database.
// Shared through globalThis so the WebSocket server (plain node import) and the
// Astro API routes (Vite SSR module instances) operate on the same live Y.Docs.
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { and, asc, eq, lte, sql, desc } from "drizzle-orm";
import { db, schema } from "./db/index.js";
import { docToJSON, docToMarkdown, FRAGMENT_NAME } from "./markdown.js";

const { documents, updates, versions } = schema;

const LOAD_ORIGIN = "db-load";
const MARKDOWN_DEBOUNCE_MS = 500;

/** @typedef {{ doc: Y.Doc, awareness: Awareness, conns: Set<any>, mdTimer: any }} LiveDoc */

function createManager() {
  /** @type {Map<string, LiveDoc>} */
  const live = new Map();
  return { live };
}
globalThis.__docManager ??= createManager();
const { live } = globalThis.__docManager;

// ---------- persistence primitives ----------

function replayUpdates(name, upToUpdateId) {
  const rows = db
    .select({ id: updates.id, update: updates.update })
    .from(updates)
    .where(
      upToUpdateId == null
        ? eq(updates.documentName, name)
        : and(eq(updates.documentName, name), lte(updates.id, upToUpdateId)),
    )
    .orderBy(asc(updates.id))
    .all();
  const doc = new Y.Doc();
  doc.transact(() => {
    for (const r of rows) Y.applyUpdate(doc, new Uint8Array(r.update), LOAD_ORIGIN);
  }, LOAD_ORIGIN);
  return { doc, count: rows.length, lastId: rows.at(-1)?.id ?? null };
}

function storeUpdate(name, update, username) {
  return db
    .insert(updates)
    .values({ documentName: name, update: Buffer.from(update), username, createdAt: new Date() })
    .returning({ id: updates.id })
    .get();
}

function persistMarkdown(name, ydoc, username) {
  db.update(documents)
    .set({ markdown: docToMarkdown(ydoc), updatedBy: username, updatedAt: new Date() })
    .where(eq(documents.name, name))
    .run();
}

// ---------- documents ----------

export function listDocuments() {
  return db
    .select({
      name: documents.name,
      createdBy: documents.createdBy,
      createdAt: documents.createdAt,
      updatedBy: documents.updatedBy,
      updatedAt: documents.updatedAt,
      updateCount: sql`(select count(*) from updates u where u.document_name = ${documents.name})`.mapWith(Number),
    })
    .from(documents)
    .orderBy(desc(documents.updatedAt))
    .all();
}

export function getDocumentRow(name) {
  return db.select().from(documents).where(eq(documents.name, name)).get() ?? null;
}

export function documentExists(name) {
  return !!getDocumentRow(name);
}

export function createDocument(name, username) {
  if (documentExists(name)) return { created: false, row: getDocumentRow(name) };
  const row = db
    .insert(documents)
    .values({ name, createdBy: username, createdAt: new Date() })
    .returning()
    .get();
  return { created: true, row };
}

export function deleteDocument(name) {
  const entry = live.get(name);
  if (entry) {
    for (const conn of entry.conns) conn.close?.(4404, "document deleted");
    entry.doc.destroy();
    live.delete(name);
  }
  return db.delete(documents).where(eq(documents.name, name)).run().changes > 0;
}

/** Full transformed representation of the current state (live if loaded, else replayed). */
export function getDocumentContent(name) {
  const row = getDocumentRow(name);
  if (!row) return null;
  const ydoc = live.get(name)?.doc ?? replayUpdates(name).doc;
  return { ...row, json: docToJSON(ydoc), markdown: docToMarkdown(ydoc) };
}

// ---------- live docs (used by the WebSocket server) ----------

/** Get (or load into memory) the live doc for a name. Returns null if the document doesn't exist. */
export function getLiveDoc(name) {
  const existing = live.get(name);
  if (existing) return existing;
  if (!documentExists(name)) return null;

  const { doc } = replayUpdates(name);
  const awareness = new Awareness(doc);
  awareness.setLocalState(null);
  /** @type {LiveDoc} */
  const entry = { doc, awareness, conns: new Set(), mdTimer: null };

  doc.on("update", (update, origin) => {
    if (origin === LOAD_ORIGIN) return;
    const username = originUsername(origin);
    storeUpdate(name, update, username);
    clearTimeout(entry.mdTimer);
    entry.mdTimer = setTimeout(() => persistMarkdown(name, doc, username), MARKDOWN_DEBOUNCE_MS);
  });

  live.set(name, entry);
  return entry;
}

function originUsername(origin) {
  if (origin && typeof origin === "object" && typeof origin.username === "string") return origin.username;
  return "system";
}

/** Unload from memory when no clients remain (state is fully in the DB). */
export function releaseIfIdle(name) {
  const entry = live.get(name);
  if (!entry || entry.conns.size > 0) return;
  clearTimeout(entry.mdTimer);
  persistMarkdown(name, entry.doc, "system");
  entry.awareness.destroy();
  entry.doc.destroy();
  live.delete(name);
}

// ---------- update log ----------

export function listUpdates(name) {
  return db
    .select({
      id: updates.id,
      username: updates.username,
      createdAt: updates.createdAt,
      size: sql`length(${updates.update})`.mapWith(Number),
    })
    .from(updates)
    .where(eq(updates.documentName, name))
    .orderBy(asc(updates.id))
    .all();
}

/** Reconstruct the document at any point of the log. */
export function getStateAtUpdate(name, upToUpdateId) {
  const { doc, count, lastId } = replayUpdates(name, upToUpdateId);
  return { upToUpdateId: lastId, appliedUpdates: count, json: docToJSON(doc), markdown: docToMarkdown(doc) };
}

// ---------- versions ----------

export function listVersions(name) {
  return db.select().from(versions).where(eq(versions.documentName, name)).orderBy(desc(versions.id)).all();
}

export function getVersion(name, id) {
  return db.select().from(versions).where(and(eq(versions.documentName, name), eq(versions.id, id))).get() ?? null;
}

/** Create a named version. Defaults to the current end of the log; pass upToUpdateId to tag a past point. */
export function createVersion(name, versionName, username, upToUpdateId) {
  const last = db
    .select({ id: updates.id })
    .from(updates)
    .where(eq(updates.documentName, name))
    .orderBy(desc(updates.id))
    .limit(1)
    .get();
  const pointer = Number.isInteger(upToUpdateId) ? Math.min(upToUpdateId, last?.id ?? 0) : (last?.id ?? 0);
  return db
    .insert(versions)
    .values({ documentName: name, name: versionName, upToUpdateId: pointer, createdBy: username, createdAt: new Date() })
    .returning()
    .get();
}

export function getVersionContent(name, id) {
  const v = getVersion(name, id);
  if (!v) return null;
  return { ...v, ...getStateAtUpdate(name, v.upToUpdateId) };
}

export function deleteVersion(name, id) {
  return db.delete(versions).where(and(eq(versions.documentName, name), eq(versions.id, id))).run().changes > 0;
}

/**
 * Revert the live document to a version. This is itself a new transaction in the log
 * (CRDT history is never rewritten): we replace the fragment's content with a clone of the
 * old state inside one Y transaction attributed to `username`.
 */
export function revertToVersion(name, id, username) {
  const v = getVersion(name, id);
  if (!v) return null;
  const entry = getLiveDoc(name);
  if (!entry) return null;
  const old = replayUpdates(name, v.upToUpdateId).doc;
  const oldFrag = old.getXmlFragment(FRAGMENT_NAME);
  const liveFrag = entry.doc.getXmlFragment(FRAGMENT_NAME);
  entry.doc.transact(() => {
    liveFrag.delete(0, liveFrag.length);
    liveFrag.insert(0, oldFrag.toArray().map((c) => c.clone()));
  }, { username, revertTo: id });
  old.destroy();
  clearTimeout(entry.mdTimer);
  persistMarkdown(name, entry.doc, username);
  return getDocumentContent(name);
}
