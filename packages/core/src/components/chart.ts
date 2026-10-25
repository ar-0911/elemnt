import { h } from "hastscript";
import type { Code } from "mdast";
import { z } from "zod";
import type { ElemntComponent, MarkdownContent } from "../types.js";
import { datasetToMdastTable, isNumeric, readDataset, type Dataset } from "./data.js";

const props = z.object({
  type: z.enum(["bar", "line", "area"]).default("bar"),
  /** Column for the x axis; defaults to the first column. */
  x: z.string().optional(),
  /** Comma-separated series columns; defaults to every numeric column except x. */
  y: z.string().optional(),
  caption: z.string().max(300).optional(),
  unit: z.string().max(20).optional(),
});
type Props = z.infer<typeof props>;

function dataCode(children: readonly { type: string }[]): Code | undefined {
  const code = children.filter((c) => c.type === "code");
  return children.length === 1 && code.length === 1 ? (code[0] as Code) : undefined;
}

function resolve(d: Dataset, p: Props): { x: string; y: string[] } {
  const x = p.x ?? d.columns[0]!;
  const y = p.y ? p.y.split(",").map((s) => s.trim()).filter(Boolean) : d.columns.filter((c) => c !== x && d.rows.every((r) => isNumeric(r[c] ?? "")));
  return { x, y };
}

function load(node: { children: readonly { type: string }[] }, p: Props) {
  const code = dataCode(node.children.filter((c) => !("data" in c && (c.data as { directiveLabel?: boolean } | undefined)?.directiveLabel)));
  if (!code) throw new Error("chart must contain exactly one ```csv or ```json block");
  const d = readDataset(code);
  return { d, ...resolve(d, p) };
}

/**
 * A chart from inline data. Server HTML is the data table (readable without
 * JavaScript and by screen readers); `<elemnt-chart>` draws an SVG over it.
 * Agents get the same table with the caption.
 */
export const chart: ElemntComponent<Props> = {
  name: "chart",
  kinds: ["containerDirective"],
  props,
  validate(node, p) {
    let r;
    try {
      r = load(node, p);
    } catch (e) {
      return [`chart: ${(e as Error).message}`];
    }
    const missing = [r.x, ...r.y].filter((c) => !r.d.columns.includes(c));
    if (missing.length) return [`chart has no column ${missing.map((m) => `"${m}"`).join(", ")}; columns are ${r.d.columns.join(", ")}`];
    if (r.y.length === 0) return ["chart needs at least one numeric column to plot"];
    const bad = r.y.find((c) => !r.d.rows.every((row) => isNumeric(row[c] ?? "")));
    return bad ? [`chart column "${bad}" has values that aren't numbers`] : [];
  },
  render(node, p, ctx) {
    let loaded;
    try {
      loaded = load(node, p);
    } catch {
      return h("figure", { className: ["elemnt-chart"] }, ctx.children(node));
    }
    const { d, x, y } = loaded;
    const caption = p.caption ?? ctx.labelText(node);
    return h("figure", { className: ["elemnt-chart"] }, [
      h("elemnt-chart", { dataType: p.type, dataX: x, dataY: y.join(","), ...(p.unit ? { dataUnit: p.unit } : {}) }, [
        h("table", [
          h("thead", [h("tr", [x, ...y].map((c) => h("th", c)))]),
          h("tbody", d.rows.map((r) => h("tr", [x, ...y].map((c) => h("td", r[c] ?? ""))))),
        ]),
      ]),
      ...(caption ? [h("figcaption", caption)] : []),
    ]);
  },
  toMarkdown(node, p, ctx) {
    let loaded;
    try {
      loaded = load(node, p);
    } catch {
      return ctx.children(node);
    }
    const { d, x, y } = loaded;
    const caption = p.caption ?? ctx.labelText(node);
    const label = `${p.type[0]!.toUpperCase()}${p.type.slice(1)} chart${caption ? `: ${caption}` : ""}${p.unit ? ` (${p.unit})` : ""}`;
    return [
      { type: "paragraph", children: [{ type: "emphasis", children: [{ type: "text", value: label }] }] },
      datasetToMdastTable({ columns: [x, ...y], rows: d.rows }),
    ] as MarkdownContent[];
  },
  authoring: {
    doc: "Bar, line or area chart from an inline ```csv (or ```json array) block. x defaults to the first column; y to every numeric column.",
    snippet: ':::chart{type=line x=month y="signups,churned" caption="Signups per month"}\n```csv\nmonth,signups,churned\nJan,120,8\nFeb,180,11\nMar,260,9\n```\n:::',
  },
};
