import { describe, expect, it } from "vitest";
import { createElemnt } from "../src/index.js";

const elemnt = createElemnt();

describe("malformed directives", () => {
  it("are an error the author sees, with the line, instead of silent plain text", () => {
    const r = elemnt.compile('Intro\n\n:::callout{type="warn\\" onmouseover=\\"alert(1)"}\nCareful\n:::');
    expect(r.ok).toBe(false);
    expect(r.diagnostics).toEqual([expect.objectContaining({ severity: "error", component: "callout", line: 3 })]);
    expect(r.diagnostics[0]!.message).toContain("matching quotes");
    // Still escaped in the output: the failure is visible, not dangerous.
    expect(r.html).not.toMatch(/<[^>]+onmouseover/);
  });
  it("warn for unknown names and ignore code, prose colons and well-formed components", () => {
    expect(elemnt.compile('::nothing{x="}').diagnostics[0]).toMatchObject({ severity: "warning" });
    for (const ok of ["Meet at 10:30.", "```\n:::callout{bad\"}\n```", "Use `::repo{}` here.", ':::callout{type="warn"}\nok\n:::']) {
      expect(elemnt.compile(ok).diagnostics).toEqual([]);
    }
  });
});
