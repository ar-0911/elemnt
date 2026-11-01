import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, ApiError, type SuggestionDetail, type SuggestionSummary } from "./api";
import { SuggestionReview } from "./SuggestionReview";
import { buildLineDiff } from "./suggestionDiff";

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
  /** Where the full review shows, in place of the editor and preview. */
  reviewSlot: HTMLElement | null;
  /** Tells the editor whether a review is taking over the workspace. */
  onReviewing(reviewing: boolean): void;
}

/** Review AI and agent suggestions hunk by hunk. Nothing changes until a person accepts. */
export function SuggestionsPanel({ pageId, canEdit, focus, refreshKey, beforeApply, onApplied, reviewSlot, onReviewing }: Props) {
  const [items, setItems] = useState<SuggestionSummary[]>([]);
  const [open, setOpen] = useState<string | undefined>(focus);
  const [detail, setDetail] = useState<SuggestionDetail>();
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<false | "deciding" | "redoing">(false);
  const [reload, setReload] = useState(0);
  const reviewing = Boolean(detail && detail.suggestion.status === "open");
  useEffect(() => onReviewing(reviewing), [reviewing, onReviewing]);
  useEffect(() => () => onReviewing(false), [onReviewing]);

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
    setError(undefined);
    // Keep showing the previous suggestion until the next one loads, so the editor doesn't flash.
    if (!open) return setDetail(undefined);
    void api
      .get<SuggestionDetail>(`/api/suggestions/${open}`)
      .then((d) => {
        setDetail(d);
        // Changes that collide with newer edits can't be applied, so they start unticked.
        setPicked(new Set(d.hunks.map((h) => h.index).filter((i) => !d.conflicts.includes(i))));
      })
      .catch((e: ApiError) => (setDetail(undefined), setError(e.message)));
  }, [open, refreshKey, reload]);

  async function decide(accept: boolean) {
    if (!detail) return;
    setBusy("deciding");
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
      const err = e as ApiError;
      // The page moved on under some of the picked changes: reload so the review marks them.
      if (err.status === 409 && Array.isArray(err.details.conflicts)) setReload((r) => r + 1);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /** Claude makes the same change to the latest version, as a new suggestion that replaces this one. */
  async function redo() {
    if (!detail) return;
    setBusy("redoing");
    setError(undefined);
    try {
      await beforeApply();
      const fresh = await api.post<{ id: string }>(`/api/suggestions/${detail.suggestion.id}/redo`);
      setOpen(fresh.id);
      refresh();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const close = useCallback(() => {
    setOpen(undefined);
    setDetail(undefined);
  }, []);

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
      {error && !reviewing && <p className="error">{error}</p>}
      {detail && reviewing && (
        <div className="review">
          <ReviewSummary detail={detail} />
          <p className="hint">
            The changes are open next to this list. Use <kbd>j</kbd> and <kbd>k</kbd> to step through them{canEdit && detail.hunks.length > 1 ? ", and untick any you don't want" : ""}. Accepting saves a draft; publish when you're happy with it.
          </p>
        </div>
      )}
      {detail &&
        reviewing &&
        reviewSlot &&
        createPortal(
          <SuggestionReview
            detail={detail}
            origin={ORIGIN[detail.suggestion.origin]}
            canEdit={canEdit}
            picked={picked}
            busy={busy}
            error={error}
            onToggle={toggle}
            onDecide={(accept) => void decide(accept)}
            onRedo={() => void redo()}
            onClose={close}
          />,
          reviewSlot,
        )}
    </section>
  );
}

function ReviewSummary({ detail }: { detail: SuggestionDetail }) {
  const { added, removed } = buildLineDiff(detail.base, detail.proposed, detail.hunks);
  return (
    <p className="sreview-stats">
      <span className="plus">+{added}</span>
      <span className="minus">−{removed}</span>
      <span className="muted">
        in {detail.hunks.length} place{detail.hunks.length === 1 ? "" : "s"}
      </span>
    </p>
  );
}
