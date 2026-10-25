import { h } from "hastscript";
import type { List, ListItem, RootContent } from "mdast";
import { toString } from "mdast-util-to-string";
import { z } from "zod";
import { splitDirective } from "../directive.js";
import type { DirectiveNode, ElemntComponent, MarkdownContent } from "../types.js";

const props = z.object({});

function parts(node: DirectiveNode): { list?: List; why: RootContent[] } {
  const content = splitDirective(node).content;
  const i = content.findIndex((c) => c.type === "list");
  return i < 0 ? { why: content } : { list: content[i] as List, why: content.filter((_, j) => j !== i) };
}

const letter = (i: number) => String.fromCharCode(65 + i);

/**
 * Check-your-understanding. Options are a task list where `[x]` marks the
 * right answers; anything after the list explains why. Agents get the
 * question, the options, the answer and the reason, nothing hidden.
 */
export const quiz: ElemntComponent<z.infer<typeof props>> = {
  name: "quiz",
  kinds: ["containerDirective"],
  props,
  validate(node) {
    const { list } = parts(node);
    const problems: string[] = [];
    if (!splitDirective(node).label.length) problems.push("quiz needs the question as its label, e.g. :::quiz[What does a 429 mean?]");
    if (!list || list.children.length < 2) return [...problems, "quiz needs a list of at least two options: `- [ ] wrong` and `- [x] right`"];
    if (list.children.some((o) => o.checked === null || o.checked === undefined)) problems.push("every quiz option must be `- [ ]` or `- [x]`");
    else if (!list.children.some((o) => o.checked)) problems.push("mark at least one right answer with `- [x]`");
    return problems;
  },
  render(node, _props, ctx) {
    const { list, why } = parts(node);
    const options = list?.children ?? [];
    const multiple = options.filter((o) => o.checked).length > 1;
    const option = (o: ListItem, i: number) =>
      h("li", { className: ["elemnt-quiz-option"], dataCorrect: String(Boolean(o.checked)), dataKey: letter(i) }, ctx.children({ ...node, children: o.children } as unknown as DirectiveNode));
    return h("elemnt-quiz", { className: ["elemnt-quiz"], dataMultiple: String(multiple) }, [
      h("p", { className: ["elemnt-quiz-question"] }, ctx.label(node)),
      h("ol", { className: ["elemnt-quiz-options"] }, options.map(option)),
      ...(why.length ? [h("div", { className: ["elemnt-quiz-why"] }, ctx.children({ ...node, children: why } as DirectiveNode))] : []),
    ]);
  },
  toMarkdown(node, _props, ctx) {
    const { list, why } = parts(node);
    const options = list?.children ?? [];
    const right = options.flatMap((o, i) => (o.checked ? [`${letter(i)} (${toString(o).trim()})`] : []));
    const items: ListItem[] = options.map((o, i) => ({ type: "listItem", spread: false, checked: null, children: [{ type: "paragraph", children: [{ type: "text", value: `${letter(i)}. ${toString(o).trim()}` }] }] }));
    return [
      { type: "paragraph", children: [{ type: "strong", children: [{ type: "text", value: "Quiz: " }] }, ...ctx.label(node)] },
      { type: "list", ordered: false, spread: false, children: items },
      { type: "paragraph", children: [{ type: "text", value: `Answer: ${right.join(", ")}.` }] },
      ...(why.length ? ctx.children({ ...node, children: why } as DirectiveNode) : []),
    ] as MarkdownContent[];
  },
  authoring: {
    doc: "A check-your-understanding question. Label is the question; options are a task list with [x] on the right answer(s); text after the list explains why.",
    snippet: ":::quiz[You send 11 requests per second on the Free plan. What happens?]\n- [ ] Requests queue until capacity frees up\n- [x] Requests beyond the limit get a 429 with Retry-After\n- [ ] The API key is suspended\n\nLimits are enforced per key, and over-limit calls fail fast so clients can back off.\n:::",
  },
};
