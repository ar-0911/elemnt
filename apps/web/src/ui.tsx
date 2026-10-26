import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/** Small shared pieces: icons, dialogs, menus and toasts. */

const PATHS = {
  plus: "M12 5v14M5 12h14",
  search: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4.2-4.2",
  page: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  history: "M12 21a9 9 0 1 0-9-9M3 4v5h5M12 7v5l3 2",
  comment: "M4 5h16v11H10l-5 4v-4H4z",
  sparkle: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  check: "M20 6 9 17l-5-5",
  review: "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM8 12l3 3 5-6",
  insights: "M5 20V11M12 20V4M19 20v-7",
  levels: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  repo: "M7 3v12M7 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM17 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 9c0 5-10 3-10 6",
  settings: "M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4",
  help: "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.5V14M12 17.5v.01",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  globe: "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18",
  team: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-3.9 3.1-7 7-7s7 3.1 7 7M16 3.5a4 4 0 0 1 0 7.5M18 14c2.4.8 4 3.3 4 6",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 1 1 8 0v4",
  close: "M6 6l12 12M18 6 6 18",
  keyboard: "M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
  compass: "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM15.5 8.5l-2 5-5 2 2-5z",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4.4 3.6-8 8-8s8 3.6 8 8",
  layout: "M3 4h18v16H3zM12 4v16",
  key: "M15 8a4 4 0 1 1-3.5 6L5 20.5V22h-2v-3l6.5-6.5A4 4 0 0 1 15 8zM16 7h.01",
  palette: "M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3 3h-2a2 2 0 0 0-1 3.7c.5.4.7 1 .5 1.6-.3.5-.9.7-1.5.7zM7.5 11h.01M10 7h.01M15 7.5h.01",
  shield: "M12 3l8 3v6c0 5-3.4 8.3-8 9-4.6-.7-8-4-8-9V6z",
  plug: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4",
  chat: "M21 12a8 8 0 0 1-11.7 7.1L4 20.5l1.4-5A8 8 0 1 1 21 12z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`icon${className ? ` ${className}` : ""}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** A modal dialog: Escape and the backdrop close it, focus starts inside and returns afterwards. */
export function Dialog({ title, onClose, children, wide, footer }: { title: string; onClose(): void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>("[autofocus], input, select, textarea, button:not(.dialog-close)");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && box.current) {
        const items = [...box.current.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input:not(:disabled), select, textarea, [tabindex='0']")];
        if (!items.length) return;
        const [a, z] = [items[0]!, items[items.length - 1]!];
        if (e.shiftKey && document.activeElement === a) (e.preventDefault(), z.focus());
        else if (!e.shiftKey && document.activeElement === z) (e.preventDefault(), a.focus());
      }
    };
    addEventListener("keydown", onKey, true);
    return () => {
      removeEventListener("keydown", onKey, true);
      before?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className={`dialog${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <header className="dialog-head">
          <h2 id="dialog-title">{title}</h2>
          <button type="button" className="icon-btn dialog-close" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/** A button that opens a small menu of actions. Arrow keys move, Escape closes. */
export function Menu({ trigger, label, items, align = "start", up }: { trigger: ReactNode; label: string; items: ({ label: string; icon?: IconName; onSelect(): void; hint?: string; danger?: boolean } | "sep")[]; align?: "start" | "end"; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const first = wrap.current?.querySelector<HTMLElement>("[role=menuitem]");
    first?.focus();
    const away = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    addEventListener("mousedown", away);
    return () => removeEventListener("mousedown", away);
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    const all = [...(wrap.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") (setOpen(false), wrap.current?.querySelector<HTMLElement>(".menu-trigger")?.focus());
    if (e.key === "ArrowDown") (e.preventDefault(), all[(i + 1) % all.length]?.focus());
    if (e.key === "ArrowUp") (e.preventDefault(), all[(i - 1 + all.length) % all.length]?.focus());
  };
  return (
    <div className="menu-wrap" ref={wrap} onKeyDown={onKey}>
      <button type="button" className="menu-trigger" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open && (
        <div className={`menu ${align}${up ? " up" : ""}`} role="menu" aria-label={label}>
          {items.map((it, i) =>
            it === "sep" ? (
              <hr key={i} />
            ) : (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                className={it.danger ? "danger" : undefined}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
              >
                {it.icon && <Icon name={it.icon} size={16} />}
                <span>{it.label}</span>
                {it.hint && <kbd>{it.hint}</kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

type Toast = { id: number; text: string; kind: "ok" | "error" };
const ToastContext = createContext<(text: string, kind?: Toast["kind"]) => void>(() => {});

/** Short confirmations ("Published") and errors, bottom centre, gone after a few seconds. */
export function Toasts({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast["kind"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <p key={t.id} className={`toast ${t.kind}`} onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
            {t.kind === "ok" && <Icon name="check" size={16} />}
            {t.text}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

/** Copies text and says so. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn small"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
    >
      <Icon name={done ? "check" : "copy"} size={14} />
      {done ? "Copied" : label}
    </button>
  );
}

/** Per-person flags kept in this browser: the tour, the getting-started checklist. */
export const local = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`elemnt-${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(`elemnt-${key}`, value);
    } catch {
      /* private mode: forget it */
    }
    dispatchEvent(new Event("elemnt-local"));
  },
};

export function useLocalFlag(key: string): [boolean, () => void] {
  const [on, setOn] = useState(() => local.get(key) === "1");
  useEffect(() => {
    const sync = () => setOn(local.get(key) === "1");
    addEventListener("elemnt-local", sync);
    return () => removeEventListener("elemnt-local", sync);
  }, [key]);
  return [on, () => local.set(key, "1")];
}
