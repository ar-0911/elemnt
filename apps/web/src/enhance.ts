/**
 * Client behaviour for rendered pages: tabs and Mermaid. Shared by the editor
 * preview; the reader inlines the same logic. Web Components replace this in M5.
 */
export function enhance(root: HTMLElement) {
  for (const tabs of root.querySelectorAll<HTMLElement>(".elemnt-tabs")) {
    if (tabs.querySelector(":scope > .tablist")) continue;
    const panels = [...tabs.querySelectorAll<HTMLElement>(":scope > .elemnt-tab")];
    if (panels.length < 2) continue;
    const list = document.createElement("div");
    list.className = "tablist";
    list.setAttribute("role", "tablist");
    const select = (i: number) =>
      panels.forEach((p, j) => {
        p.hidden = j !== i;
        list.children[j]?.setAttribute("aria-selected", String(j === i));
      });
    panels.forEach((p, i) => {
      p.querySelector(".elemnt-tab-label")?.setAttribute("hidden", "");
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.textContent = p.dataset.label || `Tab ${i + 1}`;
      b.onclick = () => select(i);
      list.append(b);
    });
    tabs.prepend(list);
    select(0);
  }
  const diagrams = root.querySelectorAll<HTMLElement>("pre.mermaid:not([data-processed])");
  if (diagrams.length) {
    void import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default" });
      try {
        await mermaid.run({ nodes: [...diagrams] });
      } catch {
        // A diagram with a syntax error stays as source text; the author sees it in the preview.
      }
    });
  }
}
