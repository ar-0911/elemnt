import { evaluate, formatNumber } from "@elemnt/core/expr";
import { claim, make } from "./theme.js";

/** `:var` becomes a slider; every `:calc` in the same explore block recomputes as it moves. */
export function enhanceExplore(root: ParentNode): void {
  for (const block of root.querySelectorAll<HTMLElement>("elemnt-explore")) {
    if (!claim(block)) continue;
    const vars: Record<string, number> = {};
    const calcs = [...block.querySelectorAll<HTMLElement>("elemnt-calc")];
    const recompute = () => {
      for (const c of calcs) {
        try {
          const v = formatNumber(evaluate(c.dataset.expr ?? "", vars), Number(c.dataset.digits ?? 0));
          c.textContent = c.dataset.unit ? `${v} ${c.dataset.unit}` : v;
        } catch {
          c.textContent = "?";
        }
      }
    };
    for (const v of block.querySelectorAll<HTMLElement>("elemnt-var")) {
      const name = v.dataset.name!;
      vars[name] = Number(v.dataset.value);
      const out = make("output", { textContent: v.dataset.unit ? `${v.dataset.value} ${v.dataset.unit}` : v.dataset.value ?? "" });
      const input = make("input", { type: "range", min: v.dataset.min ?? "0", max: v.dataset.max ?? "100", step: v.dataset.step ?? "1", value: v.dataset.value ?? "0" });
      input.setAttribute("aria-label", name);
      input.oninput = () => {
        vars[name] = Number(input.value);
        out.textContent = v.dataset.unit ? `${input.value} ${v.dataset.unit}` : input.value;
        recompute();
      };
      v.replaceChildren(out, input);
    }
    recompute();
  }
}
