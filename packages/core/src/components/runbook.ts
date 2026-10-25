import { h } from "hastscript";
import type { InlineCode, PhrasingContent } from "mdast";
import { z } from "zod";
import { isDirective } from "../directive.js";
import type { ElemntComponent, MarkdownContent } from "../types.js";

const runbookProps = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "use lowercase letters, digits and dashes"),
});

const stepProps = z.object({
  /** `approve` makes an agent stop and ask before running this step. */
  gate: z.enum(["none", "approve"]).default("none"),
  /** Regular expression the command output should match for the step to pass. */
  expect: z.string().max(200).optional(),
});

function hasLabel(node: { children: { data?: unknown }[] }): boolean {
  const data = node.children[0]?.data as { directiveLabel?: boolean } | undefined;
  return Boolean(data?.directiveLabel);
}

/**
 * Steps that people read and agents execute. The agent projection spells out
 * the order, the approval gates and the expected output, so Claude Code can
 * follow it over MCP without guessing.
 */
export const runbook: ElemntComponent<z.infer<typeof runbookProps>> = {
  name: "runbook",
  kinds: ["containerDirective"],
  props: runbookProps,
  validate(_node, _props, { children }) {
    if (children.length === 0) return ["runbook needs at least one :::step"];
    return children.every((c) => isDirective(c) && c.name === "step") ? [] : ["runbook may only contain :::step blocks"];
  },
  render(node, { id }, ctx) {
    return h("elemnt-runbook", { dataRunbook: id }, [h("ol", { className: ["elemnt-runbook"] }, ctx.children(node))]);
  },
  toMarkdown(node, { id }, ctx) {
    const intro: MarkdownContent = {
      type: "paragraph",
      children: [
        { type: "strong", children: [{ type: "text", value: "Runbook " }, { type: "inlineCode", value: id }] },
        {
          type: "text",
          value: ". Run the steps in order. Before any step marked \"approval required\", stop and ask the user. If a step's output doesn't match what is expected, stop and report it.",
        },
      ],
    };
    return [intro, ...ctx.children(node)];
  },
  authoring: {
    doc: "Steps people read and Claude can run. Contains only :::step[Title] blocks; wrap with four colons. Give it a stable id.",
    snippet:
      '::::runbook{id=rotate-api-key}\n:::step[Create the new key]\n```sh\nacme keys create --name prod-2026\n```\n:::\n:::step[Revoke the old key]{gate=approve expect="revoked"}\n```sh\nacme keys revoke prod-2025\n```\n:::\n::::',
  },
};

export const step: ElemntComponent<z.infer<typeof stepProps>> = {
  name: "step",
  kinds: ["containerDirective"],
  props: stepProps,
  validate(node, { expect }, { parent }) {
    const problems: string[] = [];
    if (parent?.name !== "runbook") problems.push("step must be inside ::::runbook");
    if (!hasLabel(node)) problems.push("step needs a title, e.g. :::step[Restart the worker]");
    if (expect !== undefined) {
      try {
        new RegExp(expect);
      } catch {
        problems.push(`expect is not a valid regular expression: ${expect}`);
      }
    }
    return problems;
  },
  render(node, { gate, expect }, ctx) {
    return h("li", { className: ["elemnt-runbook-step"], dataGate: gate }, [
      h("p", { className: ["elemnt-runbook-title"] }, [
        ...ctx.label(node),
        ...(gate === "approve" ? [h("span", { className: ["elemnt-runbook-gate"] }, "Approval required")] : []),
      ]),
      ...ctx.children(node),
      ...(expect ? [h("p", { className: ["elemnt-runbook-expect"] }, ["Expected output matches ", h("code", expect)])] : []),
    ]);
  },
  toMarkdown(node, { gate, expect }, ctx) {
    const parent = ctx.parent(node);
    const index = parent ? parent.children.filter((c) => isDirective(c) && c.name === "step").indexOf(node) + 1 : 1;
    const title: PhrasingContent[] = [{ type: "text", value: `Step ${index}: ` }, ...ctx.label(node)];
    const out: MarkdownContent[] = [{ type: "heading", depth: ctx.headingDepth(node), children: title }];
    if (gate === "approve") out.push({ type: "paragraph", children: [{ type: "strong", children: [{ type: "text", value: "Approval required before running this step." }] }] });
    out.push(...ctx.children(node));
    if (expect) {
      const code: InlineCode = { type: "inlineCode", value: expect };
      out.push({ type: "paragraph", children: [{ type: "text", value: "Expected output matches the regular expression " }, code, { type: "text", value: "." }] });
    }
    return out;
  },
  authoring: { doc: "One step inside ::::runbook. Title in brackets; {gate=approve} to require approval; {expect=\"regex\"} to check output.", snippet: ":::step[Restart the worker]\n...\n:::" },
};
