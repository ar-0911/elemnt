import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type SuggestionDetail, type SuggestionSummary } from "./api";

const ORIGIN: Record<SuggestionSummary["origin"], string> = { assist: "Claude (editor)", mcp: "Claude (agent)", drift: "Repo check", ask: "Reader questions" };

interface Props {
  pageId: string;
  canEdit: boolean;
  /** Opened directly, e.g. from an agent's review link. */
  focus?: string | undefined;
  /** Bumped when a new suggestion arrives. */
  refreshKey: number;
  /** Saves pending edits first, so accepting never throws away typing. */
  beforeApply(): Promise<void>;
  onApplied(): void;
}

/** Review AI and agent suggestions hunk by hunk. Nothing changes until a person accepts. */
export function SuggestionsPanel({ pageId, canEdit, focus, refreshKey, beforeApply, onApplied }: Props) {
  const [items, setItems] = useState<SuggestionSummary[]>([]);
  const [open, setOpen] = useState<string | undefined>(focus);
  const [detail, setDetail] = useState<SuggestionDetail>();
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void api.get<SuggestionSummary[]>(`/api/pages/${pageId}/suggestions`).then((list) => {
      setItems(list);
      setOpen((o) => o ?? list[0]?.id);
    });
  }, [pageId]);
  useEffect(refresh, [refresh, refreshKey]);
  useEffect(() => {
    if (focus) setOpen(focus);
  }, [focus, refreshKey]);

  useEffect(() => {
    setDetail(undefined);
    setError(undefined);
    if (!open) return;
    void api
      .get<SuggestionDetail>(`/api/suggestions/${open}`)
      .then((d) => {
        setDetail(d);
        setPicked(new Set(d.hunks.map((h) => h.index)));
      })
      .catch((e: ApiError) => setError(e.message));
  }, [open, refreshKey]);

  async function decide(accept: boolean) {
    if (!detail) return;
    setBusy(true);
    setError(undefined);
    try {
      if (accept) {
        await beforeApply();
        const all = picked.size === detail.hunks.length;
        await api.post(`/api/suggestions/${detail.suggestion.id}/accept`, all ? {} : { hunks: [...picked] });
        onApplied();
      } else {
        await api.post(`/api/suggestions/${detail.suggestion.id}/reject`);
      }
      setOpen(undefined);
      refresh();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (i: number) =>
    setPicked((p) => {
      const next = new Set(p);
      if (!next.delete(i)) next.add(i);
      return next;
    });

  return (
    <section className="panel" aria-label="Suggestions">
      <h2>Suggestions</h2>
      {items.length === 0 && !detail && <p className="hint">No open suggestions. Press ⌘I to ask Claude, or let an agent suggest edits over MCP.</p>}
      <ul className="suggestions">
        {items.map((s) => (
          <li key={s.id}>
            <button type="button" className={s.id === open ? "selected" : ""} onClick={() => setOpen(s.id)}>
              <span className="msg">{s.summary}</span>
              <span className="when">
                {ORIGIN[s.origin]} · {s.authorName ?? s.authorEmail ?? "Unknown"} · {new Date(s.createdAt).toLocaleString()}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
      {detail && detail.suggestion.status === "open" && (
        <div className="review">
          {detail.stale && <p className="hint">The page changed since this was written. Accepting merges the picked changes into the current version.</p>}
          {detail.hunks.map((h) => (
            <label key={h.index} className="hunk">
              {canEdit && detail.hunks.length > 1 && <input type="checkbox" checked={picked.has(h.index)} onChange={() => toggle(h.index)} />}
              <pre className="diff">
                <div className="hunk">
                  @@ line {h.oldStart} @@
                </div>
                {h.lines.map((l, i) => (
                  <div key={i} className={l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : ""}>
                    {l}
                  </div>
                ))}
              </pre>
            </label>
          ))}
          {canEdit && (
            <p className="row">
              <button type="button" className="btn primary" disabled={busy || picked.size === 0} onClick={() => void decide(true)}>
                {picked.size === detail.hunks.length ? "Accept" : `Accept ${picked.size} of ${detail.hunks.length}`}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => void decide(false)}>
                Reject
              </button>
            </p>
          )}
          <p className="hint">Accepting saves a draft. Publish when you're happy with it.</p>
        </div>
      )}
    </section>
  );
}
