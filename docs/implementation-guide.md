# Implementation Guide: a custom Yjs document API on Astro

How to build a collaborative-document backend — real-time sync, per-transaction persistence,
server-side transformation, versions and a REST API — inside an Astro project on plain Yjs
primitives, without a vendor collaboration server. Distilled from the prototype in this repo.

We started on Hocuspocus, which appeared to provide exactly this — but the open-source
`@hocuspocus/server` is only a sync relay that persists one overwritten blob per document; the
document REST API, versions and snapshots it seems to advertise belong to Tiptap's paid Collaboration
product, so we dropped it and built the ~200 lines it was wrapping ourselves.

## 0. The model

Everything below follows from one idea: the log of Yjs updates is the document. Sync, persistence, history and the readable Markdown are all derived views of that log, so we keep the log complete and attributed and compute the rest.

| Decision | Choice | Why |
|---|---|---|
| Source of truth | Append-only log of Yjs updates, one row per transaction | Attribution per change, point-in-time reconstruction, versions for free |
| Readable form | Server-derived Markdown/JSON column, recomputed on change | Other systems read documents without a Yjs runtime; never client-written |
| Transport | y-websocket protocol on *your* http server | Standard client, ~100 lines server-side, works with any y-* editor binding |
| Runtime | One Node process owning the http server (Astro SSR + WS) | WebSockets need the raw `http.Server` |
| Identity | Anything that resolves to a username at connection time | The only contract: "who is the origin of this update" |
| Database | Drizzle; SQLite for dev, same code on Postgres | Dialect-agnostic query builder; only the blob type differs |

## 1. Skeleton

One Astro project holds both the app and the backend. Server code lives in `src/server/` and is imported by three consumers: the WebSocket server, the API routes and the SSR pages. Keep it framework-free (plain functions over Drizzle and Yjs) so it works from all three.

```
astro.config.mjs        output "server", @astrojs/node (middleware), dev hook attaches WS
server.mjs              prod: http.createServer(static + ssr handler) + WS
src/server/db/          Drizzle schema + driver (globalThis singleton)
src/server/docs.js      document manager: live docs, replay, store, versions, revert
src/server/ws.js        y-websocket protocol server
src/server/markdown.js  Y → ProseMirror JSON → Markdown
src/server/auth.js      cookie/user resolution
src/pages/api/**        REST endpoints
src/components/Editor.tsx  editor + WebsocketProvider
```

Deps: `astro @astrojs/node`, `yjs y-protocols y-websocket y-prosemirror lib0 ws`, `drizzle-orm better-sqlite3`, `sirv`.
Pin `better-sqlite3` to a major with prebuilds for your Node (`^11` on Node 20).

## 2. Own the http server

WebSockets need the raw Node server for the `upgrade` event, which Astro routes never see. In dev Vite already runs one and lends it to integrations; in prod we create it ourselves and mount Astro's handler on it, so the same `attachWebSocketServer` runs in both.

Astro never hands routes an `http.Server`; take it from the two places it exists.

```js
// astro.config.mjs — dev
hooks: { "astro:server:setup": ({ server }) => attachWebSocketServer(server.httpServer) }
// + output: "server", adapter: node({ mode: "middleware" }), vite.ssr.external: ["better-sqlite3", "ws"]
```
```js
// server.mjs — prod
const server = http.createServer((req, res) => serveStatic(req, res, () => ssrHandler(req, res)));
attachWebSocketServer(server);
```

- Handle upgrades only under your prefix (`/ws/`) — Vite HMR shares the server.
- Server modules are plain ESM `.js`: `server.mjs` imports them with Node, API routes through Vite — **two module instances**, so DB and doc manager live on `globalThis`.

## 3. Schema

Three tables: the document itself with its derived Markdown, the append-only update log, and versions as pointers into that log. Nothing stores a full Yjs state — the log is the only source of truth, and every row says who wrote it.

```
documents(name PK, markdown, created_by/at, updated_by/at)      -- markdown is derived
updates(id AUTOINC, document_name FK cascade, update BLOB, username, created_at)  -- the log
versions(id, document_name FK cascade, name, up_to_update_id, created_by, created_at)
```
Index `updates(document_name, id)`. SQLite: WAL + `foreign_keys=ON`. Postgres: `pgTable`, `bytea`, `drizzle-orm/node-postgres`; the manager code is unchanged.

## 4. Document manager

The manager is the only code that touches Y.Docs and the database. It loads a document by replaying its log, keeps it live in memory while clients are connected, and persists every update the moment it happens. Yjs's transaction *origin* is how the writer's identity travels from a socket or an API call into the stored row.

```js
const LOAD_ORIGIN = "db-load";
function replayUpdates(name, upToId) {          // load = replay the log (optionally up to an id)
  const doc = new Y.Doc();
  doc.transact(() => rows.forEach(r => Y.applyUpdate(doc, new Uint8Array(r.update), LOAD_ORIGIN)), LOAD_ORIGIN);
  return doc;
}
export function getLiveDoc(name) {
  … const doc = replayUpdates(name); const awareness = new Awareness(doc);
  doc.on("update", (update, origin) => {
    if (origin === LOAD_ORIGIN) return;           // never re-store what was just loaded
    storeUpdate(name, update, origin?.username ?? "system");   // one row per transaction
    debounce(() => persistMarkdown(name, doc, origin.username));
  });
}
```
- **Origin carries identity**: every mutating path passes `{ username, … }` as the Y origin; `doc.on("update")` is the single persistence choke point.
- Store synchronously and in order; debounce only the derived Markdown.
- Unload idle docs after flushing; reads use the live doc if loaded, else replay.

## 5. WebSocket server

This is the standard y-websocket wire protocol reimplemented with `y-protocols`, so unmodified `WebsocketProvider` clients connect. Authentication happens at the HTTP upgrade, before any Yjs message is read; after that a socket is just an origin that updates flow in and out of.

Framing: `varUint type` + payload; `0` = sync (`y-protocols/sync`), `1` = awareness.

- **Upgrade**: only `/ws/<name>`; resolve user from the `Cookie` header → else write `HTTP/1.1 401` and destroy; validate name (400); `getLiveDoc` (404); then `wss.handleUpgrade`.
- **Per socket**: `origin = { ws, username }`; forward `doc.on("update")` (skip own origin) and `awareness.on("update")`; on message call `readSyncMessage(decoder, encoder, doc, origin)` / `applyAwarenessUpdate(…, origin)`; on close remove awareness states and release the doc if idle; send SyncStep1 + awareness immediately after connect.

## 6. Client

The editor never knows about the server beyond a URL. Any y-* binding that takes a `Y.Doc` and an `Awareness` works unchanged; Milkdown's collab plugin is shown here.

```ts
const doc = new Y.Doc();
const provider = new WebsocketProvider(`${scheme}://${location.host}/ws`, docName, doc); // → /ws/<docName>
provider.awareness.setLocalStateField("user", { name: username, color });
collabService.bindDoc(doc).setAwareness(provider.awareness);                        // Milkdown; any y-* binding works
provider.once("sync", () => collabService.applyTemplate("# Title").connect());       // template only after first sync
```
Same origin ⇒ the cookie rides on the upgrade.

## 7. Transformation

The server keeps a readable copy of every document so that other systems (search, export, static pages) can consume it without a Yjs runtime. It is derived from the log after each change and never edited directly.

`yDocToProsemirrorJSON(ydoc, "prosemirror")` (y-prosemirror, no schema needed) → walk *your* preset's node/mark names to Markdown, with an "unknown node → render children" fallback. Don't run the editor server-side (needs a DOM). Serve as `GET /api/documents/:name?format=markdown|json`; it is derived — never accept writes to it.

## 8. REST API

A small, conventional resource API over the manager. It exposes documents, their readable form, the update log, and versions; the WebSocket handles live editing, the API handles everything else.

All routes: `requireUser` (401), validate names (400), wrap handlers so thrown `Response`s return. Accept JSON and form bodies (+ optional `redirect`) so plain HTML forms can drive the same endpoints.

| Method | Path | |
|---|---|---|
| POST | `/api/login` | set identity cookie |
| GET / POST | `/api/documents` | list · create |
| GET / PUT / DELETE | `/api/documents/:name` | content (`?format=`) · create · delete (closes sockets, cascades) |
| GET | `/api/documents/:name/updates[?at=ID]` | log · state reconstructed at ID |
| GET / POST | `/api/documents/:name/versions` | list · create pointer (`{name, upToUpdateId?}`) |
| GET / DELETE | `/api/documents/:name/versions/:id` | reconstruct · delete |
| POST | `/api/documents/:name/versions/:id/revert` | see §9 |

## 9. Versions and revert

Because the log is complete, a version costs one row: a name and a position in the log. Reverting doesn't rewind anything — it applies the old content as a new, attributed transaction, so connected editors and the history both stay consistent.

Version = pointer row `up_to_update_id`; read = replay up to it. Revert never rewrites history:

```js
entry.doc.transact(() => {
  liveFrag.delete(0, liveFrag.length);
  liveFrag.insert(0, oldFrag.toArray().map(c => c.clone()));
}, { username, revertTo: id });      // editors receive a normal update; the log gains one row
```

## 10. Identity

The prototype needs only a username, so login is a cookie. What matters architecturally is that identity is resolved once per connection or request and then travels as `origin.username`; swapping the mechanism later touches only the readers, not the manager.

Prototype: `POST /api/login {username}` → cookie, read in three places (`Astro.cookies` in pages, `requireUser` in API, raw header in the upgrade handler). Swap for sessions/JWT later; the manager and protocol only ever see `origin.username`.
