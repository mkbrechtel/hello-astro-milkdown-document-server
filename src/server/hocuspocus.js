import { Server } from "@hocuspocus/server";
import { Logger } from "@hocuspocus/extension-logger";
import { SQLite } from "@hocuspocus/extension-sqlite";

let server;

export function startHocuspocus() {
  if (server) return server;

  server = Server.configure({
    port: 1234,
    extensions: [
      new Logger(),
      new SQLite({
        database: "./data/hocuspocus.sqlite",
      }),
    ],
  });

  server.listen();
  return server;
}
