/** Same slugs as @elemnt/core's heading ids, for pages stored before ids existed. */
export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-")
      .slice(0, 80) || "section"
  );
}

/**
 * Reading signals for the confusion heatmap: how long each h2/h3 section is
 * on screen, and which section the reader was in when they left. Sent once,
 * when the page is hidden, as counters only. Nothing identifies the reader.
 */
export function trackReading(article: HTMLElement, opts: { pageId: string; source?: string }): () => void {
  const headings = [...article.querySelectorAll<HTMLElement>("h2, h3")];
  if (!headings.length) return () => {};
  const seen = new Map<string, number>();
  for (const h of headings) {
    if (h.id) continue;
    const base = slug(h.textContent ?? "");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    h.id = n > 1 ? `${base}-${n}` : base;
  }

  const dwell: Record<string, number> = {};
  let current: string | null = null;
  let since = performance.now();
  let sent = false;

  // The current section is the last heading above the top third of the viewport.
  const locate = () => {
    const line = innerHeight / 3;
    let id: string | null = null;
    for (const h of headings) {
      if (h.getBoundingClientRect().top <= line) id = h.id;
      else break;
    }
    return id ?? headings[0]!.id;
  };
  const tick = () => {
    const now = performance.now();
    if (current && document.visibilityState === "visible") dwell[current] = (dwell[current] ?? 0) + (now - since);
    since = now;
    current = locate();
  };
  const flush = () => {
    tick();
    if (sent || !Object.keys(dwell).length) return;
    sent = true;
    const body = JSON.stringify({ sections: Object.fromEntries(Object.entries(dwell).map(([k, v]) => [k, Math.round(v)])), exit: current, ...(opts.source ? { source: opts.source } : {}) });
    navigator.sendBeacon?.(`/api/pages/${opts.pageId}/signals`, body);
  };

  current = locate();
  const onScroll = () => tick();
  const onHide = () => (document.visibilityState === "hidden" ? flush() : ((since = performance.now()), (sent = false)));
  addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("visibilitychange", onHide);
  addEventListener("pagehide", flush);
  return () => {
    removeEventListener("scroll", onScroll);
    document.removeEventListener("visibilitychange", onHide);
    removeEventListener("pagehide", flush);
  };
}
