import { claim } from "./theme.js";

const fmt: Record<string, (v: number) => string> = {
  number: (v) => v.toLocaleString(),
  percent: (v) => `${(v * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`,
  ms: (v) => `${v.toLocaleString(undefined, { maximumFractionDigits: 0 })} ms`,
  bytes: (v) => {
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (v >= 1024 && i < u.length - 1) (v /= 1024), i++;
    return `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${u[i]}`;
  },
};

/** Live values: fetched from the server, which reads admin-configured sources and caches them. */
export function enhanceQuery(root: ParentNode, endpoint: string): void {
  for (const el of root.querySelectorAll<HTMLElement>("elemnt-query")) {
    if (!claim(el)) continue;
    const { source, key, format = "text" } = el.dataset;
    if (!source || !key) continue;
    const page = location.pathname;
    void fetch(`${endpoint}/api/query?${new URLSearchParams({ source, key, page })}`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d: { value: unknown; fetchedAt: string }) => {
        const v = d.value;
        el.textContent = typeof v === "number" && fmt[format] ? fmt[format](v) : String(v);
        el.title = `Live from ${source}, ${new Date(d.fetchedAt).toLocaleTimeString()}`;
        el.dataset.live = "1";
      })
      .catch(() => {
        el.title = `Couldn't load ${key} from ${source}; showing the last written value.`;
      });
  }
}
