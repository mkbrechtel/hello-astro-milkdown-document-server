# hello-astro-milkdown-document-server

Collaborative Markdown editing prototype: **Astro** app with a **Milkdown** editor, real-time sync
over plain **y-websocket**, and a self-built document backend (per-transaction persistence,
Markdown transformation, versions, REST API) on **Drizzle + SQLite**.
(Started as a Hocuspocus prototype; Hocuspocus was replaced by this self-built backend — see `docs/`.)

## Run

```sh
npm install
npm run dev            # http://localhost:4321  (WS endpoint on the same port: /ws/<doc>)
npm run simulate       # two headless Yjs clients (alice, bob) editing "hello" over the wire
npm run build && npm start   # production: node server.mjs
```

Container:

```sh
podman build -t collab -f Containerfile .
podman run -d -p 4321:4321 -v collab-data:/app/data collab
```

Env: `PORT`, `HOST`, `DATABASE_PATH` (default `./data/app.sqlite`).

## Flow

1. `/login` — pick a username → cookie. Every edit, version and revert is attributed to it.
2. `/` — list / create documents.
3. `/docs/<name>` — Milkdown editor (open twice for live collaboration), version snapshots, transaction log.

## API (all require the `username` cookie)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/login` `{username}` | set cookie · `DELETE` clears |
| GET | `/api/me` | current user |
| GET | `/api/documents` | list (with transaction counts) |
| POST | `/api/documents` `{name}` / PUT `/api/documents/:name` | create |
| GET | `/api/documents/:name` | `{markdown, json, …}` · `?format=markdown` · `?format=json` |
| DELETE | `/api/documents/:name` | delete (cascades log + versions, closes sockets) |
| GET | `/api/documents/:name/updates` | transaction log (id, user, time, size) |
| GET | `/api/documents/:name/updates?at=ID` | document reconstructed as of update ID |
| GET/POST | `/api/documents/:name/versions` `{name?, upToUpdateId?}` | list / create named version |
| GET/DELETE | `/api/documents/:name/versions/:id` | version content (`?format=markdown`) / delete |
| POST | `/api/documents/:name/versions/:id/revert` | set live doc to that version (new transaction) |
| WS | `/ws/:name` | y-websocket protocol (sync + awareness) |

See `ARCHITECTURE.md` for the design and `docs/` for the background.
