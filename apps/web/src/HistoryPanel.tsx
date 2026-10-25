import { useEffect, useState } from "react";
import { api, type Revision } from "./api";

interface Props {
  pageId: string;
  headRevisionId: string | null;
  publishedRevisionId: string | null;
  canEdit: boolean;
  onRestored(): void;
}

function DiffView({ unified }: { unified: string }) {
  const lines = unified.split("\n").slice(4); // drop the file headers
  return (
    <pre className="diff">
      {lines.map((l, i) => (
        <div key={i} className={l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : l.startsWith("@@") ? "hunk" : ""}>
          {l || " "}
        </div>
      ))}
    </pre>
  );
}

export function HistoryPanel({ pageId, headRevisionId, publishedRevisionId, canEdit, onRestored }: Props) {
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [selected, setSelected] = useState<string>();
  const [diff, setDiff] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void api.get<Revision[]>(`/api/pages/${pageId}/revisions`).then(setRevisions);
  }, [pageId, headRevisionId]);

  useEffect(() => {
    if (!selected || !headRevisionId || selected === headRevisionId) return setDiff(undefined);
    void api
      .get<{ unified: string }>(`/api/pages/${pageId}/diff?from=${selected}&to=${headRevisionId}`)
      .then((d) => setDiff(d.unified))
      .catch((e: Error) => setError(e.message));
  }, [pageId, selected, headRevisionId]);

  async function restore(id: string) {
    try {
      await api.post(`/api/pages/${pageId}/restore`, { revisionId: id });
      onRestored();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="panel" aria-label="History">
      <h2>History</h2>
      {error && <p className="error">{error}</p>}
      <ol className="revisions">
        {revisions.map((r) => (
          <li key={r.id} className={r.id === selected ? "selected" : ""}>
            <button type="button" onClick={() => setSelected(r.id)}>
              <span className="when">{new Date(r.createdAt).toLocaleString()}</span>
              <span className="who">{r.authorName ?? r.authorEmail ?? "Unknown"}</span>
              {r.message && <span className="msg">{r.message}</span>}
              <span className="tags">
                {r.id === publishedRevisionId && <span className="tag live">Live</span>}
                {r.id === headRevisionId && r.id !== publishedRevisionId && <span className="tag draft">Draft</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {selected && selected !== headRevisionId && (
        <>
          <p className="hint">Changes from this version to the current one:</p>
          {diff !== undefined ? <DiffView unified={diff} /> : <p className="hint">Loading…</p>}
          {canEdit && (
            <button type="button" className="btn" onClick={() => void restore(selected)}>
              Restore this version
            </button>
          )}
        </>
      )}
    </section>
  );
}
