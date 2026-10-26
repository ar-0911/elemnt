import { describe, expect, it } from "vitest";
import { createElemnt } from "../src/index.js";

const elemnt = createElemnt();
const errors = (s: string) => elemnt.compile(s).diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
const SHA = "3f2a9c1d0e";

describe("repo components", () => {
  it("render links people can follow without JavaScript, with data for the runtime", () => {
    const r = elemnt.compile(`::repo{repo="acme/router"}\n\n::filetree{repo="acme/router" ref="${SHA}" path="src" highlight="src/a.go"}\n\n::snippet[The matcher]{repo="acme/router" ref="${SHA}" path="src/router.go" lines="40-72"}`);
    expect(r.ok).toBe(true);
    expect(r.html).toContain('class="elemnt-repo" data-repo="acme/router"');
    expect(r.html).toContain('href="https://github.com/acme/router"');
    expect(r.html).toContain(`data-ref="${SHA}" data-path="src" data-depth="2" data-highlight="src/a.go"`);
    expect(r.html).toContain(`href="https://github.com/acme/router/tree/${SHA}/src"`);
    expect(r.html).toContain(`href="https://github.com/acme/router/blob/${SHA}/src/router.go#L40-L72">The matcher</a>`);
  });
  it("give agents real links instead of a hole", () => {
    const md = elemnt.compile(`::snippet{repo="acme/router" ref="${SHA}" path="src/router.go" lines="40-72"}\n\n::filetree{repo="acme/router" ref="${SHA}" highlight="a.go, b/"}`).markdown;
    expect(md).toContain(`Code: [src/router.go lines 40-72](https://github.com/acme/router/blob/${SHA}/src/router.go#L40-L72)`);
    expect(md).toContain("- `a.go`");
    expect(md).toContain("- `b/`");
  });
  it("reject bad repos, paths and line ranges", () => {
    expect(errors('::repo{repo="not a repo"}').join()).toMatch(/owner\/name/);
    expect(errors(`::snippet{repo="a/b" ref="${SHA}" path="../etc/passwd"}`).join()).toMatch(/\.\./);
    expect(errors(`::snippet{repo="a/b" ref="${SHA}" path="x.go" lines="1-500"}`).join()).toMatch(/200 lines/);
    expect(errors(`::snippet{repo="a/b" path="x.go"}`).length).toBeGreaterThan(0);
  });
});
