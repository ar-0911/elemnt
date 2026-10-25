import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { Preview } from "./Preview";

type Level = "newcomer" | "engineer" | "exec";
const LEVELS: { level: Level; label: string; hint: string }[] = [
  { level: "newcomer", label: "New here", hint: "Terms defined, why before how" },
  { level: "engineer", label: "Engineer", hint: "Commands, limits, edge cases first" },
  { level: "exec", label: "Exec", hint: "Bottom line, cost and risk, under 250 words" },
];
interface LevelSummary {
  level: Level;
  status: "pending" | "approved";
  stale: boolean;
}
interface LevelDetail extends LevelSummary {
  html: string;
  source: string;
}

/** Reading levels: Claude rewrites the published page per audience; an editor checks and approves each one. */
export function LevelsPanel({ pageId, published }: { pageId: string; published: boolean }) {
  const [list, setList] = useState<LevelSummary[]>([]);
  const [open, setOpen] = useState<LevelDetail>();
  const [busy, setBusy] = useState<Level>();
  const [error, setError] = useState<string>();

  const load = useCallback(() => void api.get<LevelSummary[]>(`/api/pages/${pageId}/levels`).then(setList), [pageId]);
  useEffect(load, [load]);

  const act = async (level: Level, fn: () => Promise<unknown>) => {
    setBusy(level);
    setError(undefined);
    try {
      await fn();
      load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(undefined);
    }
  };
  const view = (level: Level) => act(level, async () => setOpen(await api.get<LevelDetail>(`/api/pages/${pageId}/levels/${level}`)));

  return (
    <section className="panel levels-panel" aria-label="Reading levels">
      <h2>Reading levels</h2>
      <p className="hint">Readers can switch the page to a version written for them. Claude writes each from the published page; you approve it.</p>
      {!published && <p className="hint">Publish the page first.</p>}
      <ul className="level-list">
        {LEVELS.map((l) => {
          const s = list.find((x) => x.level === l.level);
          return (
            <li key={l.level}>
              <strong>{l.label}</strong> <span className="hint">{l.hint}</span>
              <div className="row">
                {s && <span className={`tag ${s.status}`}>{s.status === "approved" ? "Live" : "Waiting for review"}{s.stale ? ", page changed since" : ""}</span>}
                <button type="button" className="btn" disabled={!published || busy !== undefined} onClick={() => void act(l.level, () => api.post(`/api/pages/${pageId}/levels/${l.level}/generate`).then(() => view(l.level)))}>
                  {busy === l.level ? "Writing…" : s ? "Rewrite" : "Write with Claude"}
                </button>
                {s && (
                  <button type="button" className="btn ghost" onClick={() => void view(l.level)}>
                    View
                  </button>
                )}
                {s?.status === "pending" && (
                  <button type="button" className="btn primary" onClick={() => void act(l.level, () => api.post(`/api/pages/${pageId}/levels/${l.level}/approve`))}>
                    Approve
                  </button>
                )}
                {s && (
                  <button type="button" className="btn ghost" onClick={() => void act(l.level, () => api.del(`/api/pages/${pageId}/levels/${l.level}`)).then(() => setOpen(undefined))}>
                    Remove
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {error && <p className="error">{error}</p>}
      {open && (
        <div className="level-preview">
          <h3>{LEVELS.find((l) => l.level === open.level)?.label}</h3>
          <Preview html={open.html} />
        </div>
      )}
    </section>
  );
}
