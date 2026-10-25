import { describe, expect, it, beforeEach } from "vitest";
import { createElemnt } from "../../core/src/index.js";
import { enhance } from "../src/index.js";

const elemnt = createElemnt();
function mount(source: string, options = {}) {
  const root = document.createElement("article");
  root.innerHTML = elemnt.compile(source).html;
  document.body.replaceChildren(root);
  enhance(root, { loadMermaid: () => new Promise(() => {}), ...options });
  return root;
}

beforeEach(() => {
  globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
});

describe("enhance", () => {
  it("turns tabs into a tablist and switches panels", () => {
    const root = mount("::::tabs\n:::tab[npm]\nA\n:::\n:::tab[pnpm]\nB\n:::\n::::");
    const buttons = root.querySelectorAll<HTMLButtonElement>(".tablist button");
    expect([...buttons].map((b) => b.textContent)).toEqual(["npm", "pnpm"]);
    buttons[1]!.click();
    const panels = root.querySelectorAll<HTMLElement>(".elemnt-tab");
    expect(panels[0]!.hidden).toBe(true);
    expect(panels[1]!.hidden).toBe(false);
  });

  it("is idempotent", () => {
    const root = mount("::::tabs\n:::tab[a]\nA\n:::\n:::tab[b]\nB\n:::\n::::");
    enhance(root);
    expect(root.querySelectorAll(".tablist").length).toBe(1);
  });

  it("draws a chart over its table", () => {
    const root = mount(":::chart\n```csv\nm,v\nJan,1\nFeb,3\n```\n:::");
    expect(root.querySelector("elemnt-chart svg")).not.toBeNull();
    expect(root.querySelectorAll("elemnt-chart rect").length).toBe(2);
    expect(root.querySelector("elemnt-chart")!.getAttribute("data-drawn")).toBe("1");
  });

  it("sorts and filters a datagrid", () => {
    const root = mount(":::datagrid\n| name | n |\n| - | - |\n| b | 10 |\n| a | 9 |\n| c | 100 |\n:::");
    const th = root.querySelectorAll<HTMLElement>("th");
    th[1]!.click();
    expect([...root.querySelectorAll("tbody tr")].map((r) => r.firstElementChild!.textContent)).toEqual(["a", "b", "c"]);
    const filter = root.querySelector<HTMLInputElement>(".elemnt-datagrid-filter")!;
    filter.value = "c";
    filter.dispatchEvent(new Event("input"));
    expect([...root.querySelectorAll<HTMLElement>("tbody tr")].filter((r) => !r.hidden).length).toBe(1);
  });

  it("recomputes explore values when a slider moves", () => {
    const root = mount(':::explore\n:var[10]{name=rps min=1 max=50} → :calc{expr="600/rps" unit=s}\n:::');
    const slider = root.querySelector<HTMLInputElement>("elemnt-var input")!;
    expect(root.querySelector("elemnt-calc")!.textContent).toBe("60 s");
    slider.value = "20";
    slider.dispatchEvent(new Event("input"));
    expect(root.querySelector("elemnt-calc")!.textContent).toBe("30 s");
  });

  it("marks quiz answers", () => {
    const root = mount(":::quiz[Q?]\n- [ ] no\n- [x] yes\n\nWhy.\n:::");
    const opts = root.querySelectorAll<HTMLElement>(".elemnt-quiz-option");
    opts[0]!.click();
    expect(opts[0]!.dataset.picked).toBe("wrong");
    expect(opts[1]!.dataset.picked).toBe("right");
    expect(root.querySelector(".elemnt-quiz-status")!.textContent).toMatch(/answer is B/);
  });
});

describe("widget host", () => {
  const src = ':::widget{summary="Shows a slider for seats and cost."}\n```js\n1\n```\n:::';

  it("shows the summary and a Run button when it may not autorun", () => {
    const root = mount(src, { sandboxOrigin: "https://box.example", widgets: { autorun: false } });
    expect(root.querySelector(".elemnt-widget-label")!.textContent).toContain("Interactive widget");
    expect(root.querySelector(".elemnt-widget-run")).not.toBeNull();
    expect(root.querySelector("iframe")).toBeNull();
  });

  it("never renders a blocked widget", () => {
    const root = document.createElement("div");
    root.innerHTML = elemnt.compile(src).html.replace("<elemnt-widget ", '<elemnt-widget data-blocked="reported as phishing" ');
    enhance(root, { sandboxOrigin: "https://box.example", widgets: { autorun: true } });
    expect(root.textContent).toContain("This widget was disabled: reported as phishing");
    expect(root.querySelector("iframe")).toBeNull();
  });

  it("does nothing without a sandbox origin", () => {
    const root = mount(src);
    expect(root.querySelector(".elemnt-widget-frame")).toBeNull();
    expect(root.querySelector(".elemnt-widget-summary")).not.toBeNull();
  });
});
