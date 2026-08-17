// Production entry: http server serving the built Astro app + the Yjs WebSocket endpoint.
import http from "node:http";
import { handler as ssrHandler } from "./dist/server/entry.mjs";
import { attachWebSocketServer } from "./src/server/ws.js";
import sirv from "sirv";

const port = Number(process.env.PORT ?? 4321);
const host = process.env.HOST ?? "0.0.0.0";
const serveStatic = sirv("./dist/client", { dev: false, etag: true });

const server = http.createServer((req, res) => {
  serveStatic(req, res, () => ssrHandler(req, res, () => {
    res.statusCode = 404;
    res.end("Not found");
  }));
});
attachWebSocketServer(server);
server.listen(port, host, () => console.log(`listening on http://${host}:${port}`));
