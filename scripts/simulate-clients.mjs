// Simulates two editors (alice, bob) editing "hello" over the y-websocket protocol.
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import WebSocket from "ws";

function connect(user) {
  const doc = new Y.Doc();
  const WS = class extends WebSocket { constructor(url) { super(url, { headers: { cookie: `username=${user}` } }); } };
  const p = new WebsocketProvider("ws://localhost:4321/ws", "hello", doc, { WebSocketPolyfill: WS });
  return new Promise((res) => p.once("sync", () => res({ doc, p })));
}

function para(text, marks) {
  const el = new Y.XmlElement("paragraph");
  const t = new Y.XmlText(); t.insert(0, text, marks); el.insert(0, [t]); return el;
}
function heading(level, text) {
  const el = new Y.XmlElement("heading"); el.setAttribute("level", String(level));
  const t = new Y.XmlText(); t.insert(0, text); el.insert(0, [t]); return el;
}

const a = await connect("alice");
const fragA = a.doc.getXmlFragment("prosemirror");
a.doc.transact(() => fragA.insert(0, [heading(1, "Hello world"), para("Written by alice.")]));
await new Promise(r => setTimeout(r, 300));

const b = await connect("bob");
const fragB = b.doc.getXmlFragment("prosemirror");
b.doc.transact(() => fragB.insert(fragB.length, [para("Bob adds a "), para("second paragraph with bold", { strong: {} })]));
await new Promise(r => setTimeout(r, 300));

// alice sees bob's change?
console.log("alice sees", fragA.length, "blocks; bob sees", fragB.length, "blocks");
a.p.destroy(); b.p.destroy();
process.exit(0);
