import { claim, make } from "./theme.js";

const NS = "http://www.w3.org/2000/svg";
const COLORS = ["#2949c7", "#d9480f", "#2b8a3e", "#ae3ec9", "#e67700", "#0b7285"];
const num = (v: string) => Number(v.replace(/,/g, ""));

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}

/** Draws an SVG chart from the server-rendered table; the table stays for screen readers and agents. */
export function enhanceChart(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>("elemnt-chart")) {
    const table = el.querySelector("table");
    if (!table || !claim(el)) continue;
    const header = [...table.querySelectorAll("thead th")].map((th) => th.textContent ?? "");
    const rows = [...table.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent ?? ""));
    const series = header.slice(1);
    if (!rows.length || !series.length) continue;

    const W = 640, H = 300, L = 48, R = 12, T = 12, B = 32;
    const max = niceMax(Math.max(...rows.flatMap((r) => r.slice(1).map(num))));
    const x = (i: number, n: number) => L + ((W - L - R) * (i + 0.5)) / n;
    const y = (v: number) => T + (H - T - B) * (1 - v / max);
    const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": el.closest("figure")?.querySelector("figcaption")?.textContent ?? "Chart" });

    for (let k = 0; k <= 4; k++) {
      const v = (max * k) / 4;
      root.append(svg("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "axis" }), svg("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, v.toLocaleString()));
    }
    const every = Math.ceil(rows.length / 12);
    rows.forEach((r, i) => i % every === 0 && root.append(svg("text", { x: x(i, rows.length), y: H - 10, "text-anchor": "middle" }, r[0] ?? "")));

    const type = el.dataset.type ?? "bar";
    series.forEach((name, s) => {
      const color = COLORS[s % COLORS.length]!;
      if (type === "bar") {
        const band = (W - L - R) / rows.length;
        const bw = (band * 0.8) / series.length;
        rows.forEach((r, i) => {
          const v = num(r[s + 1] ?? "0");
          const rect = svg("rect", { x: L + band * i + band * 0.1 + bw * s, y: y(v), width: Math.max(1, bw - 1), height: y(0) - y(v), fill: color, rx: 2 });
          rect.append(svg("title", {}, `${r[0]} · ${name}: ${r[s + 1]}${el.dataset.unit ? ` ${el.dataset.unit}` : ""}`));
          root.append(rect);
        });
      } else {
        const pts = rows.map((r, i) => `${x(i, rows.length)},${y(num(r[s + 1] ?? "0"))}`);
        if (type === "area") root.append(svg("polygon", { points: `${x(0, rows.length)},${y(0)} ${pts.join(" ")} ${x(rows.length - 1, rows.length)},${y(0)}`, fill: color, opacity: 0.15 }));
        root.append(svg("polyline", { points: pts.join(" "), fill: "none", stroke: color, "stroke-width": 2.5, "stroke-linejoin": "round" }));
        rows.forEach((r, i) => {
          const dot = svg("circle", { cx: x(i, rows.length), cy: y(num(r[s + 1] ?? "0")), r: 3.5, fill: color });
          dot.append(svg("title", {}, `${r[0]} · ${name}: ${r[s + 1]}`));
          root.append(dot);
        });
      }
    });
    const legend = make("div", { className: "elemnt-chart-legend" });
    series.forEach((name, s) => {
      const swatch = make("i");
      swatch.style.background = COLORS[s % COLORS.length]!;
      legend.append(make("span", {}, swatch, name));
    });
    el.prepend(root, legend);
    el.dataset.drawn = "1";
  }
}
