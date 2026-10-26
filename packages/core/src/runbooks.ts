import type { RootContent } from "mdast";
import { toString } from "mdast-util-to-string";
import { visit } from "unist-util-visit";
import { elemntData, labelText, splitDirective } from "./directive.js";
import type { DirectiveNode, ParsedDocument } from "./types.js";

export interface RunbookStep {
  title: string;
  /** "approve": stop and ask a person before running this step. */
  gate: "none" | "approve";
  /** Regular expression the output should match for the step to pass. */
  expect?: string;
  commands: { lang: string | null; code: string }[];
  /** Prose in the step, as plain text. */
  notes: string;
}

export interface Runbook {
  id: string;
  steps: RunbookStep[];
}

/** Valid runbooks on a page, structured for an agent to execute step by step. */
export function collectRunbooks(doc: ParsedDocument): Runbook[] {
  const out: Runbook[] = [];
  visit(doc.tree, "containerDirective", (node) => {
    const d = node as DirectiveNode;
    const data = elemntData(d);
    if (d.name !== "runbook" || !data) return;
    const steps: RunbookStep[] = [];
    for (const child of d.children) {
      if (child.type !== "containerDirective" || child.name !== "step") continue;
      const props = (elemntData(child as DirectiveNode)?.props ?? {}) as { gate?: "none" | "approve"; expect?: string };
      const { content } = splitDirective(child as DirectiveNode);
      const commands: RunbookStep["commands"] = [];
      const notes: string[] = [];
      for (const c of content as RootContent[]) {
        if (c.type === "code") commands.push({ lang: c.lang ?? null, code: c.value });
        else notes.push(toString(c).trim());
      }
      steps.push({
        title: labelText(child as DirectiveNode) ?? `Step ${steps.length + 1}`,
        gate: props.gate ?? "none",
        ...(props.expect ? { expect: props.expect } : {}),
        commands,
        notes: notes.filter(Boolean).join("\n\n"),
      });
    }
    out.push({ id: (data.props as { id: string }).id, steps });
  });
  return out;
}
