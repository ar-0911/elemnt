import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";

/** The language for a site file, by extension. Liquid templates are HTML with tags. */
function language(path: string): Extension {
  if (/\.(html|liquid)$/.test(path)) return html();
  if (/\.css$/.test(path)) return css();
  if (/\.(m?js|ts)$/.test(path)) return javascript();
  if (/\.json$/.test(path)) return json();
  if (/\.md$/.test(path)) return markdown();
  return [];
}

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px", backgroundColor: "var(--surface)", color: "var(--fg)" },
  ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: "1.6" },
  ".cm-gutters": { backgroundColor: "var(--surface)", color: "var(--muted)", border: "none" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--soft) 60%, transparent)" },
  ".cm-content": { caretColor: "var(--accent)" },
});

/** A plain code editor for site files. Remounts when `path` changes. */
export function CodeEditor({ path, value, readOnly, onChange, onSave }: { path: string; value: string; readOnly?: boolean; onChange(v: string): void; onSave(): void }) {
  const host = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onChange, onSave });
  handlers.current = { onChange, onSave };

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          language(path),
          theme,
          EditorView.lineWrapping,
          EditorState.readOnly.of(Boolean(readOnly)),
          keymap.of([{ key: "Mod-s", preventDefault: true, run: () => (handlers.current.onSave(), true) }, indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) handlers.current.onChange(u.state.doc.toString());
          }),
        ],
      }),
    });
    return () => view.destroy();
    // The editor owns the text after mount; a new file gets a new editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, readOnly]);

  return <div className="code-editor" ref={host} />;
}
