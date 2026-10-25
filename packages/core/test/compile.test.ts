import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { builtinComponents, createElemnt, type ElemntComponent } from "../src/index.js";
import { z } from "zod";

const elemnt = createElemnt();
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

function errors(source: string) {
  return elemnt.parse(source).diagnostics.map((d) => d.message);
}

describe("fixture: onboarding page", () => {
  const result = elemnt.compile(fixture("onboarding.md"));

  it("compiles without diagnostics", () => {
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("renders HTML for people", () => {
    expect(result.html).toMatchSnapshot();
  });

  it("projects Markdown for agents", () => {
    expect(result.markdown).toMatchSnapshot();
  });

  it("leaves no directive syntax in the agent Markdown", () => {
    expect(result.markdown).not.toMatch(/^:{2,}/m);
  });

  it("reads frontmatter", () => {
    expect(result.frontmatter).toEqual({
      title: "Deploying the billing service",
      summary: "How billing goes from a merged PR to production.",
    });
  });
});

describe("callout", () => {
  it("defaults to a note with a generated title", () => {
    const { html, markdown } = elemnt.compile(":::callout\nHello.\n:::");
    expect(html).toBe('<aside class="elemnt-callout" data-type="note" role="note"><p class="elemnt-callout-title">Note</p><p>Hello.</p></aside>');
    expect(markdown).toBe("> **Note**: Hello.\n");
  });

  it("rejects an unknown type", () => {
    expect(errors(":::callout{type=loud}\nHi\n:::")[0]).toMatch(/^Invalid props: type:/);
  });
});

describe("tabs", () => {
  it("uses a heading one level below the surrounding section for each tab", () => {
    const { markdown } = elemnt.compile("### Install\n\n::::tabs\n:::tab[npm]\nA\n:::\n::::");
    expect(markdown).toBe("### Install\n\n#### npm\n\nA\n");
  });

  it("requires tab children and labels", () => {
    expect(errors("::::tabs\nloose text\n::::")).toContain("tabs may only contain :::tab blocks");
    expect(errors("::::tabs\n:::tab\nA\n:::\n::::")).toContain("tab needs a label, e.g. :::tab[curl]");
    expect(errors(":::tab[x]\nA\n:::")).toContain("tab must be inside ::::tabs");
  });
});

describe("steps", () => {
  it("requires exactly one numbered list", () => {
    expect(errors(":::steps\n- a\n- b\n:::")).toEqual(["steps must contain exactly one numbered list (1. 2. 3.)"]);
  });
});

describe("details", () => {
  it("hides content for people but never for agents", () => {
    const { html, markdown } = elemnt.compile(":::details[More]{open}\nDeep text.\n:::");
    expect(html).toContain("<details class=\"elemnt-details\" open>");
    expect(markdown).toBe("**More**\n\nDeep text.\n");
  });
});

describe("diagram", () => {
  it("rejects non-mermaid sources", () => {
    expect(errors(":::diagram\n```dot\na -> b\n```\n:::")).toEqual(['diagram language "dot" is not supported; use mermaid']);
  });
});

describe("robustness", () => {
  it("reports unknown block components with their position and keeps the content", () => {
    const doc = elemnt.parse("Intro\n\n:::carousel\nData here\n:::");
    expect(doc.diagnostics).toEqual([{ severity: "error", message: 'Unknown component "carousel"', component: "carousel", line: 3, column: 1 }]);
    expect(elemnt.toHtml(doc)).toContain('<div data-elemnt-invalid="carousel"><p>Data here</p></div>');
    expect(elemnt.toAgentMarkdown(doc)).toBe("Intro\n\nData here\n");
  });

  it("treats unknown inline directives as literal text", () => {
    const { markdown, diagnostics } = elemnt.compile("Call at 10:30, see note:this{x=1}.");
    expect(diagnostics).toEqual([]);
    expect(markdown).toBe('Call at 10:30, see note:this{x="1"}.\n');
  });

  it("drops raw HTML and scripts from source", () => {
    const { html } = elemnt.compile('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\nSafe.');
    expect(html).not.toMatch(/script|onerror/);
    expect(html).toContain("<p>Safe.</p>");
  });

  it("sanitizes hostile prop values", () => {
    const { html } = elemnt.compile(':::diagram{caption="<img src=x onerror=alert(1)>"}\n```mermaid\nflowchart LR\n a-->b\n```\n:::');
    expect(html).not.toContain("<img");
  });

  it("reports invalid YAML frontmatter instead of throwing", () => {
    expect(errors("---\ntitle: [unclosed\n---\nBody")[0]).toMatch(/^Frontmatter is not valid YAML/);
  });

  it("keeps parsed trees structured-cloneable for workers and caches", () => {
    const doc = elemnt.parse(fixture("onboarding.md"));
    expect(() => structuredClone(doc)).not.toThrow();
  });
});

describe("registry", () => {
  const badge: ElemntComponent<{ tone: "new" | "beta" }> = {
    name: "badge",
    kinds: ["textDirective"],
    props: z.object({ tone: z.enum(["new", "beta"]).default("new") }),
    render: (node, { tone }, ctx) => ({ type: "element", tagName: "span", properties: { className: ["badge"], dataTone: tone }, children: ctx.label(node) }),
    toMarkdown: (node, _p, ctx) => [{ type: "text", value: `(${ctx.labelText(node) ?? ""})` }],
    authoring: { doc: "Inline status badge.", snippet: ":badge[beta]{tone=beta}" },
  };

  it("accepts custom components alongside the built-ins", () => {
    const custom = createElemnt({ components: [...builtinComponents, badge] });
    const { html, markdown } = custom.compile("Search :badge[beta]{tone=beta} is here.");
    expect(html).toBe('<p>Search <span class="badge" data-tone="beta">beta</span> is here.</p>');
    expect(markdown).toBe("Search (beta) is here.\n");
  });

  it("rejects duplicate names", () => {
    expect(() => createElemnt({ components: [...builtinComponents, { ...badge, name: "callout" }] })).toThrow(/Duplicate/);
  });

  it("enforces the allowed directive form", () => {
    expect(errors("::callout")).toEqual(['"callout" must be written as :::callout']);
  });

  it("produces an authoring guide covering every component", () => {
    const guide = elemnt.authoringGuide();
    for (const c of builtinComponents) expect(guide).toContain(`## ${c.name}`);
    expect(elemnt.parse(guide).diagnostics).toEqual([]);
  });

  it("every built-in snippet is valid on its own", () => {
    for (const c of builtinComponents.filter((c) => !["tab", "step", "side", "var", "calc"].includes(c.name))) {
      expect(elemnt.parse(c.authoring.snippet).diagnostics, c.name).toEqual([]);
    }
  });
});
