import type { WidgetCode } from "@elemnt/core";
import { enhance } from "@elemnt/elements";
import { forwardRef, useEffect, useRef } from "react";
import { api, getMe, type WidgetFinding } from "./api";

interface Props {
  html: string;
  widgets?: WidgetCode[];
  onSelectText?(text: string): void;
  /** Scan results for the page's widgets, shown next to the compile diagnostics. */
  onWidgetFindings?(findings: WidgetFinding[]): void;
}

const registered = new Set<string>();
const key = (w: WidgetCode) => JSON.stringify([w.html, w.css, w.js]);

/**
 * Renders compiled, sanitized HTML from @elemnt/core and hydrates it with
 * @elemnt/elements, the same runtime readers get. Widgets are registered with
 * the server first so the sandbox origin can serve them.
 */
export const Preview = forwardRef<HTMLDivElement, Props>(function Preview({ html, widgets = [], onSelectText, onWidgetFindings }, ref) {
  const inner = useRef<HTMLDivElement>(null);
  const findingsCb = useRef(onWidgetFindings);
  findingsCb.current = onWidgetFindings;

  useEffect(() => {
    let cancelled = false;
    const root = inner.current;
    if (!root) return;
    void (async () => {
      const fresh = widgets.filter((w) => !registered.has(key(w)));
      if (fresh.length) {
        // Typing in a widget creates a new hash each time; wait for a pause.
        await new Promise((r) => setTimeout(r, 500));
        if (cancelled) return;
        try {
          const res = await api.post<{ widgets: { hash: string; findings: WidgetFinding[] }[] }>("/api/widgets/preview", { widgets: fresh });
          fresh.forEach((w) => registered.add(key(w)));
          findingsCb.current?.(res.widgets.flatMap((w) => w.findings));
        } catch {
          // The preview still shows each widget's summary.
        }
      } else if (widgets.length === 0) findingsCb.current?.([]);
      if (cancelled) return;
      const me = await getMe().catch(() => undefined);
      if (cancelled) return;
      enhance(root, {
        ...(me?.sandboxUrl ? { sandboxOrigin: me.sandboxUrl } : {}),
        widgets: { autorun: true },
        loadMermaid: () => import("mermaid") as never,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [html]);

  return (
    <div className="preview" ref={ref}>
      <article
        className="elemnt-page"
        ref={inner}
        // Safe: @elemnt/core drops raw HTML and sanitizes its own output against an allowlist.
        dangerouslySetInnerHTML={{ __html: html }}
        onMouseUp={() => {
          const text = getSelection()?.toString().trim();
          if (text && onSelectText) onSelectText(text);
        }}
      />
    </div>
  );
});
