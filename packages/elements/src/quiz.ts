import { claim, make } from "./theme.js";

/** Pick an option, see if it's right, then read why. Multi-answer quizzes get a Check button. */
export function enhanceQuiz(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>("elemnt-quiz")) {
    if (!claim(el)) continue;
    const options = [...el.querySelectorAll<HTMLElement>(".elemnt-quiz-option")];
    const multiple = el.dataset.multiple === "true";
    const status = make("p", { className: "elemnt-quiz-status" });
    status.setAttribute("role", "status");
    const reveal = (picked: HTMLElement[]) => {
      const right = options.filter((o) => o.dataset.correct === "true");
      const correct = picked.length === right.length && picked.every((p) => right.includes(p));
      for (const o of options) delete o.dataset.picked;
      for (const p of picked) p.dataset.picked = p.dataset.correct === "true" ? "right" : "wrong";
      status.textContent = correct ? "Correct." : `Not quite. The answer is ${right.map((r) => r.dataset.key).join(" and ")}.`;
      if (!correct) for (const r of right) r.dataset.picked = "right";
      el.dataset.answered = "1";
    };
    const chosen = new Set<HTMLElement>();
    for (const o of options) {
      o.tabIndex = 0;
      o.setAttribute("role", multiple ? "checkbox" : "radio");
      const pick = () => {
        if (!multiple) return reveal([o]);
        if (!chosen.delete(o)) chosen.add(o);
        o.setAttribute("aria-checked", String(chosen.has(o)));
        o.dataset.picked = chosen.has(o) ? "chosen" : "";
      };
      o.onclick = pick;
      o.onkeydown = (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick());
    }
    const why = el.querySelector(".elemnt-quiz-why");
    if (multiple) {
      const check = make("button", { type: "button", className: "elemnt-run-btn", textContent: "Check" });
      check.onclick = () => reveal([...chosen]);
      el.insertBefore(check, why);
    }
    el.insertBefore(status, why);
    el.dataset.ready = "1";
  }
}
