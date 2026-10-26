import { autocompletion, snippet, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { linter, lintGutter, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers, placeholder } from "@codemirror/view";
import { builtinComponents, type Diagnostic } from "@elemnt/core";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

/** Turn an authoring snippet into a CodeMirror snippet template (escape `{`/`}`, place the cursor at the end). */
function toTemplate(s: string): string {
  return s.replace(/[{}]/g, (c) => `\\${c}`) + "${}";
}

const insertable = builtinComponents.filter((c) => c.name !== "tab" && c.name !== "step");

/** The workspace's saved components, and the "make one" action; set by the editor. */
export const workspaceComponents: { items: { slug: string; name: string; description: string; snippet: string }[]; make?: () => void } = { items: [] };

/** `/` at the start of a line opens the component menu. */
function slashCommands(ctx: CompletionContext) {
  const word = ctx.matchBefore(/^\/[\w-]*$/m);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  const options: Completion[] = insertable.map((c) => ({
    label: `/${c.name}`,
    detail: c.authoring.doc,
    type: "keyword",
    apply: snippet(toTemplate(c.authoring.snippet)),
  }));
  for (const c of workspaceComponents.items) {
    options.push({ label: `/${c.slug}`, detail: `${c.name}: ${c.description}`, type: "class", section: "Workspace components", apply: c.snippet });
  }
  if (workspaceComponents.make) {
    const make = workspaceComponents.make;
    options.push({
      label: "/make-component",
      detail: "Describe a widget and Claude builds it",
      type: "function",
      section: "Workspace components",
      apply: (view, _c, from, to) => {
        view.dispatch({ changes: { from, to, insert: "" } });
        make();
      },
    });
  }
  return { from: word.from, options, validFor: /^\/[\w-]*$/ };
}

/** Component names after `:::` / `::`. */
function directiveNames(ctx: CompletionContext) {
  const m = ctx.matchBefore(/^:{2,4}[\w-]*$/m);
  if (!m) return null;
  const colons = m.text.match(/^:+/)![0];
  return {
    from: m.from + colons.length,
    options: builtinComponents.map((c) => ({ label: c.name, detail: c.authoring.doc, type: "class" })),
    validFor: /^[\w-]*$/,
  };
}

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "14px", backgroundColor: "var(--surface)", color: "var(--fg)" },
  ".cm-scroller": { fontFamily: "ui-monospace, 'JetBrains Mono', Menlo, monospace", lineHeight: "1.6" },
  ".cm-gutters": { backgroundColor: "var(--surface)", color: "var(--muted)", border: "none" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--accent) 6%, transparent)" },
  ".cm-content": { caretColor: "var(--accent)" },
  ".cm-tooltip-autocomplete": { fontFamily: "system-ui" },
});

export interface SourceEditorHandle {
  view: EditorView | undefined;
  replaceAll(text: string): void;
}

interface Props {
  value: string;
  onChange(value: string): void;
  diagnostics: Diagnostic[];
  readOnly: boolean;
  onScroll?(ratio: number): void;
  keys?: { key: string; run: () => boolean }[];
}

/** Quiet Markdown colouring: structure stands out, prose stays readable. */
const sourceHighlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: "700", color: "var(--fg)" },
  { tag: [t.strong], fontWeight: "700" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.link, t.url], color: "var(--accent)" },
  { tag: [t.monospace], color: "#b45309" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator, t.quote], color: "var(--muted)" },
  { tag: [t.keyword, t.typeName, t.labelName], color: "#7c3aed" },
  { tag: [t.string], color: "#047857" },
  { tag: [t.comment], color: "var(--muted)", fontStyle: "italic" },
]);

export const SourceEditor = forwardRef<SourceEditorHandle, Props>(function SourceEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(undefined);
  const latest = useRef(props);
  latest.current = props;
  const readOnly = useRef(new Compartment());
  const lint = useRef(new Compartment());

  useImperativeHandle(ref, () => ({
    get view() {
      return view.current;
    },
    replaceAll(text: string) {
      const v = view.current;
      if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
    },
  }));

  useEffect(() => {
    const extensions: Extension[] = [
      lineNumbers(),
      history(),
      drawSelection(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      markdown(),
      syntaxHighlighting(sourceHighlight),
      EditorView.lineWrapping,
      placeholder("Start writing. Type / at the start of a line to insert a component."),
      autocompletion({ override: [slashCommands, directiveNames], activateOnTyping: true }),
      lintGutter(),
      lint.current.of([]),
      readOnly.current.of(EditorState.readOnly.of(props.readOnly)),
      keymap.of([
        ...(props.keys ?? []).map((k) => ({ key: k.key, run: () => latest.current.keys?.find((x) => x.key === k.key)?.run() ?? false, preventDefault: true })),
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) latest.current.onChange(u.state.doc.toString());
      }),
      EditorView.domEventHandlers({
        scroll(_e, v) {
          const el = v.scrollDOM;
          latest.current.onScroll?.(el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight));
        },
      }),
      theme,
    ];
    view.current = new EditorView({ parent: host.current!, state: EditorState.create({ doc: props.value, extensions }) });
    return () => view.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value changes (opening another page, restoring) replace the doc.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== props.value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: props.value } });
  }, [props.value]);

  useEffect(() => {
    view.current?.dispatch({ effects: readOnly.current.reconfigure(EditorState.readOnly.of(props.readOnly)) });
  }, [props.readOnly]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const doc = v.state.doc;
    const items: CmDiagnostic[] = props.diagnostics.map((d) => {
      const line = doc.line(Math.min(Math.max(d.line ?? 1, 1), doc.lines));
      return { from: line.from, to: line.to, severity: d.severity, message: d.component ? `${d.component}: ${d.message}` : d.message };
    });
    v.dispatch({ effects: lint.current.reconfigure(linter(() => items, { delay: 0 })) });
  }, [props.diagnostics]);

  return <div className="source" ref={host} />;
});
