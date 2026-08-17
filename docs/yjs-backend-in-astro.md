# Building a Yjs document backend inside Astro (without Hocuspocus)

Background and walkthrough for the design in this repo. Read `ARCHITECTURE.md` for the map,
this document for the *why* and the *how*.

## 1. Why not Hocuspocus?

We started with `@hocuspocus/server`. What we found (verified against the installed package and
its SQLite schema, 2026-08):

- OSS Hocuspocus is a Yjs WebSocket relay plus extension hooks (`onLoadDocument`/`onStoreDocument`, auth, logging).
- Its persistence extensions store **one blob per document, overwritten on every save**. No transaction log, no versions.
- Version snapshots, "get document as JSON/Markdown", document CRUD — the whole REST API — belong to **Tiptap Collaboration** (paid cloud / on-prem product), not to the npm package. The docs present both side by side.
- Milkdown's `@milkdown/plugin-collab` does not know Hocuspocus at all: its peers are `yjs`, `y-prosemirror`, `y-protocols`. It only needs a `Y.Doc` and an `Awareness`.

So Hocuspocus was scaffolding around ~150 lines of protocol code we needed to own anyway once we
wanted per-transaction storage and versions. Lesson recorded: verify OSS vs paid features of
open-core vendors against the code, not the marketing site.

Alternatives we looked at: **Y-Sweet** (OSS Rust Yjs document server with an SDK) if you want to buy a
server rather than build; **Automerge** (`automerge-repo`) if history is the primary concern — its
documents carry full history natively (`history()`, `view(heads)`, `diff()`), but Milkdown's collab plugin is Yjs-only.

## 2. The pieces

### 2.1 Client: Milkdown + y-websocket

`src/components/Editor.tsx`

```ts
const doc = new Y.Doc();
const provider = new WebsocketProvider(`${wsScheme}://${location.host}/ws`, docName, doc);
provider.awareness.setLocalStateField("user", { name: username, color });
…
collabService.bindDoc(doc).setAwareness(provider.awareness);
provider.once("sync", () => collabService.applyTemplate("# …").connect());
```

`y-websocket` connects to `<serverUrl>/<room>` and speaks the standard two-message protocol
(0 = sync, 1 = awareness). Same origin ⇒ the browser sends our `username` cookie on the upgrade.

### 2.2 Server: the WebSocket endpoint

`src/server/ws.js` — attached to the http server (`server.on("upgrade")`), path prefix `/ws/`.
It reimplements what `y-websocket/bin/utils` does, in ~100 lines with `y-protocols`:

- reject upgrade with 401/400/404 if no cookie / bad name / unknown doc;
- on connect: send SyncStep1 + current awareness;
- on message: `readSyncMessage(decoder, encoder, doc, origin)` or `applyAwarenessUpdate`;
- fan out `doc.on("update")` and `awareness.on("update")` to the other sockets;
- on close: remove awareness states, unload the doc if idle.

The important trick: **`origin` is `{ ws, username }`**. Yjs passes the origin of a transaction to
`doc.on("update", (update, origin) => …)`, which is how the persistence layer knows *who* made a change
without any extra protocol.

Dev vs prod: in dev the `astro:server:setup` integration hook hands us Vite's `httpServer`; in prod
`server.mjs` builds the http server around the node adapter's `handler` (middleware mode) and attaches
the same function. Vite's own HMR websocket is untouched because we only handle `/ws/*`.

### 2.3 Persistence: an append-only transaction log with Drizzle

`src/server/db/schema.js` — three tables:

```
documents(name PK, markdown, created_by/at, updated_by/at)
updates(id, document_name FK, update BLOB, username, created_at)   -- one row per Yjs update
versions(id, document_name FK, name, up_to_update_id, created_by, created_at)
```

`src/server/docs.js`:

```js
doc.on("update", (update, origin) => {
  if (origin === LOAD_ORIGIN) return;              // replaying from DB → don't re-store
  storeUpdate(name, update, origin.username);       // one row per transaction
  debounce(() => persistMarkdown(name, doc, origin.username));
});
```

Loading = `SELECT update FROM updates WHERE document_name=? ORDER BY id` → `Y.applyUpdate` each,
inside one transaction with origin `LOAD_ORIGIN`. Because Yjs updates are commutative/idempotent
this yields the exact same state as the live doc, and replaying only up to id *N* yields the
document as it was at *N* — that is the whole "version history" story: `?at=N`.

Why not just store `Y.encodeStateAsUpdate(doc)`? A single blob is smaller and loads faster, but it
throws away who-changed-what and any ability to go back. The log is the source of truth; if load
time matters, add a compaction step (`Y.mergeUpdates` of rows 1..K into one row) — the model stays.

Drizzle: `drizzle-orm/sqlite-core` + `better-sqlite3` here. It supports Postgres/MySQL/libsql/D1
with the same query builder; the manager code never touches SQL directly except the bootstrap DDL
(replace with `drizzle-kit generate` + `migrate()` in a real project).

### 2.4 Transformation: Yjs → ProseMirror JSON → Markdown

`src/server/markdown.js`. Milkdown's collab plugin uses `y-prosemirror`, so the document lives in
`doc.getXmlFragment("prosemirror")`. `yDocToProsemirrorJSON(doc, "prosemirror")` gives the PM
document JSON without needing a schema instance; a small serializer then walks Milkdown's
commonmark node names (`heading`, `paragraph`, `bullet_list`, `ordered_list`, `list_item`,
`blockquote`, `code_block`, `hr`, `image`, `hardbreak`; marks `strong`, `emphasis`, `inlineCode`,
`link`). Running Milkdown itself server-side would need a DOM; this avoids it. The result is written
to `documents.markdown` after every change and served by `GET /api/documents/:name?format=markdown`.

### 2.5 Versions and revert

- Create version = insert `(name, up_to_update_id = last update id)`; optionally tag a past id.
- Read version = replay up to that id → JSON/Markdown.
- Revert = build the old doc, then in the **live** doc:
  `frag.delete(0, frag.length); frag.insert(0, oldFrag.toArray().map(c => c.clone()))`
  inside `doc.transact(…, { username })`. Connected editors receive it as a normal update; the log
  gets one more row. Nothing is ever deleted from history.

### 2.6 "Login"

`POST /api/login {username}` → cookie. `requireUser()` in every API route, `Astro.cookies` in pages,
raw header parsing in the WS upgrade. Replace with real sessions later; the attribution plumbing
(origin.username) is the only contract the rest of the system relies on.

## 3. Trying it

```sh
npm run dev
npm run simulate                    # alice + bob edit "hello" over WS
curl -c j -d '{"username":"me"}' -H 'content-type: application/json' localhost:4321/api/login
curl -b j localhost:4321/api/documents/hello?format=markdown
curl -b j localhost:4321/api/documents/hello/updates
curl -b j -X POST -d '{"name":"v1"}' -H 'content-type: application/json' localhost:4321/api/documents/hello/versions
curl -b j -X POST localhost:4321/api/documents/hello/versions/1/revert
```
