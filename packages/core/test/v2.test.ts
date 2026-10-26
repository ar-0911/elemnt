import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElemnt } from "../src/index.js";

const elemnt = createElemnt();
const source = readFileSync(new URL("./fixtures/runbook.md", import.meta.url), "utf8");
const errors = (s: string) => elemnt.parse(s).diagnostics.map((d) => d.message);

describe("fixture: runbook page", () => {
  const result = elemnt.compile(source);

  it("compiles without diagnostics", () => {
    expect(result.diagnostics).toEqual([]);
  });

  it("renders HTML for people", () => {
    expect(result.html).toMatchSnapshot();
  });

  it("projects Markdown for agents", () => {
    expect(result.markdown).toMatchSnapshot();
  });
});

describe("runbook", () => {
  const { markdown, html } = elemnt.compile(source);

  it("tells agents the order, the gates and the expected output", () => {
    expect(markdown).toContain("**Runbook `rotate-api-key`**. Run the steps in order.");
    expect(markdown).toContain("### Step 1: Create the new key");
    expect(markdown).toContain("### Step 2: Revoke the old key\n\n**Approval required before running this step.**");
    expect(markdown).toContain("Expected output matches the regular expression `revoked prod-2025`.");
  });

  it("marks gated steps for people", () => {
    expect(html).toContain('<elemnt-runbook data-runbook="rotate-api-key">');
    expect(html).toContain('<li class="elemnt-runbook-step" data-gate="approve">');
    expect(html).toContain('<span class="elemnt-runbook-gate">Approval required</span>');
  });

  it("validates structure and props", () => {
    expect(errors("::::runbook{id=x}\nloose\n::::")).toContain("runbook may only contain :::step blocks");
    expect(errors("::::runbook{id=Bad_Id}\n:::step[a]\nb\n:::\n::::")[0]).toMatch(/use lowercase letters/);
    expect(errors(":::step[a]\nb\n:::")).toContain("step must be inside ::::runbook");
    expect(errors("::::runbook{id=x}\n:::step\nb\n:::\n::::")).toContain("step needs a title, e.g. :::step[Restart the worker]");
    expect(errors('::::runbook{id=x}\n:::step[a]{expect="("}\nb\n:::\n::::')).toContain("expect is not a valid regular expression: (");
  });
});

describe("runnable code", () => {
  it("wraps js and python fences marked run, and strips the flag for agents", () => {
    const { html, markdown } = elemnt.compile("```js run title=demo\nconsole.log(1)\n```");
    expect(html).toBe('<elemnt-run data-runtime="javascript"><pre><code class="language-js">console.log(1)\n</code></pre></elemnt-run>');
    expect(markdown).toBe("```js title=demo\nconsole.log(1)\n```\n");
  });

  it("leaves other fences alone", () => {
    expect(elemnt.compile("```js\nx\n```").html).not.toContain("elemnt-run");
  });

  it("warns when a language can't run", () => {
    const doc = elemnt.parse("```rust run\nfn main() {}\n```");
    expect(doc.diagnostics).toEqual([{ severity: "warning", message: "\"rust\" code can't run in the page; only js and python can", line: 1, column: 1 }]);
    expect(elemnt.toHtml(doc)).not.toContain("elemnt-run");
  });
});

describe("query", () => {
  it("renders inline and block forms with a fallback", () => {
    const { html, markdown } = elemnt.compile("p99 is :query[120 ms]{source=metrics key=api.p99 format=ms}.");
    expect(html).toBe('<p>p99 is <elemnt-query data-source="metrics" data-key="api.p99" data-format="ms">120 ms</elemnt-query>.</p>');
    expect(markdown).toBe("p99 is 120 ms (live value: api.p99 from metrics).\n");
  });

  it("requires a source and key", () => {
    expect(errors(":query{key=x}")[0]).toMatch(/^Invalid props: source/);
  });
});

describe("present mode", () => {
  it("splits at h1/h2 and ---, with a title slide from frontmatter", () => {
    const slides = elemnt.toSlides(elemnt.parse(source));
    expect(slides.map((s) => s.title)).toEqual(["Rotate the production API key", "Rotate", "Check your math"]);
    expect(slides[0]?.html).toBe("<h1>Rotate the production API key</h1>\n<p>Quarterly key rotation for the billing service.</p>");
    expect(slides[1]?.html).toContain("elemnt-runbook");
    expect(slides[2]?.html).toContain("elemnt-run");
  });

  it("starts a slide at --- even without a heading", () => {
    const slides = elemnt.toSlides(elemnt.parse("One\n\n---\n\nTwo"));
    expect(slides.map((s) => s.html)).toEqual(["<p>One</p>", "<p>Two</p>"]);
  });

  it("starts a slide at a container that opens with a heading, and marks the cover", () => {
    const slides = elemnt.toSlides(elemnt.parse("---\ntitle: Deck\n---\n\n## One\n\nText\n\n:::band{tone=glow}\n## Two\n\nMore\n:::"));
    expect(slides.map((s) => s.title)).toEqual(["Deck", "One", "Two"]);
    expect(slides.map((s) => s.cover ?? false)).toEqual([true, false, false]);
  });
});
