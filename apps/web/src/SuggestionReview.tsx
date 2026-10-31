import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SuggestionDetail } from "./api";
import { Preview } from "./Preview";
import { buildLineDiff, pairRows, renderedDiff, type Block, type Row, type Seg } from "./suggestionDiff";
import { useCompiler } from "./useCompiler";
import { local } from "./ui";

export type DiffMode = "inline" | "split" | "rendered";

interface Props {
  detail: SuggestionDetail;
  origin: string;
  canEdit: boolean;
  picked: Set<number>;
  busy: boolean;
  onToggle(index: number): void;
  onDecide(accept: boolean): void;
  onClose(): void;
}

const MODES: [DiffMode, string, string][] = [
  ["inline", "Changes", "Removed and added lines, one above the other"],
  ["split", "Side by side", "Current page on the left, suggestion on the right"],
  ["rendered", "Rendered", "The page as readers will see it, with changed blocks marked"],
];
const MODE_KEY = "diff-mode";

/**
 * Shows exactly what a suggestion changes: the edited lines with the changed
 * words highlighted, side by side, or rendered. Unchanged stretches fold away.
 */
export function SuggestionReview({ detail, origin, canEdit, picked, busy, onToggle, onDecide, onClose }: Props) {
  const [mode, setMode] = useState<DiffMode>(() => (local.get(MODE_KEY) as DiffMode | null) ?? "inline");
  const diff = useMemo(() => buildLineDiff(detail.base, detail.proposed, detail.hunks), [detail]);
  const body = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(-1);
  const [renderedChanges, setRenderedChanges] = useState(0);
  const total = mode === "rendered" ? renderedChanges : detail.hunks.length;
  const many = detail.hunks.length > 1;

  const pick = (m: DiffMode) => {
    setMode(m);
    local.set(MODE_KEY, m);
    setAt(-1);
  };

  const go = useCallback(
    (step: 1 | -1) => {
      const marks = [...(body.current?.querySelectorAll<HTMLElement>("[data-change]") ?? [])];
      if (!marks.length) return;
      const next = (at + step + marks.length) % marks.length;
      marks.forEach((m, i) => m.classList.toggle("current", i === next));
      marks[next]!.scrollIntoView({ block: "center", behavior: "smooth" });
      setAt(next);
    },
    [at],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest("input:not([type=checkbox]), textarea, select, [contenteditable], .cm-editor")) return;
      if (e.key === "j") go(1);
      else if (e.key === "k") go(-1);
      else if (e.key === "Escape") onClose();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [go, onClose]);

  return (
    <section className="sreview" aria-label="Suggested changes">
      <header className="sreview-head">
        <div className="sreview-title">
          <h2>{detail.suggestion.summary}</h2>
          <p className="when">
            {origin} · {detail.suggestion.authorName ?? detail.suggestion.authorEmail ?? "Unknown"} · {new Date(detail.suggestion.createdAt).toLocaleString()}
          </p>
        </div>
        <p className="sreview-stats" aria-label={`${diff.added} lines added, ${diff.removed} removed, in ${detail.hunks.length} places`}>
          <span className="plus">+{diff.added}</span>
          <span className="minus">−{diff.removed}</span>
          <span className="muted">
            {detail.hunks.length} change{detail.hunks.length === 1 ? "" : "s"}
          </span>
        </p>
        <button type="button" className="icon-btn" onClick={onClose} title="Back to the editor (Esc)" aria-label="Close review">
          ×
        </button>
      </header>
      <div className="sreview-bar">
        <div className="seg small" role="group" aria-label="Show changes as">
          {MODES.map(([m, label, hint]) => (
            <button key={m} type="button" aria-pressed={mode === m} title={hint} onClick={() => pick(m)}>
              {label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <span className="muted small">{total > 0 && (at >= 0 ? `${at + 1} of ${total}` : `${total} to review`)}</span>
        <button type="button" className="btn ghost small" onClick={() => go(-1)} disabled={total === 0} title="Previous change (k)">
          ↑ Prev
        </button>
        <button type="button" className="btn ghost small" onClick={() => go(1)} disabled={total === 0} title="Next change (j)">
          ↓ Next
        </button>
        {canEdit && (
          <>
            <button type="button" className="btn" disabled={busy} onClick={() => onDecide(false)}>
              Reject
            </button>
            <button type="button" className="btn primary" disabled={busy || picked.size === 0} onClick={() => onDecide(true)}>
              {picked.size === detail.hunks.length ? "Accept" : `Accept ${picked.size} of ${detail.hunks.length}`}
            </button>
          </>
        )}
      </div>
      {detail.stale && <p className="banner">The page changed since this was written. Accepting merges the picked changes into the current version.</p>}
      <div className="sreview-body" ref={body}>
        {mode === "rendered" ? (
          <RenderedDiff base={detail.base} proposed={detail.proposed} onCount={setRenderedChanges} />
        ) : (
          <LineDiffView blocks={diff.blocks} split={mode === "split"} hunks={detail.hunks.length} selectable={canEdit && many} picked={picked} onToggle={onToggle} />
        )}
      </div>
    </section>
  );
}

function Text({ row }: { row: Row }) {
  if (!row.segs) return <>{row.text || " "}</>;
  return (
    <>
      {row.segs.map((s: Seg, i) => (s.changed ? <mark key={i}>{s.text}</mark> : <Fragment key={i}>{s.text}</Fragment>))}
    </>
  );
}

const SIGN = { ctx: " ", del: "−", add: "+" } as const;

function LineDiffView({ blocks, split, hunks, selectable, picked, onToggle }: { blocks: Block[]; split: boolean; hunks: number; selectable: boolean; picked: Set<number>; onToggle(i: number): void }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  return (
    <div className={`ldiff${split ? " split" : ""}`} role="table">
      {blocks.map((b, bi) => {
        if (b.kind === "gap") {
          if (!open.has(bi))
            return (
              <button key={bi} type="button" className="ldiff-fold" onClick={() => setOpen((o) => new Set(o).add(bi))}>
                ⋯ Show {b.rows.length} unchanged line{b.rows.length === 1 ? "" : "s"}
              </button>
            );
          return <Rows key={bi} rows={b.rows} split={split} />;
        }
        const first = b.rows.find((r) => r.kind !== "ctx");
        const line = first?.old ?? first?.new ?? 1;
        const on = picked.has(b.index);
        return (
          <div key={bi} className={`ldiff-hunk${selectable && !on ? " skipped" : ""}`}>
            <div className="ldiff-head" data-change={b.index}>
              {selectable ? (
                <label>
                  <input type="checkbox" checked={on} onChange={() => onToggle(b.index)} /> Change {b.index + 1} of {hunks}
                </label>
              ) : (
                <span>
                  Change {b.index + 1} of {hunks}
                </span>
              )}
              <span className="muted">line {line}</span>
              {selectable && !on && <span className="muted">· won't be applied</span>}
            </div>
            <Rows rows={b.rows} split={split} />
          </div>
        );
      })}
    </div>
  );
}

function Rows({ rows, split }: { rows: Row[]; split: boolean }) {
  if (!split)
    return (
      <>
        {rows.map((r, i) => (
          <div key={i} className={`ldiff-row ${r.kind}`} role="row">
            <span className="no">{r.old ?? ""}</span>
            <span className="no">{r.new ?? ""}</span>
            <span className="sign" aria-hidden="true">
              {SIGN[r.kind]}
            </span>
            <span className="code">
              <Text row={r} />
            </span>
          </div>
        ))}
      </>
    );
  return (
    <>
      {pairRows(rows).map(([l, r], i) => (
        <div key={i} className="ldiff-row pair" role="row">
          <span className="no">{l?.old ?? ""}</span>
          <span className={`code ${l ? l.kind : "empty"}`}>{l && <Text row={l} />}</span>
          <span className="no">{r?.new ?? ""}</span>
          <span className={`code ${r ? r.kind : "empty"}`}>{r && <Text row={r} />}</span>
        </div>
      ))}
    </>
  );
}

function RenderedDiff({ base, proposed, onCount }: { base: string; proposed: string; onCount(n: number): void }) {
  const before = useCompiler(base);
  const after = useCompiler(proposed);
  const out = useMemo(() => (before && after ? renderedDiff(before.html, after.html) : undefined), [before, after]);
  useEffect(() => onCount(out?.changes ?? 0), [out, onCount]);
  if (!out || !after) return <p className="hint pad">Rendering…</p>;
  return (
    <div className="rdiff-wrap">
      {out.changes === 0 && <p className="hint pad">The rendered page looks the same; the change is in the Markdown only. Switch to Changes to see it.</p>}
      <Preview html={out.html} widgets={after.widgets} {...(after.style ? { pageStyle: after.style } : {})} />
    </div>
  );
}
