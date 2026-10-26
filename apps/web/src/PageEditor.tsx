import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type OpenedPage, type SaveResult, type SuggestionDetail, type WidgetFinding } from "./api";
import { CommentsPanel } from "./CommentsPanel";
import { HistoryPanel } from "./HistoryPanel";
import { AssistBar } from "./AssistBar";
import { Preview } from "./Preview";
import { SuggestionsPanel } from "./SuggestionsPanel";
import { RepoPanel } from "./RepoPanel";
import { InsightsPanel } from "./InsightsPanel";
import { LevelsPanel } from "./LevelsPanel";
import { ComponentMaker } from "./ComponentMaker";
import { workspaceComponents } from "./SourceEditor";
import { SourceEditor, type SourceEditorHandle } from "./SourceEditor";
import { useCompiler } from "./useCompiler";
import { presets } from "@elemnt/core";
import { withPreset } from "./look";

type Mode = "split" | "source" | "preview";
type Panel = "none" | "history" | "comments" | "suggestions" | "repo" | "insights" | "levels";
type Status = { kind: "idle" | "saving" | "saved" | "error" | "conflict" | "published"; text: string };

const AUTOSAVE_MS = 1500;
const LOCK_RENEW_MS = 30_000;

interface Props {
  pageId: string;
  canEdit: boolean;
  onChanged(): void;
}

export function PageEditor({ pageId, canEdit, onChanged }: Props) {
  const [opened, setOpened] = useState<OpenedPage>();
  const [source, setSource] = useState("");
  const [lockedOut, setLockedOut] = useState<string>();
  const [mode, setMode] = useState<Mode>("split");
  // An agent's review link (?suggestion=sug_…) opens straight onto it.
  const [focusSuggestion, setFocusSuggestion] = useState(() => new URLSearchParams(location.search).get("suggestion") ?? undefined);
  const [panel, setPanel] = useState<Panel>(focusSuggestion ? "suggestions" : "none");
  const [assist, setAssist] = useState<{ open: boolean; busy: boolean; error?: string; selection?: { from: number; to: number } }>({ open: false, busy: false });
  const [suggestionsKey, setSuggestionsKey] = useState(0);
  const [quote, setQuote] = useState<string>();
  const [status, setStatus] = useState<Status>({ kind: "idle", text: "" });
  const [view, setView] = useState<"page" | "markdown">("page");

  const editor = useRef<SourceEditorHandle>(null);
  const preview = useRef<HTMLDivElement>(null);
  const head = useRef<string | null>(null);
  const saved = useRef("");
  const saving = useRef<Promise<void> | undefined>(undefined);

  const compiled = useCompiler(source);
  const [widgetFindings, setWidgetFindings] = useState<WidgetFinding[]>([]);
  const [making, setMaking] = useState(false);

  // The / menu offers the workspace's saved components and "make one".
  useEffect(() => {
    if (!canEdit) return;
    workspaceComponents.make = () => setMaking(true);
    void api.get<typeof workspaceComponents.items>("/api/components").then((items) => (workspaceComponents.items = items)).catch(() => {});
    return () => {
      workspaceComponents.make = undefined;
    };
  }, [canEdit]);
  const readOnly = !canEdit || Boolean(lockedOut);

  const load = useCallback(async () => {
    const data = await api.get<OpenedPage>(`/api/pages/${pageId}`);
    head.current = data.headRevisionId;
    saved.current = data.source;
    setOpened(data);
    setSource(data.source);
    setStatus({ kind: "idle", text: data.page.draftRevisionId ? "Unpublished draft" : "Published" });
  }, [pageId]);

  useEffect(() => {
    void load();
  }, [load]);

  // One editor at a time: take the lock, renew it, release it when leaving.
  useEffect(() => {
    if (!canEdit) return;
    let stopped = false;
    const take = () =>
      api
        .post(`/api/pages/${pageId}/lock`)
        .then(() => !stopped && setLockedOut(undefined))
        .catch((e: ApiError) => !stopped && e.status === 423 && setLockedOut(e.message));
    void take();
    const timer = setInterval(take, LOCK_RENEW_MS);
    const release = () => void api.del(`/api/pages/${pageId}/lock`, { keepalive: true }).catch(() => {});
    addEventListener("pagehide", release);
    return () => {
      stopped = true;
      clearInterval(timer);
      removeEventListener("pagehide", release);
      release();
    };
  }, [pageId, canEdit]);

  const save = useCallback(
    async (publish: boolean) => {
      if (readOnly || !head.current) return;
      const text = editor.current?.view?.state.doc.toString() ?? source;
      if (!publish && text === saved.current) return;
      setStatus({ kind: "saving", text: publish ? "Publishing…" : "Saving…" });
      try {
        // Publishing an already-saved draft promotes it instead of writing a duplicate revision.
        const res =
          publish && text === saved.current && opened?.page.draftRevisionId === head.current
            ? await api.post<SaveResult & { ok: boolean }>(`/api/pages/${pageId}/publish`)
            : await api.put<SaveResult & { ok: boolean }>(`/api/pages/${pageId}`, { source: text, baseRevisionId: head.current, publish });
        head.current = res.revisionId;
        saved.current = text;
        setOpened((o) =>
          o && {
            ...o,
            headRevisionId: res.revisionId,
            page: publish ? { ...o.page, publishedRevisionId: res.revisionId, draftRevisionId: null } : { ...o.page, draftRevisionId: res.revisionId },
          },
        );
        setStatus(publish ? { kind: "published", text: "Published" } : { kind: "saved", text: res.ok ? "Draft saved" : "Draft saved (has errors)" });
        if (publish) onChanged();
      } catch (e) {
        const err = e as ApiError;
        if (err.status === 409) setStatus({ kind: "conflict", text: "Someone else saved this page. Reload to see their changes." });
        else if (err.status === 422) setStatus({ kind: "error", text: "Fix the errors before publishing." });
        else setStatus({ kind: "error", text: err.message });
      }
    },
    [pageId, readOnly, source, onChanged, opened],
  );

  const saveSerial = useCallback(
    (publish: boolean) => {
      const run = (saving.current ?? Promise.resolve()).then(() => save(publish));
      saving.current = run;
      return run;
    },
    [save],
  );

  // Autosave drafts shortly after typing stops.
  useEffect(() => {
    if (readOnly || source === saved.current || status.kind === "conflict") return;
    const t = setTimeout(() => void saveSerial(false), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [source, readOnly, saveSerial, status.kind]);

  const openAssist = useCallback(() => {
    if (readOnly) return;
    const sel = editor.current?.view?.state.selection.main;
    setAssist({ open: true, busy: false, ...(sel && !sel.empty ? { selection: { from: sel.from, to: sel.to } } : {}) });
  }, [readOnly]);

  async function runAssist(instruction: string) {
    setAssist((a) => ({ ...a, busy: true, error: undefined }));
    try {
      // Suggestions are made against a saved revision, so offsets and hunks line up.
      await saveSerial(false);
      const res = await api.post<SuggestionDetail & { id: string }>(`/api/pages/${pageId}/assist`, { instruction, baseRevisionId: head.current, ...(assist.selection ? { selection: assist.selection } : {}) });
      setAssist({ open: false, busy: false });
      setFocusSuggestion(res.id);
      setSuggestionsKey((k) => k + 1);
      setPanel("suggestions");
    } catch (e) {
      setAssist((a) => ({ ...a, busy: false, error: (e as ApiError).message }));
    }
  }

  const keys = [
    { key: "Mod-i", run: () => (openAssist(), true) },
    { key: "Mod-s", run: () => (void saveSerial(false), true) },
    { key: "Mod-Enter", run: () => (void saveSerial(true), true) },
    { key: "Mod-\\", run: () => (setMode((m) => (m === "split" ? "source" : m === "source" ? "preview" : "split")), true) },
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "i" && !(e.target instanceof HTMLElement && e.target.closest(".cm-editor"))) {
        e.preventDefault();
        openAssist();
      }
      if (mod && e.key === "\\") {
        e.preventDefault();
        setMode((m) => (m === "split" ? "source" : m === "source" ? "preview" : "split"));
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [openAssist]);

  if (!opened) return <main className="editor-main empty">Loading…</main>;

  const errors = compiled?.diagnostics.filter((d) => d.severity === "error") ?? [];
  const dirty = source !== saved.current;

  return (
    <main className="editor-main">
      <header className="toolbar">
        <div className="title">
          <h1>{opened.page.title}</h1>
          <a href={opened.url} target="_blank" rel="noreferrer" className="sub">
            {new URL(opened.url).pathname}
          </a>
        </div>
        <div className="actions">
          <span className={`status ${status.kind}`} role="status">
            {dirty && status.kind !== "saving" ? "Unsaved changes" : status.text}
          </span>
          {errors.length > 0 && <span className="status error">{errors.length} error{errors.length > 1 ? "s" : ""}</span>}
          {canEdit && (
            <select
              className="style-pick"
              aria-label="Page style"
              title="Page style (the style: line in the frontmatter)"
              disabled={readOnly}
              value={compiled?.style?.preset ?? ""}
              onChange={(e) => editor.current?.replaceAll(withPreset(source, e.target.value || undefined))}
            >
              <option value="">Style: workspace default</option>
              {Object.values(presets).map((p) => (
                <option key={p.name} value={p.name}>
                  Style: {p.label}
                </option>
              ))}
            </select>
          )}
          <div className="seg" role="group" aria-label="Layout">
            {(["source", "split", "preview"] as Mode[]).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
                {m[0]!.toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
          <button type="button" className={`btn ghost${panel === "history" ? " on" : ""}`} onClick={() => setPanel(panel === "history" ? "none" : "history")}>
            History
          </button>
          {canEdit && (
            <button type="button" className="btn ghost" disabled={readOnly} onClick={openAssist} title="⌘I">
              Ask Claude
            </button>
          )}
          <button type="button" className={`btn ghost${panel === "suggestions" ? " on" : ""}`} onClick={() => setPanel(panel === "suggestions" ? "none" : "suggestions")}>
            Suggestions
          </button>
          <button type="button" className={`btn ghost${panel === "comments" ? " on" : ""}`} onClick={() => setPanel(panel === "comments" ? "none" : "comments")}>
            Comments
          </button>
          <button type="button" className={`btn ghost${panel === "insights" ? " on" : ""}`} onClick={() => setPanel(panel === "insights" ? "none" : "insights")}>
            Insights
          </button>
          <button type="button" className={`btn ghost${panel === "levels" ? " on" : ""}`} onClick={() => setPanel(panel === "levels" ? "none" : "levels")}>
            Levels
          </button>
          <button type="button" className={`btn ghost${panel === "repo" ? " on" : ""}`} onClick={() => setPanel(panel === "repo" ? "none" : "repo")}>
            Repo
          </button>
          {canEdit && (
            <button type="button" className="btn primary" disabled={readOnly || errors.length > 0} onClick={() => void saveSerial(true)} title="⌘Enter">
              Publish
            </button>
          )}
        </div>
      </header>
      {assist.open && (
        <AssistBar
          hasSelection={Boolean(assist.selection)}
          busy={assist.busy}
          error={assist.error}
          onSubmit={(i) => void runAssist(i)}
          onClose={() => {
            setAssist({ open: false, busy: false });
            editor.current?.view?.focus();
          }}
        />
      )}
      {lockedOut && <p className="banner">{lockedOut} You can read along; editing opens up when they close the page.</p>}
      {status.kind === "conflict" && (
        <p className="banner">
          {status.text} <button type="button" className="link" onClick={() => void load()}>Reload</button>
        </p>
      )}
      <div className={`workspace mode-${mode}${panel !== "none" ? " with-panel" : ""}`}>
        <SourceEditor
          ref={editor}
          value={opened.source}
          onChange={setSource}
          diagnostics={compiled?.diagnostics ?? []}
          readOnly={readOnly}
          keys={keys}
          onScroll={(ratio) => {
            const p = preview.current;
            if (p && mode === "split") p.scrollTop = ratio * (p.scrollHeight - p.clientHeight);
          }}
        />
        <div className="right">
          <div className="seg small" role="group" aria-label="Preview as">
            <button type="button" aria-pressed={view === "page"} onClick={() => setView("page")}>
              Page
            </button>
            <button type="button" aria-pressed={view === "markdown"} onClick={() => setView("markdown")}>
              Markdown
            </button>
          </div>
          {view === "page" ? (
            <>
              {widgetFindings.length > 0 && (
                <ul className="widget-findings" role="status">
                  {widgetFindings.map((f, i) => (
                    <li key={i} data-severity={f.severity}>
                      {f.severity === "error" ? "Won't publish: " : ""}
                      {f.message}
                    </li>
                  ))}
                </ul>
              )}
              <Preview
                ref={preview}
                html={compiled?.html ?? ""}
                widgets={compiled?.widgets ?? []}
                {...(compiled?.style ? { pageStyle: compiled.style } : {})}
                onWidgetFindings={setWidgetFindings}
                onSelectText={(t) => (setQuote(t), setPanel("comments"))}
              />
            </>
          ) : (
            <div className="preview" ref={preview}>
              <pre className="agent-md">{compiled?.markdown ?? ""}</pre>
            </div>
          )}
        </div>
        {panel === "history" && (
          <HistoryPanel
            pageId={pageId}
            headRevisionId={head.current}
            publishedRevisionId={opened.page.publishedRevisionId}
            canEdit={!readOnly}
            onRestored={() => void load().then(onChanged)}
          />
        )}
        {panel === "suggestions" && (
          <SuggestionsPanel
            pageId={pageId}
            canEdit={canEdit && !readOnly}
            focus={focusSuggestion}
            refreshKey={suggestionsKey}
            beforeApply={() => saveSerial(false)}
            onApplied={() => void load().then(onChanged)}
          />
        )}
        {panel === "insights" && <InsightsPanel pageId={pageId} onSuggested={(id) => (setSuggestionsKey((k) => k + 1), setPanel("suggestions"), void id)} />}
        {panel === "levels" && <LevelsPanel pageId={pageId} published={Boolean(opened.page.publishedRevisionId)} />}
        {panel === "repo" && <RepoPanel pageId={pageId} canEdit={canEdit} onSuggested={() => setSuggestionsKey((k) => k + 1)} />}
        {panel === "comments" && <CommentsPanel pageId={pageId} quote={quote} clearQuote={() => setQuote(undefined)} />}
      </div>
      {making && (
        <ComponentMaker
          onClose={() => setMaking(false)}
          onInsert={(snippet) => {
            const v = editor.current?.view;
            if (v) {
              const at = v.state.selection.main.head;
              v.dispatch({ changes: { from: at, insert: `\n${snippet}\n` } });
              v.focus();
            }
            void api.get<typeof workspaceComponents.items>("/api/components").then((items) => (workspaceComponents.items = items));
          }}
        />
      )}
    </main>
  );
}
