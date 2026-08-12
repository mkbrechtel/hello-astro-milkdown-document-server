import { useEffect, useRef } from "react";
import { Editor as MilkdownEditor, rootCtx } from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { nord } from "@milkdown/theme-nord";
import { collab, collabServiceCtx } from "@milkdown/plugin-collab";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

import "@milkdown/theme-nord/style.css";

export default function Editor() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rootRef.current) return;

    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: "ws://localhost:1234",
      name: "milkdown-prototype",
      document: doc,
    });

    let editor: MilkdownEditor;

    MilkdownEditor.make()
      .config((ctx) => {
        ctx.set(rootCtx, rootRef.current);
      })
      .use(nord)
      .use(commonmark)
      .use(collab)
      .create()
      .then((e) => {
        editor = e;
        editor.action((ctx) => {
          const collabService = ctx.get(collabServiceCtx);
          collabService.bindDoc(doc).setAwareness(provider.awareness);

          provider.on("synced", () => {
            collabService.connect();
            const fragment = doc.getXmlFragment("prosemirror");
            if (fragment.length === 0) {
              collabService.applyTemplate("# Welcome\n\nStart typing to collaborate.");
            }
          });
        });
      });

    return () => {
      editor?.destroy();
      provider.destroy();
      doc.destroy();
    };
  }, []);

  return <div ref={rootRef} className="milkdown-editor" />;
}
