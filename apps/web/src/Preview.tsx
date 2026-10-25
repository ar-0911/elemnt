import type { PageStyle, WidgetCode } from "@elemnt/core";
import { enhance } from "@elemnt/elements";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { api, getMe, type Me, type WidgetFinding } from "./api";
import { previewLook } from "./look";

interface Props {
  html: string;
  widgets?: WidgetCode[];
  onSelectText?(text: string): void;
  /** Scan results for the page's widgets, shown next to the compile diagnostics. */
  onWidgetFindings?(findings: WidgetFinding[]): void;
  /** The page's own style; the workspace theme fills in the rest. */
  pageStyle?: PageStyle;
}

const registered = new Set<string>();
const key = (w: WidgetCode) => JSON.stringify([w.html, w.css, w.js]);

/**
 * Renders compiled, sanitized HTML from @elemnt/core and hydrates it with
 * @elemnt/elements, the same runtime readers get. Widgets are registered with
 * the server first so the sandbox origin can serve them.
 */
let previews = 0;

export const Preview = forwardRef<HTMLDivElement, Props>(function Preview({ html, widgets = [], onSelectText, onWidgetFindings, pageStyle }, ref) {
  const inner = useRef<HTMLDivElement>(null);
  const [me, setMe] = useState<Me>();
  useEffect(() => void getMe().then(setMe).catch(() => {}), []);
  const [scopeId] = useState(() => `elemnt-preview-${++previews}`);
  const styleKey = JSON.stringify(pageStyle ?? null);
  const look = useMemo(() => previewLook(me?.theme, pageStyle, `#${scopeId}`, me?.fonts ?? true), [me, styleKey, scopeId]);
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
    <div id={scopeId} className={`preview ${look.classes.join(" ")}`} ref={ref} {...(look.mode !== "auto" ? { "data-theme": look.mode } : {})}>
      <style>{look.css}</style>
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
