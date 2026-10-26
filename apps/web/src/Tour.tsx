import { useEffect, useLayoutEffect, useState } from "react";
import { local } from "./ui";

/**
 * A short guided tour of the editor for first-time users: one tip at a time,
 * pointing at the real control. Steps whose control isn't on screen (a viewer
 * has no Publish button) are skipped. Esc or "Skip" ends it for good; it can
 * be replayed from the help menu.
 */

interface Step {
  target: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  { target: "sidebar", title: "Your pages", body: "Spaces and their pages live here. A dot next to a page means it has changes readers haven't seen yet." },
  { target: "new-page", title: "Start something new", body: "Create a page here. Press ⌘K (Ctrl K) any time to jump to a page or search everything." },
  { target: "source", title: "Write in Markdown", body: "Type on the left. Start a line with / to insert rich pieces: callouts, charts, diagrams, tabs, quizzes." },
  { target: "preview", title: "See what readers see", body: "The right side is the finished page, live. Switch it to Markdown to see the plain version Claude and other agents read." },
  { target: "ask", title: "Ask Claude", body: "Select text and press ⌘I to have Claude draft or rewrite. Its changes arrive as suggestions you accept piece by piece." },
  { target: "rail", title: "Everything else", body: "History, comments, suggestions, reader insights, reading levels and the GitHub link open in this side panel." },
  { target: "publish", title: "Publish when ready", body: "Your work saves as a draft as you type. Publish puts it live for readers." },
];

const KEY = "tour-done";
export const tourDone = () => local.get(KEY) === "1";
export const restartTour = () => (local.set(KEY, "0"), dispatchEvent(new Event("elemnt-tour")));

export function Tour() {
  const [active, setActive] = useState(() => !tourDone());
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect>();
  // Wait for the editor to finish loading so every step's control is on screen.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!active || ready) return;
    const t0 = Date.now();
    const id = setInterval(() => {
      if (document.querySelector('[data-tour="source"]') || Date.now() - t0 > 5000) (clearInterval(id), setReady(true));
    }, 100);
    return () => clearInterval(id);
  }, [active, ready]);

  useEffect(() => {
    const start = () => (setI(0), setActive(true));
    addEventListener("elemnt-tour", start);
    return () => removeEventListener("elemnt-tour", start);
  }, []);

  const steps = STEPS.filter((s) => document.querySelector(`[data-tour="${s.target}"]`));
  const step = steps[i];

  useLayoutEffect(() => {
    if (!active || !ready || !step) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    const measure = () => setRect(el?.getBoundingClientRect());
    measure();
    addEventListener("resize", measure);
    return () => removeEventListener("resize", measure);
  }, [active, ready, step]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") setI((n) => Math.min(n + 1, steps.length - 1));
      if (e.key === "ArrowLeft") setI((n) => Math.max(n - 1, 0));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  function finish() {
    local.set(KEY, "1");
    setActive(false);
  }

  if (!active || !ready || !step || !rect) return null;

  // Put the tip beside the target if there's room on the right, otherwise below it.
  const W = 320;
  const pad = 12;
  const right = rect.right + pad + W < innerWidth;
  const wide = rect.width > innerWidth * 0.4;
  const style = wide
    ? { top: Math.min(rect.top + 24, innerHeight - 220), left: Math.max(pad, rect.left + rect.width / 2 - W / 2) }
    : right
      ? { top: Math.max(pad, Math.min(rect.top, innerHeight - 220)), left: rect.right + pad }
      : { top: Math.min(rect.bottom + pad, innerHeight - 220), left: Math.max(pad, Math.min(rect.left, innerWidth - W - pad)) };

  return (
    <div className="tour" role="dialog" aria-modal="false" aria-labelledby="tour-title">
      <div className="tour-ring" style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }} />
      <div className="tour-tip" style={{ ...style, width: W }}>
        <p className="tour-count">
          {i + 1} of {steps.length}
        </p>
        <h3 id="tour-title">{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-actions">
          <button type="button" className="btn ghost small" onClick={finish}>
            Skip tour
          </button>
          <span className="spacer" />
          {i > 0 && (
            <button type="button" className="btn small" onClick={() => setI(i - 1)}>
              Back
            </button>
          )}
          <button type="button" className="btn primary small" autoFocus onClick={() => (i === steps.length - 1 ? finish() : setI(i + 1))}>
            {i === steps.length - 1 ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
