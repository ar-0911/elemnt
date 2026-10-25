import { claim, make } from "./theme.js";

/** `.elemnt-tabs` (tabs and codegroup): every panel is in the HTML; this adds a tablist. */
export function enhanceTabs(root: ParentNode): void {
  for (const tabs of root.querySelectorAll<HTMLElement>(".elemnt-tabs")) {
    const panels = [...tabs.querySelectorAll<HTMLElement>(":scope > .elemnt-tab")];
    if (panels.length < 2 || !claim(tabs)) continue;
    const list = make("div", { className: "tablist" });
    list.setAttribute("role", "tablist");
    const select = (i: number) =>
      panels.forEach((p, j) => {
        p.hidden = j !== i;
        list.children[j]?.setAttribute("aria-selected", String(j === i));
      });
    panels.forEach((p, i) => {
      p.querySelector(".elemnt-tab-label")?.setAttribute("hidden", "");
      p.setAttribute("role", "tabpanel");
      const b = make("button", { type: "button", textContent: p.dataset.label || `Tab ${i + 1}` });
      b.setAttribute("role", "tab");
      b.onclick = () => select(i);
      b.onkeydown = (e) => {
        const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!d) return;
        const next = (i + d + panels.length) % panels.length;
        select(next);
        (list.children[next] as HTMLElement).focus();
      };
      list.append(b);
    });
    tabs.prepend(list);
    select(0);
  }
}
