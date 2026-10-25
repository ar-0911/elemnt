import { h } from "hastscript";
import type { Code, List, ListItem, Paragraph, RootContent } from "mdast";
import { z } from "zod";
import { splitDirective } from "../directive.js";
import type { DirectiveNode, ElemntComponent, MarkdownContent } from "../types.js";

const props = z.object({});
const LINE_PREFIX = /^\s*(\d+)(?:\s*[-–]\s*(\d+))?\s*:\s*/;

interface Note {
  from: number;
  to: number;
  item: ListItem;
}

function parts(node: DirectiveNode): { code?: Code; list?: List; extra: RootContent[] } {
  const content = splitDirective(node).content;
  const code = content.find((c): c is Code => c.type === "code");
  const list = content.find((c): c is List => c.type === "list");
  return { ...(code ? { code } : {}), ...(list ? { list } : {}), extra: content.filter((c) => c !== code && c !== list) };
}

/** Reads "4: note" / "4-6: note" from each list item and strips the prefix. */
function notes(list: List): Note[] {
  return list.children.map((item) => {
    const first = item.children[0] as Paragraph | undefined;
    const lead = first?.type === "paragraph" && first.children[0]?.type === "text" ? first.children[0] : undefined;
    const m = lead?.value.match(LINE_PREFIX);
    if (!m || !first || !lead) return { from: 0, to: 0, item };
    const stripped: Paragraph = { ...first, children: [{ ...lead, value: lead.value.slice(m[0].length) }, ...first.children.slice(1)] };
    return { from: Number(m[1]), to: Number(m[2] ?? m[1]), item: { ...item, children: [stripped, ...item.children.slice(1)] } };
  });
}

/**
 * Code with notes pinned to its lines. People hover a line to read its note;
 * agents get the code followed by "Line 4: …" notes.
 */
export const annotate: ElemntComponent<z.infer<typeof props>> = {
  name: "annotate",
  kinds: ["containerDirective"],
  props,
  validate(node) {
    const { code, list, extra } = parts(node);
    if (!code || !list || extra.length) return ["annotate must contain one code block followed by a list of notes like `- 3: what this line does`"];
    const lines = code.value.split("\n").length;
    const problems: string[] = [];
    for (const [i, n] of notes(list).entries()) {
      if (!n.from) problems.push(`annotate note ${i + 1} must start with a line number, e.g. "3:" or "3-5:"`);
      else if (n.from > lines || n.to > lines || n.to < n.from) problems.push(`annotate note ${i + 1} points at line ${n.from}${n.to !== n.from ? `-${n.to}` : ""}, but the code has ${lines} lines`);
    }
    return problems;
  },
  render(node, _props, ctx) {
    const { code, list } = parts(node);
    const ns = list ? notes(list) : [];
    const lines = (code?.value ?? "").split("\n");
    const noteFor = (line: number) => ns.findIndex((n) => line >= n.from && line <= n.to);
    const rendered = list ? ctx.children({ ...node, children: [{ ...list, ordered: true, children: ns.map((n) => n.item) }] } as DirectiveNode) : [];
    return h("elemnt-annotate", { className: ["elemnt-annotate"] }, [
      h(
        "pre",
        h(
          "code",
          { className: code?.lang ? [`language-${code.lang}`] : [] },
          lines.flatMap((l, i) => {
            const k = noteFor(i + 1);
            return [h("span", { className: ["elemnt-line"], dataLine: String(i + 1), ...(k >= 0 ? { dataNote: String(k + 1) } : {}) }, l), "\n"];
          }),
        ),
      ),
      h("div", { className: ["elemnt-notes"], dataLines: JSON.stringify(ns.map((n) => [n.from, n.to])) }, rendered),
    ]);
  },
  toMarkdown(node) {
    const { code, list } = parts(node);
    const ns = list ? notes(list) : [];
    const items: ListItem[] = ns.map((n) => {
      const label = `Line${n.to !== n.from ? `s ${n.from}–${n.to}` : ` ${n.from}`}: `;
      const [first, ...rest] = n.item.children;
      const head: Paragraph = first?.type === "paragraph" ? { ...first, children: [{ type: "text", value: label }, ...first.children] } : { type: "paragraph", children: [{ type: "text", value: label }] };
      return { ...n.item, children: [head, ...(first?.type === "paragraph" ? rest : n.item.children)] };
    });
    return [...(code ? [{ ...code, meta: null }] : []), { type: "list", ordered: true, spread: false, children: items }] as MarkdownContent[];
  },
  authoring: {
    doc: "Code with notes on specific lines. One code block, then a list where each item starts with the line number (`3:` or `3-5:`).",
    snippet: ":::annotate\n```ts\nconst client = new Acme({ key });\nconst page = await client.users.list({ limit: 50 });\nfor await (const user of page) console.log(user.email);\n```\n- 1: Reads ACME_KEY from the environment if you omit it.\n- 2: 50 is the maximum page size.\n- 3: The iterator fetches further pages for you.\n:::",
  },
};
