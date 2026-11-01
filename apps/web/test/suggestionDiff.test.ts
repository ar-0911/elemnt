import { structuredPatch } from "diff";
import { describe, expect, it } from "vitest";
import type { Hunk } from "../src/api";
import { buildLineDiff, pairRows, wordDiff } from "../src/suggestionDiff";

const hunksOf = (a: string, b: string): Hunk[] =>
  structuredPatch("page.md", "page.md", a, b, "", "", { context: 3 }).hunks.map((h, index) => ({ index, ...h }));

const lines = (n: number, edit: Record<number, string> = {}) =>
  Array.from({ length: n }, (_, i) => edit[i + 1] ?? `line ${i + 1}`).join("\n") + "\n";

describe("buildLineDiff", () => {
  it("folds unchanged stretches and tags each change with its hunk", () => {
    const base = lines(40);
    const proposed = lines(40, { 5: "line five, reworded", 30: "line 30 and more" });
    const d = buildLineDiff(base, proposed, hunksOf(base, proposed));
    expect(d.added).toBe(2);
    expect(d.removed).toBe(2);
    expect(d.blocks.map((b) => (b.kind === "hunk" ? `h${b.index}` : "gap"))).toEqual(["gap", "h0", "gap", "h1", "gap"]);
    const h1 = d.blocks[3]!;
    expect(h1.rows.filter((r) => r.kind !== "ctx").map((r) => [r.kind, r.text])).toEqual([
      ["del", "line 30"],
      ["add", "line 30 and more"],
    ]);
  });

  it("highlights only the words that changed in a lightly edited line", () => {
    const base = "Run the server with npm start.\n";
    const proposed = "Run the server with pnpm dev.\n";
    const [block] = buildLineDiff(base, proposed, hunksOf(base, proposed)).blocks;
    const add = block!.rows.find((r) => r.kind === "add")!;
    expect(add.segs?.filter((s) => s.changed).map((s) => s.text)).toEqual(["pnpm", "dev"]);
  });

  it("keeps whole-line colour when a line was rewritten", () => {
    expect(wordDiff("Install with Docker.", "Every request is signed and logged for audit.")).toBeUndefined();
  });

  it("covers pure insertions and deletions", () => {
    const base = lines(10);
    const proposed = lines(10).replace("line 4\n", "") + "line 11\n";
    const d = buildLineDiff(base, proposed, hunksOf(base, proposed));
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.blocks.filter((b) => b.kind === "hunk").length).toBe(hunksOf(base, proposed).length);
    expect(d.blocks.flatMap((b) => b.rows).filter((r) => r.kind !== "ctx" && !d.blocks.some((x) => x.kind === "hunk" && x.rows.includes(r)))).toEqual([]);
  });
});

describe("pairRows", () => {
  it("puts a replaced line next to its replacement and pads the rest", () => {
    const base = "a\nb\nc\n";
    const proposed = "a\nB\nB2\nc\n";
    const rows = buildLineDiff(base, proposed, hunksOf(base, proposed)).blocks.flatMap((b) => b.rows);
    const pairs = pairRows(rows).map(([l, r]) => [l?.text ?? null, r?.text ?? null]);
    expect(pairs).toEqual([
      ["a", "a"],
      ["b", "B"],
      [null, "B2"],
      ["c", "c"],
    ]);
  });
});
