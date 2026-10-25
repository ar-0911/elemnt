import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";

interface SectionRow {
  id: string;
  title: string;
  views: number;
  reach: number;
  avgSeconds: number;
  exits: number;
  questions: number;
  gaps: number;
  confusion: number;
}
interface Insights {
  sections: SectionRow[];
  questionsWithoutSection: number;
  sources: string[];
}
interface Question {
  id: string;
  question: string;
  quote: string | null;
  section: string | null;
  answer: string;
  gap: boolean;
  source: string;
  createdAt: string;
}

/**
 * The confusion heatmap and readers' questions. Sections are shaded by how
 * often readers asked about them or left there; questions the page couldn't
 * answer can be turned into one suggested edit.
 */
export function InsightsPanel({ pageId, onSuggested }: { pageId: string; onSuggested(id: string): void }) {
  const [data, setData] = useState<Insights>();
  const [source, setSource] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    void api.get<Insights>(`/api/pages/${pageId}/insights${source ? `?source=${encodeURIComponent(source)}` : ""}`).then(setData);
    void api.get<Question[]>(`/api/pages/${pageId}/questions`).then((qs) => {
      setQuestions(qs);
      setPicked(new Set(qs.filter((q) => q.gap).map((q) => q.id)));
    });
  }, [pageId, source]);
  useEffect(load, [load]);

  const suggest = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.post<{ suggestionId: string }>(`/api/pages/${pageId}/questions/suggest`, { ids: [...picked] });
      onSuggested(r.suggestionId);
      load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  const dismiss = async () => {
    await api.post(`/api/pages/${pageId}/questions/resolve`, { ids: [...picked] });
    load();
  };

  const max = Math.max(0.01, ...(data?.sections.map((s) => s.confusion) ?? [0]));
  return (
    <section className="panel insights" aria-label="Insights">
      <h2>Where readers get stuck</h2>
      {data && data.sources.length > 1 && (
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Readers from">
          <option value="">All readers</option>
          {data.sources.map((s) => (
            <option key={s} value={s}>
              From {s}
            </option>
          ))}
        </select>
      )}
      {!data ? null : data.sections.length === 0 ? (
        <p className="hint">Add ## headings to see reading data per section.</p>
      ) : (
        <ol className="heat">
          {data.sections.map((s) => (
            <li key={s.id} style={{ ["--heat" as string]: String(s.confusion / max) }} title={`Confusion score ${s.confusion}`}>
              <span className="heat-title">{s.title}</span>
              <span className="heat-bar" style={{ width: `${Math.round(s.reach * 100)}%` }} />
              <span className="hint">
                {s.views} read · {s.avgSeconds}s avg · {s.exits} left here · {s.questions} question{s.questions === 1 ? "" : "s"}
                {s.gaps ? ` (${s.gaps} unanswered)` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="hint">Bars show how far readers got; red means questions or exits. Counters only, nothing about who read.</p>
      <h2>Reader questions</h2>
      {questions.length === 0 ? (
        <p className="hint">No open questions. Readers can ask from the page when Claude is set up.</p>
      ) : (
        <>
          <ul className="questions">
            {questions.map((q) => (
              <li key={q.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={picked.has(q.id)}
                    onChange={() =>
                      setPicked((p) => {
                        const n = new Set(p);
                        if (!n.delete(q.id)) n.add(q.id);
                        return n;
                      })
                    }
                  />{" "}
                  <strong>{q.question}</strong>
                </label>
                {q.gap && <span className="tag">not covered</span>}
                {q.quote && <blockquote>{q.quote}</blockquote>}
                <p className="hint">
                  {q.section ? `#${q.section} · ` : ""}
                  {q.source} · {new Date(q.createdAt).toLocaleDateString()}
                </p>
              </li>
            ))}
          </ul>
          <p className="row">
            <button type="button" className="btn primary" disabled={busy || picked.size === 0} onClick={() => void suggest()}>
              {busy ? "Writing…" : `Answer ${picked.size} on the page`}
            </button>
            <button type="button" className="btn ghost" disabled={picked.size === 0} onClick={() => void dismiss()}>
              Dismiss
            </button>
          </p>
          {error && <p className="error">{error}</p>}
        </>
      )}
    </section>
  );
}
