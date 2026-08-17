import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import node from "@astrojs/node";
import { attachWebSocketServer } from "./src/server/ws.js";

// Dev: attach the Yjs WebSocket endpoint to Vite's http server (same origin as the app).
// Prod: server.mjs creates the http server around the built handler and attaches it there.
function yjsWebSocketIntegration() {
  return {
    name: "yjs-websocket",
    hooks: {
      "astro:server:setup": ({ server }) => {
        if (server.httpServer) attachWebSocketServer(server.httpServer);
      },
    },
  };
}

export default defineConfig({
  output: "server",
  adapter: node({ mode: "middleware" }),
  integrations: [react(), yjsWebSocketIntegration()],
  vite: {
    ssr: { external: ["better-sqlite3", "ws"] },
  },
});
