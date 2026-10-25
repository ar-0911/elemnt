import { h } from "hastscript";
import type { Text } from "mdast";
import { visit } from "unist-util-visit";
import { z } from "zod";
import { labelText } from "../directive.js";
import { evaluate, ExprError, exprVariables, formatNumber, parseExpr } from "../expr.js";
import type { DirectiveNode, ElemntComponent } from "../types.js";

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;

const varProps = z.object({
  name: z.string().regex(NAME, "use a short identifier such as rps"),
  min: z.coerce.number(),
  max: z.coerce.number(),
  step: z.coerce.number().positive().optional(),
  unit: z.string().max(20).optional(),
});
const calcProps = z.object({
  expr: z.string().min(1).max(500),
  digits: z.coerce.number().int().min(0).max(6).default(0),
  unit: z.string().max(20).optional(),
});

/** What `:::explore` works out at parse time and leaves on each `:calc`, so both projections show real numbers. */
interface CalcData {
  elemntCalc?: { value?: string; vars: Record<string, number> };
}

const calcData = (node: DirectiveNode) => (node.data as CalcData | undefined)?.elemntCalc;
const defaultOf = (node: DirectiveNode) => Number(labelText(node) ?? NaN);
const withUnit = (v: string, unit?: string) => (unit ? `${v} ${unit}` : v);

/**
 * Prose with live numbers: readers drag `:var` sliders and every `:calc` in the
 * block updates. Agents get the default values and the formula, so they can
 * do the same arithmetic.
 */
export const explore: ElemntComponent<Record<string, never>> = {
  name: "explore",
  kinds: ["containerDirective"],
  props: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
  validate(node) {
    const vars: Record<string, number> = {};
    const calcs: DirectiveNode[] = [];
    const problems: string[] = [];
    visit(node, (n) => {
      if (n === node || (n.type !== "textDirective" && n.type !== "leafDirective")) return;
      const d = n as DirectiveNode;
      if (d.name === "var") {
        const name = d.attributes?.name;
        const value = defaultOf(d);
        if (name && Number.isFinite(value)) vars[name] = value;
      } else if (d.name === "calc") calcs.push(d);
    });
    if (Object.keys(vars).length === 0) problems.push("explore needs at least one `:var[default]{name=… min=… max=…}`");
    for (const c of calcs) {
      const expr = c.attributes?.expr ?? "";
      const digits = Number(c.attributes?.digits ?? 0);
      let value: string | undefined;
      try {
        const missing = exprVariables(expr).filter((v) => !(v in vars));
        if (missing.length) problems.push(`calc "${expr}" uses ${missing.join(", ")}, which no :var in this explore defines`);
        else value = formatNumber(evaluate(expr, vars), Number.isFinite(digits) ? digits : 0);
      } catch (e) {
        if (!(e instanceof ExprError)) throw e;
      }
      c.data = { ...c.data, elemntCalc: { vars, ...(value !== undefined ? { value } : {}) } } as unknown as typeof c.data;
    }
    return problems;
  },
  render(node, _props, ctx) {
    return h("elemnt-explore", { className: ["elemnt-explore"] }, ctx.children(node));
  },
  toMarkdown(node, _props, ctx) {
    return ctx.children(node);
  },
  authoring: {
    doc: "Interactive numbers in prose. Inside, `:var[default]{name=… min=… max=…}` is a slider (optional step, unit) and `:calc{expr=\"…\"}` shows a result that updates as readers drag (optional digits, unit). expr supports + - * / ^, min, max, round, sqrt, log.",
    snippet:
      ":::explore\nAt :var[10]{name=rps min=1 max=50 unit=req/s} you use the 600-request budget in :calc{expr=\"600/rps\" digits=0 unit=s}.\n:::",
  },
};

export const variable: ElemntComponent<z.infer<typeof varProps>> = {
  name: "var",
  kinds: ["textDirective"],
  props: varProps,
  validate(node, { min, max, step }) {
    const v = defaultOf(node);
    const problems: string[] = [];
    if (!Number.isFinite(v)) problems.push("var needs its default value as the label, e.g. :var[10]{name=rps min=1 max=50}");
    else if (v < min || v > max) problems.push(`var default ${v} is outside ${min}–${max}`);
    if (min >= max) problems.push("var min must be below max");
    if (step !== undefined && step > max - min) problems.push("var step is larger than the range");
    return problems;
  },
  render(node, { name, min, max, step, unit }) {
    const v = labelText(node) ?? String(min);
    return h("elemnt-var", { dataName: name, dataMin: String(min), dataMax: String(max), dataStep: String(step ?? (max - min <= 10 ? 0.1 : 1)), dataValue: v, ...(unit ? { dataUnit: unit } : {}) }, withUnit(v, unit));
  },
  toMarkdown(node, { name, min, max, unit }) {
    const v = labelText(node) ?? String(min);
    return [{ type: "text", value: `${withUnit(v, unit)} (adjustable ${name}: ${min} to ${max})` } satisfies Text];
  },
  authoring: { doc: "A slider inside :::explore. The label is the default value.", snippet: ":var[10]{name=rps min=1 max=50 unit=req/s}" },
};

export const calc: ElemntComponent<z.infer<typeof calcProps>> = {
  name: "calc",
  kinds: ["textDirective"],
  props: calcProps,
  validate(node, { expr }) {
    try {
      parseExpr(expr);
    } catch (e) {
      return [`calc expr: ${(e as Error).message}`];
    }
    return calcData(node) ? [] : ["calc must be inside :::explore"];
  },
  render(node, { expr, digits, unit }) {
    const value = calcData(node)?.value ?? labelText(node) ?? "…";
    return h("elemnt-calc", { dataExpr: expr, dataDigits: String(digits), ...(unit ? { dataUnit: unit } : {}) }, withUnit(value, unit));
  },
  toMarkdown(node, { expr, unit }) {
    const value = calcData(node)?.value ?? labelText(node);
    return [{ type: "text", value: `${value !== undefined ? `${withUnit(value, unit)} ` : ""}(= ${expr})` } satisfies Text];
  },
  authoring: { doc: "A computed number inside :::explore.", snippet: ':calc{expr="600/rps" digits=0 unit=s}' },
};
