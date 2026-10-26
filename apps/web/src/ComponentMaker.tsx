import { useState } from "react";
import { api, ApiError, type WidgetFinding } from "./api";
import { Preview } from "./Preview";

interface Draft {
  name: string;
  slug: string;
  description: string;
  summary: string;
  html: string;
  css: string;
  js: string;
  height: number;
  findings: WidgetFinding[];
  snippet: string;
}

/** Make me a component: describe a widget, see Claude's version running, then save it to the library and insert it. */
export function ComponentMaker({ onClose, onInsert }: { onClose(): void; onInsert(snippet: string): void }) {
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<Draft>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [html, setHtml] = useState("");

  const make = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const d = await api.post<Draft>("/api/components/generate", { description });
      setDraft(d);
      // Render the snippet through the normal compiler so the preview is what readers get.
      const { createElemnt } = await import("@elemnt/core");
      setHtml(createElemnt().compile(d.snippet).html);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async (insert: boolean) => {
    if (!draft) return;
    try {
      const { findings: _f, snippet: _s, ...body } = draft;
      const saved = await api.post<{ snippet: string }>("/api/components", body);
      if (insert) onInsert(saved.snippet);
      onClose();
    } catch (err) {
      setError((err as ApiError).message);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="palette maker" role="dialog" aria-label="Make a component" onClick={(e) => e.stopPropagation()}>
        <h2>Make a component</h2>
        <p className="hint">Describe an interactive widget. Claude writes it to run in the sandbox (no network), with a text summary for agents.</p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void make();
          }}
        >
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. a calculator for our API's monthly cost from requests per day" aria-label="Describe the component" autoFocus />
          <button type="submit" className="btn primary" disabled={busy || description.trim().length < 5}>
            {busy ? "Building…" : draft ? "Try again" : "Build"}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
        {draft && (
          <>
            <p>
              <strong>{draft.name}</strong> · <code>/{draft.slug}</code>
              <br />
              <span className="hint">Agents read: {draft.summary}</span>
            </p>
            {draft.findings.length > 0 && (
              <ul className="widget-findings">
                {draft.findings.map((f, i) => (
                  <li key={i} data-severity={f.severity}>
                    {f.message}
                  </li>
                ))}
              </ul>
            )}
            <Preview html={html} widgets={[{ html: draft.html, css: draft.css, js: draft.js }]} />
            <details>
              <summary>Code</summary>
              <pre className="agent-md">{draft.snippet}</pre>
            </details>
            <p className="row">
              <button type="button" className="btn primary" disabled={draft.findings.some((f) => f.severity === "error")} onClick={() => void save(true)}>
                Save to library and insert
              </button>
              <button type="button" className="btn" disabled={draft.findings.some((f) => f.severity === "error")} onClick={() => void save(false)}>
                Save to library
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
