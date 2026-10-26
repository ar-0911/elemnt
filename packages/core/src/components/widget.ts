import { h } from "hastscript";
import type { Code } from "mdast";
import { z } from "zod";
import { sha256Hex } from "../sha256.js";
import { splitDirective } from "../directive.js";
import type { DirectiveNode, ElemntComponent } from "../types.js";

const props = z.object({
  /** Required: what the widget shows, in words. Agents and no-JS readers get only this. */
  summary: z.string().min(10, "summary must describe what the widget shows (10+ characters)").max(1000),
  height: z.coerce.number().int().min(40).max(2000).default(320),
  title: z.string().max(100).optional(),
});

const MAX_BYTES = 100_000;
const LANGS: Record<string, "html" | "css" | "js"> = { html: "html", css: "css", js: "js", javascript: "js" };

export interface WidgetCode {
  html: string;
  css: string;
  js: string;
}

export function widgetCode(node: DirectiveNode): WidgetCode {
  const out: WidgetCode = { html: "", css: "", js: "" };
  for (const c of splitDirective(node).content) {
    if (c.type !== "code") continue;
    const kind = LANGS[(c as Code).lang?.toLowerCase() ?? ""];
    if (kind) out[kind] += (out[kind] ? "\n" : "") + (c as Code).value;
  }
  return out;
}

/** Widgets are content-addressed: the same code has the same hash on every page, which is what the kill switch blocks. */
export function widgetHash(code: WidgetCode): string {
  return sha256Hex(JSON.stringify([code.html, code.css, code.js]));
}

/**
 * The author's own HTML, CSS and JavaScript. It never runs on Elemnt's
 * origin: the page gets a placeholder with the summary, and the reader loads
 * the code by hash into a sandboxed iframe on the user-content origin.
 */
export const widget: ElemntComponent<z.infer<typeof props>> = {
  name: "widget",
  kinds: ["containerDirective"],
  props,
  validate(_node, _props, { children }) {
    const problems: string[] = [];
    const codes = children.filter((c): c is Code => c.type === "code");
    if (codes.length !== children.length) problems.push("widget may only contain ```html, ```css and ```js code blocks");
    const unknown = codes.find((c) => !LANGS[c.lang?.toLowerCase() ?? ""]);
    if (unknown) problems.push(`widget code must be html, css or js, not "${unknown.lang ?? "plain"}"`);
    if (!codes.some((c) => ["html", "js", "javascript"].includes(c.lang?.toLowerCase() ?? ""))) problems.push("widget needs an ```html or ```js block");
    const size = codes.reduce((n, c) => n + new TextEncoder().encode(c.value).length, 0);
    if (size > MAX_BYTES) problems.push(`widget code is ${Math.round(size / 1000)} KB; the limit is ${MAX_BYTES / 1000} KB`);
    return problems;
  },
  render(node, { summary, height, title }) {
    const code = widgetCode(node);
    // HTML and CSS only: nothing runs, so it can load without a click.
    const still = code.js.trim() ? {} : { dataStatic: "" };
    return h("elemnt-widget", { dataHash: widgetHash(code), dataHeight: String(height), ...(title ? { dataTitle: title } : {}), ...still }, [
      h("div", { className: ["elemnt-widget-summary"] }, [h("p", [h("strong", title ? `${title}: ` : "Interactive widget: "), summary])]),
    ]);
  },
  toMarkdown(_node, { summary, title }) {
    return [{ type: "paragraph", children: [{ type: "strong", children: [{ type: "text", value: title ? `Interactive widget (${title}):` : "Interactive widget:" }] }, { type: "text", value: ` ${summary}` }] }];
  },
  authoring: {
    doc: "Your own HTML/CSS/JS, run in a sandbox with no network access. Use it for any layout the built-in components can't express; with no ```js block it is static and loads without a click. The frame gets the page's colour and font tokens (var(--accent), var(--font-head)…). summary is required: it is all agents and no-JS readers get. The frame grows to fit its content. The bridge gives you elemnt.onTheme(cb) (called with true for dark), elemnt.open(url) (asks the reader first) and elemnt.copy(text).",
    snippet:
      ':::widget{height=220 summary="A slider that shows how monthly cost grows with the number of seats: $8 per seat."}\n```html\n<input id="s" type="range" min="1" max="200" value="20"> <output id="o"></output>\n```\n```js\nconst s = document.getElementById("s"), o = document.getElementById("o");\nconst draw = () => (o.textContent = `${s.value} seats: $${s.value * 8}/month`);\ns.oninput = draw; draw();\n```\n:::',
  },
};
