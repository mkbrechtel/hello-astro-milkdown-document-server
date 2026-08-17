// WebSocket endpoint speaking the y-websocket protocol (sync + awareness), attached to
// an existing http.Server. URL scheme: ws://host/ws/<documentName>. The username cookie
// (set by /api/login) is required and is used to attribute every stored update.
import { WebSocketServer } from "ws";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import { usernameFromCookieHeader, isValidDocumentName } from "./auth.js";
import { getLiveDoc, releaseIfIdle } from "./docs.js";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
export const WS_PATH_PREFIX = "/ws/";

export function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith(WS_PATH_PREFIX)) return; // leave Vite HMR etc. alone
    const name = decodeURIComponent(url.pathname.slice(WS_PATH_PREFIX.length));
    const username = usernameFromCookieHeader(req.headers.cookie);

    if (!username) return reject(socket, "401 Unauthorized");
    if (!isValidDocumentName(name)) return reject(socket, "400 Bad Request");
    const entry = getLiveDoc(name);
    if (!entry) return reject(socket, "404 Not Found");

    wss.handleUpgrade(req, socket, head, (ws) => setupConnection(ws, entry, name, username));
  });

  return wss;
}

function reject(socket, status) {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function setupConnection(ws, entry, name, username) {
  const { doc, awareness, conns } = entry;
  ws.binaryType = "arraybuffer";
  // Origin object for updates coming from this connection → attributed to the user.
  const origin = { ws, username };
  conns.add(ws);
  const controlledIds = new Set();

  const send = (buf) => {
    if (ws.readyState === ws.OPEN) ws.send(buf, (err) => err && ws.close());
  };

  const onDocUpdate = (update, updateOrigin) => {
    if (updateOrigin === origin) return; // don't echo back to sender
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeUpdate(enc, update);
    send(encoding.toUint8Array(enc));
  };
  const onAwareness = ({ added, updated, removed }, awOrigin) => {
    const changed = added.concat(updated, removed);
    if (awOrigin === origin) for (const id of added) controlledIds.add(id);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
    send(encoding.toUint8Array(enc));
  };
  doc.on("update", onDocUpdate);
  awareness.on("update", onAwareness);

  ws.on("message", (data) => {
    try {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const enc = encoding.createEncoder();
      switch (decoding.readVarUint(decoder)) {
        case MSG_SYNC:
          encoding.writeVarUint(enc, MSG_SYNC);
          syncProtocol.readSyncMessage(decoder, enc, doc, origin);
          if (encoding.length(enc) > 1) send(encoding.toUint8Array(enc));
          break;
        case MSG_AWARENESS:
          awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), origin);
          break;
      }
    } catch (err) {
      console.error("[ws] bad message", err);
      ws.close(1003, "bad message");
    }
  });

  ws.on("close", () => {
    doc.off("update", onDocUpdate);
    awareness.off("update", onAwareness);
    conns.delete(ws);
    awarenessProtocol.removeAwarenessStates(awareness, [...controlledIds], origin);
    releaseIfIdle(name);
  });

  // Initial handshake: sync step 1 + current awareness.
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MSG_SYNC);
  syncProtocol.writeSyncStep1(enc, doc);
  send(encoding.toUint8Array(enc));
  const states = awareness.getStates();
  if (states.size > 0) {
    const aenc = encoding.createEncoder();
    encoding.writeVarUint(aenc, MSG_AWARENESS);
    encoding.writeVarUint8Array(aenc, awarenessProtocol.encodeAwarenessUpdate(awareness, [...states.keys()]));
    send(encoding.toUint8Array(aenc));
  }
  console.log(`[ws] ${username} joined "${name}" (${conns.size} connected)`);
}
