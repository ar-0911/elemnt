import { describe, expect, it } from "vitest";
import { createElemnt, evaluate, widgetCode, widgetHash } from "../src/index.js";
import { ExprError, parseExpr } from "../src/expr.js";

const elemnt = createElemnt();
const compile = (s: string) => elemnt.compile(s);
const errors = (s: string) => compile(s).diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

describe("expressions", () => {
  it("evaluates arithmetic with precedence, functions and variables", () => {
    expect(evaluate("600/rps", { rps: 10 })).toBe(60);
    expect(evaluate("2 + 3 * 4 ^ 2", {})).toBe(50);
    expect(evaluate("-2^2", {})).toBe(-4);
    expect(evaluate("round(max(a, b) / 3, 2)", { a: 1, b: 10 })).toBe(3.33);
  });
  it("rejects anything that isn't arithmetic", () => {
    for (const bad of ["constructor.constructor('x')()", "a.b", "alert(1)", "1 +", "[1]", "`x`"]) expect(() => parseExpr(bad)).toThrow(ExprError);
  });
});

describe("explore", () => {
  const src = ':::explore\nAt :var[10]{name=rps min=1 max=50 unit=req/s} you hit the limit in :calc{expr="600/rps" unit=s}.\n:::';
  it("renders sliders and precomputed results", () => {
    const r = compile(src);
    expect(r.ok).toBe(true);
    expect(r.html).toContain('<elemnt-var data-name="rps" data-min="1" data-max="50"');
    expect(r.html).toContain('<elemnt-calc data-expr="600/rps" data-digits="0" data-unit="s">60 s</elemnt-calc>');
    expect(r.markdown).toContain("At 10 req/s (adjustable rps: 1 to 50) you hit the limit in 60 s (= 600/rps).");
  });
  it("catches undefined variables, bad defaults and stray calcs", () => {
    expect(errors(':::explore\n:var[5]{name=a min=1 max=9} :calc{expr="a*b"}\n:::')[0]).toMatch(/uses b/);
    expect(errors(":::explore\n:var[99]{name=a min=1 max=9}\n:::")[0]).toMatch(/outside 1–9/);
    expect(errors(':calc{expr="1+1"}')[0]).toMatch(/inside :::explore/);
  });
});

describe("chart and datagrid", () => {
  const src = ':::chart{type=line caption="Signups"}\n```csv\nmonth,signups,churned\nJan,120,8\nFeb,"1,180",11\n```\n:::';
  it("renders a table the client draws over, and gives agents the same table", () => {
    const r = compile(src);
    expect(r.ok).toBe(true);
    expect(r.html).toContain('<elemnt-chart data-type="line" data-x="month" data-y="signups,churned">');
    expect(r.html).toContain("<td>1,180</td>");
    expect(r.markdown).toContain("_Line chart: Signups_");
    expect(r.markdown).toMatch(/\| month \| signups \| churned \|/);
  });
  it("validates columns and data", () => {
    expect(errors(':::chart{y=nope}\n```csv\na,b\n1,2\n```\n:::')[0]).toMatch(/no column "nope"/);
    expect(errors(":::chart\n```csv\na,b\nx,y\n```\n:::")[0]).toMatch(/numeric column/);
    expect(errors(":::chart\n```yaml\na: 1\n```\n:::")[0]).toMatch(/csv or json/);
  });
  it("datagrid wraps exactly one table", () => {
    expect(compile(":::datagrid\n| a | b |\n| - | - |\n| 1 | 2 |\n:::").html).toContain("<elemnt-datagrid><table>");
    expect(errors(":::datagrid\nnot a table\n:::")[0]).toMatch(/exactly one Markdown table/);
  });
});

describe("codegroup, annotate, quiz, compare, term", () => {
  it("codegroup labels code blocks by title or language", () => {
    const r = compile(':::codegroup\n```sh title="curl"\ncurl x\n```\n```ts\nx()\n```\n:::');
    expect(r.html).toContain('data-label="curl"');
    expect(r.html).toContain('data-label="ts"');
    expect(r.markdown).toMatch(/## curl\n\n```sh\ncurl x\n```\n\n## ts/);
  });

  it("annotate pins notes to lines", () => {
    const r = compile(":::annotate\n```js\nconst a = 1;\nconst b = 2;\n```\n- 2: Second line.\n:::");
    expect(r.ok).toBe(true);
    expect(r.html).toContain('<span class="elemnt-line" data-line="2" data-note="1">const b = 2;</span>');
    expect(r.markdown).toContain("1. Line 2: Second line.");
    expect(errors(":::annotate\n```js\nx\n```\n- 9: nope\n:::")[0]).toMatch(/has 1 lines/);
  });

  it("quiz keeps the answer and the reason for agents", () => {
    const r = compile(":::quiz[Pick one]\n- [ ] Wrong\n- [x] Right\n\nBecause.\n:::");
    expect(r.ok).toBe(true);
    expect(r.html).toContain('data-correct="true"');
    expect(r.markdown).toContain("Answer: B (Right).");
    expect(r.markdown).toContain("Because.");
    expect(errors(":::quiz[Q]\n- [ ] a\n- [ ] b\n:::")[0]).toMatch(/right answer/);
  });

  it("compare needs two sides", () => {
    expect(compile("::::compare\n:::side[Before]\nA\n:::\n:::side[After]\nB\n:::\n::::").markdown).toMatch(/## Before\n\nA\n\n## After\n\nB/);
    expect(errors("::::compare\n:::side[Only]\nA\n:::\n::::")[0]).toMatch(/exactly two/);
  });

  it("term becomes an inline definition", () => {
    const r = compile('Retries must be :term[idempotent]{def="Safe to repeat."}.');
    expect(r.html).toContain('<dfn class="elemnt-term" title="Safe to repeat." data-def="Safe to repeat." tabindex="0">idempotent</dfn>');
    expect(r.markdown).toContain("idempotent (Safe to repeat.).");
  });
});

describe("widget", () => {
  const src = ':::widget{height=200 summary="Shows cost per seat as you drag."}\n```html\n<input id=s type=range>\n```\n```js\ns.oninput = () => {};\n```\n:::';
  it("puts only a hash and the summary on the page", () => {
    const r = compile(src);
    expect(r.ok).toBe(true);
    expect(r.html).toMatch(/<elemnt-widget data-hash="[0-9a-f]{64}" data-height="200">/);
    expect(r.html).not.toContain("oninput");
    expect(r.html).not.toContain("<input");
    expect(r.markdown.trim()).toBe("**Interactive widget:** Shows cost per seat as you drag.");
  });
  it("is content-addressed", () => {
    const doc = elemnt.parse(src);
    const node = doc.tree.children[0] as never;
    const code = widgetCode(node);
    expect(code.js).toContain("oninput");
    expect(compile(src).html).toContain(widgetHash(code));
  });
  it("requires a summary and known languages", () => {
    expect(errors(":::widget\n```js\nx\n```\n:::")[0]).toMatch(/summary/);
    expect(errors(':::widget{summary="A long enough summary"}\n```python\nx\n```\n:::')[0]).toMatch(/html, css or js/);
  });
});

describe("authoring guide", () => {
  it("lists every component with an example that compiles cleanly", () => {
    for (const c of elemnt.components.values()) {
      if (["tab", "step", "side", "var", "calc"].includes(c.name)) continue;
      const r = compile(c.authoring.snippet);
      expect({ name: c.name, errors: r.diagnostics.filter((d) => d.severity === "error") }).toEqual({ name: c.name, errors: [] });
    }
  });
});

describe("runbooks", () => {
  it("extracts steps, gates and commands for agents", () => {
    const e = createElemnt();
    const books = e.runbooks('::::runbook{id=rotate}\n:::step[Create key]\nMake a new one.\n```sh\nacme keys create\n```\n:::\n:::step[Revoke old]{gate=approve expect="revoked"}\n```sh\nacme keys revoke old\n```\n:::\n::::\n');
    expect(books).toEqual([
      {
        id: "rotate",
        steps: [
          { title: "Create key", gate: "none", commands: [{ lang: "sh", code: "acme keys create" }], notes: "Make a new one." },
          { title: "Revoke old", gate: "approve", expect: "revoked", commands: [{ lang: "sh", code: "acme keys revoke old" }], notes: "" },
        ],
      },
    ]);
  });
});
