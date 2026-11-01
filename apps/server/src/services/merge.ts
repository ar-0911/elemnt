import { applyPatch, diffArrays, type StructuredPatch } from "diff";

/** A replacement of base lines [start, end) with `lines`; start === end is an insertion. */
interface Edit {
  start: number;
  end: number;
  lines: string[];
}

/** Lines with their line endings kept, so joining them gives the text back exactly. */
const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/** The edits that turn `base` into `other`, in base line positions. */
export function lineEdits(base: string, other: string): Edit[] {
  const edits: Edit[] = [];
  let at = 0;
  let open: Edit | undefined;
  for (const part of diffArrays(lines(base), lines(other))) {
    if (!part.added && !part.removed) {
      if (open) edits.push(open);
      open = undefined;
      at += part.value.length;
      continue;
    }
    open ??= { start: at, end: at, lines: [] };
    if (part.removed) {
      at += part.value.length;
      open.end = at;
    } else open.lines.push(...part.value);
  }
  if (open) edits.push(open);
  return edits;
}

const same = (a: Edit, b: Edit) => a.start === b.start && a.end === b.end && a.lines.join("") === b.lines.join("");

/**
 * Two edits collide when they touch the same base lines, or insert at the same
 * spot, or one inserts inside the other's range. Edits that only sit next to
 * each other merge fine.
 */
function collide(a: Edit, b: Edit): boolean {
  if (same(a, b)) return false;
  if (a.start < b.end && b.start < a.end) return true;
  if (a.start === b.start) return true;
  const inside = (ins: Edit, range: Edit) => ins.start === ins.end && ins.start > range.start && ins.start < range.end;
  return inside(a, b) || inside(b, a);
}

/**
 * A three-way merge by lines: keeps the changes made on the page since `base`
 * and adds the suggestion's changes, as long as no two touch the same lines.
 */
export function merge3(base: string, ours: string, theirs: string): { merged: string } | { conflict: true } {
  const a = lineEdits(base, ours);
  const b = lineEdits(base, theirs).filter((e) => !a.some((x) => same(x, e)));
  if (a.some((x) => b.some((y) => collide(x, y)))) return { conflict: true };
  const all = [...a, ...b].sort((x, y) => x.start - y.start || x.end - y.end);
  const src = lines(base);
  let out = "";
  let at = 0;
  for (const e of all) {
    out += src.slice(at, e.start).join("") + e.lines.join("");
    at = e.end;
  }
  return { merged: out + src.slice(at).join("") };
}

/** Indices of the suggestion's hunks that collide with edits made on the page since it was written. */
export function conflictingHunks(base: string, current: string, patch: StructuredPatch): number[] {
  const ours = lineEdits(base, current);
  const out: number[] = [];
  patch.hunks.forEach((h, i) => {
    const theirs = applyPatch(base, { ...patch, hunks: [h] });
    if (theirs === false || lineEdits(base, theirs).some((e) => ours.some((o) => !same(o, e) && collide(o, e)))) out.push(i);
  });
  return out;
}
