import { useEffect, useRef, useState } from "react";
import { Editor as MilkdownEditor, rootCtx } from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { nord } from "@milkdown/theme-nord";
import { collab, collabServiceCtx } from "@milkdown/plugin-collab";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

import "@milkdown/theme-nord/style.css";

const COLORS = ["#30bced", "#6eeb83", "#ffbc42", "#ecd444", "#ee6352", "#9ac2c9", "#8acb88", "#1be7ff"];

export default function Editor({ docName, username }: { docName: string; username: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("connecting");
  const [peers, setPeers] = useState<string[]>([]);

  useEffect(() => {
    if (!rootRef.current) return;

    const doc = new Y.Doc();
    // Plain y-websocket provider talking to our own Astro-hosted endpoint: /ws/<docName>.
    // The username cookie is sent automatically (same origin).
    const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    const provider = new WebsocketProvider(wsUrl, docName, doc);
    provider.awareness.setLocalStateField("user", {
      name: username,
      color: COLORS[Math.abs(hash(username)) % COLORS.length],
    });
    provider.on("status", (e: { status: string }) => setStatus(e.status));
    const onAwareness = () => {
      const names = new Set<string>();
      provider.awareness.getStates().forEach((s: any) => s.user?.name && names.add(s.user.name));
      setPeers([...names]);
    };
    provider.awareness.on("change", onAwareness);

    let editor: MilkdownEditor | undefined;
    MilkdownEditor.make()
      .config((ctx) => ctx.set(rootCtx, rootRef.current))
      .use(nord)
      .use(commonmark)
      .use(collab)
      .create()
      .then((e) => {
        editor = e;
        e.action((ctx) => {
          const collabService = ctx.get(collabServiceCtx);
          collabService.bindDoc(doc).setAwareness(provider.awareness);
          provider.once("sync", () => {
            collabService.applyTemplate(`# ${docName}\n\nStart typing…`).connect();
          });
        });
      });

    return () => {
      editor?.destroy();
      provider.awareness.off("change", onAwareness);
      provider.destroy();
      doc.destroy();
    };
  }, [docName, username]);

  return (
    <div>
      <div className="muted" style={{ marginBottom: ".4rem", display: "flex", gap: "1rem" }}>
        <span>ws: <strong>{status}</strong></span>
        <span>online: {peers.join(", ") || "–"}</span>
      </div>
      <div ref={rootRef} className="milkdown-editor" style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 8, padding: "1rem 1.5rem", minHeight: 400 }} />
    </div>
  );
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
