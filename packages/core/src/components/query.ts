import { h } from "hastscript";
import { z } from "zod";
import type { ElemntComponent } from "../types.js";

const props = z.object({
  /** A data source configured by a workspace admin, e.g. `metrics` or `status-api`. */
  source: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "use the source's slug"),
  /** What to read from the source: a metric name, a JSON path or a saved query name. */
  key: z.string().min(1).max(200),
  format: z.enum(["number", "percent", "ms", "bytes", "text"]).default("text"),
});

/**
 * A live value. People see the current value, fetched in the sandbox at view
 * time. Stored projections can't know that value, so agents get where it
 * comes from; the MCP server can resolve it on request.
 */
export const query: ElemntComponent<z.infer<typeof props>> = {
  name: "query",
  kinds: ["leafDirective", "textDirective"],
  props,
  render(node, { source, key, format }, ctx) {
    const fallback = ctx.labelText(node) ?? "…";
    const el = h("elemnt-query", { dataSource: source, dataKey: key, dataFormat: format }, fallback);
    return node.type === "leafDirective" ? h("p", { className: ["elemnt-query"] }, [el]) : el;
  },
  toMarkdown(node, { source, key }, ctx) {
    const label = ctx.labelText(node);
    const text = `${label ? `${label} ` : ""}(live value: ${key} from ${source})`;
    return node.type === "leafDirective" ? [{ type: "paragraph", children: [{ type: "text", value: text }] }] : [{ type: "text", value: text }];
  },
  authoring: {
    doc: "Live value from a configured data source, inline (`:query`) or on its own line (`::query`). Label is the text shown until it loads.",
    snippet: "Current p99 latency is :query[~120 ms]{source=metrics key=api.latency.p99 format=ms}.",
  },
};
