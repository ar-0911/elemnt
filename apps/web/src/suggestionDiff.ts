import { diffArrays, diffLines, diffWordsWithSpace } from "diff";
import type { Hunk } from "./api";

/** A run of text inside a changed line; `changed` marks the words that differ. */
export interface Seg {
  text: string;
  changed: boolean;
}

export interface Row {
  kind: "ctx" | "del" | "add";
  /** 1-based line number in the current page (ctx and del rows). */
  old?: number;
  /** 1-based line number in the suggested page (ctx and add rows). */
  new?: number;
  text: string;
  /** Word-level highlights, when the line is a light edit of its counterpart. */
  segs?: Seg[];
}

/** Rows that belong to a hunk the reviewer can pick, or unchanged lines between hunks. */
export type Block = { kind: "hunk"; index: number; rows: Row[] } | { kind: "gap"; rows: Row[] };

export interface LineDiff {
  blocks: Block[];
  added: number;
  removed: number;
}

/** A pair of cells for the side-by-side view; null is an empty cell. */
export type Pair = [Row | null, Row | null];

const split = (value: string) => {
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

/**
 * Word-level highlights for a removed line and the line that replaced it.
 * When most of the line changed, highlighting every word is noise, so the
 * whole line keeps its plain red or green instead.
 */
export function wordDiff(before: string, after: string): { before: Seg[]; after: Seg[] } | undefined {
  const parts = diffWordsWithSpace(before, after);
  let same = 0;
  for (const p of parts) if (!p.added && !p.removed) same += p.value.trim().length;
  const longest = Math.max(before.trim().length, after.trim().length);
  if (longest === 0 || same / longest < 0.4) return undefined;
  return {
    before: parts.filter((p) => !p.added).map((p) => ({ text: p.value, changed: Boolean(p.removed) })),
    after: parts.filter((p) => !p.removed).map((p) => ({ text: p.value, changed: Boolean(p.added) })),
  };
}

/** Pairs each run of removed lines with the added lines that follow it. */
function highlightWords(rows: Row[]) {
  for (let i = 0; i < rows.length; ) {
    if (rows[i]!.kind !== "del") {
      i++;
      continue;
    }
    let d = i;
    while (d < rows.length && rows[d]!.kind === "del") d++;
    let a = d;
    while (a < rows.length && rows[a]!.kind === "add") a++;
    const n = Math.min(d - i, a - d);
    for (let k = 0; k < n; k++) {
      const del = rows[i + k]!;
      const add = rows[d + k]!;
      const words = wordDiff(del.text, add.text);
      if (words) {
        del.segs = words.before;
        add.segs = words.after;
      }
    }
    i = a;
  }
}

const within = (n: number | undefined, start: number, count: number) => n !== undefined && n >= start && n < start + count;

/**
 * Lays out the whole page as rows, so unchanged stretches can be folded and
 * expanded, and tags each changed stretch with the server's hunk index so
 * picking a hunk here accepts exactly that hunk.
 */
export function buildLineDiff(base: string, proposed: string, hunks: Hunk[]): LineDiff {
  const rows: Row[] = [];
  let oldNo = 1;
  let newNo = 1;
  let added = 0;
  let removed = 0;
  for (const part of diffLines(base, proposed)) {
    for (const text of split(part.value)) {
      if (part.added) {
        rows.push({ kind: "add", new: newNo++, text });
        added++;
      } else if (part.removed) {
        rows.push({ kind: "del", old: oldNo++, text });
        removed++;
      } else rows.push({ kind: "ctx", old: oldNo++, new: newNo++, text });
    }
  }
  highlightWords(rows);

  const hunkOf = (r: Row) => hunks.find((h) => (r.kind === "add" ? within(r.new, h.newStart, h.newLines) : within(r.old, h.oldStart, h.oldLines)))?.index;
  const blocks: Block[] = [];
  for (const row of rows) {
    const index = hunkOf(row);
    const last = blocks.at(-1);
    if (index === undefined) {
      if (last?.kind === "gap") last.rows.push(row);
      else blocks.push({ kind: "gap", rows: [row] });
    } else if (last?.kind === "hunk" && last.index === index) last.rows.push(row);
    else blocks.push({ kind: "hunk", index, rows: [row] });
  }
  return { blocks, added, removed };
}

/** Lines up removed and added rows so a replaced line sits next to its replacement. */
export function pairRows(rows: Row[]): Pair[] {
  const out: Pair[] = [];
  for (let i = 0; i < rows.length; ) {
    const r = rows[i]!;
    if (r.kind === "ctx") {
      out.push([r, r]);
      i++;
      continue;
    }
    const dels: Row[] = [];
    const adds: Row[] = [];
    while (i < rows.length && rows[i]!.kind === "del") dels.push(rows[i++]!);
    while (i < rows.length && rows[i]!.kind === "add") adds.push(rows[i++]!);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push([dels[k] ?? null, adds[k] ?? null]);
  }
  return out;
}

/** Top-level blocks of compiled HTML, as strings, so two renders can be compared block by block. */
export function topLevelBlocks(html: string): string[] {
  const t = document.createElement("template");
  t.innerHTML = html;
  return [...t.content.children].map((el) => el.outerHTML);
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Wraps the given character ranges of an element's text in <ins> or <del>, across nested tags. */
function markRanges(el: Element, ranges: [number, number][], tag: "ins" | "del") {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  let offset = 0;
  for (const node of nodes) {
    const start = offset;
    const end = (offset += node.data.length);
    const hits = ranges
      .filter(([a, b]) => a < end && b > start)
      .map(([a, b]) => [Math.max(a, start) - start, Math.min(b, end) - start] as const)
      .reverse();
    for (const [a, b] of hits) {
      const mid = node.splitText(a);
      mid.splitText(b - a);
      if (mid.data.trim() === "") continue;
      const w = document.createElement(tag);
      w.className = "rdiff-word";
      mid.replaceWith(w);
      w.append(mid);
    }
  }
}

/** Marks the words that changed between an old block and the block that replaced it. */
function markWords(before: Element, after: Element) {
  const a = before.textContent ?? "";
  const b = after.textContent ?? "";
  if (!wordDiff(a, b)) return;
  const removed: [number, number][] = [];
  const added: [number, number][] = [];
  let i = 0;
  let j = 0;
  for (const p of diffWordsWithSpace(a, b)) {
    const n = p.value.length;
    const visible = p.value.trim() !== "";
    if (p.removed) {
      if (visible) removed.push([i, i + n]);
      i += n;
    } else if (p.added) {
      if (visible) added.push([j, j + n]);
      j += n;
    } else {
      i += n;
      j += n;
    }
  }
  markRanges(before, removed, "del");
  markRanges(after, added, "ins");
}

const parse = (html: string) => {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content.firstElementChild!;
};

/**
 * The suggested page, rendered, with each changed block marked: new blocks in
 * green, removed blocks in red (shown so the reviewer sees what goes away),
 * and edited blocks as their old version followed by the new one, with the
 * changed words highlighted in both.
 */
export function renderedDiff(baseHtml: string, proposedHtml: string): { html: string; changes: number } {
  const parts = diffArrays(topLevelBlocks(baseHtml), topLevelBlocks(proposedHtml), { comparator: (a, b) => norm(a) === norm(b) });
  let html = "";
  let changes = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (!p.added && !p.removed) {
      html += p.value.join("\n");
      continue;
    }
    const next = parts[i + 1];
    if (p.removed && next?.added) {
      changes++;
      const olds = p.value.map(parse);
      const news = next.value.map(parse);
      for (let k = 0; k < Math.min(olds.length, news.length); k++) markWords(olds[k]!, news[k]!);
      html += `<div class="rdiff rdiff-del" data-change="${changes}" data-label="Before">${olds.map((e) => e.outerHTML).join("\n")}</div>`;
      html += `<div class="rdiff rdiff-add" data-label="After">${news.map((e) => e.outerHTML).join("\n")}</div>`;
      i++;
      continue;
    }
    changes++;
    html += p.added
      ? `<div class="rdiff rdiff-add" data-change="${changes}" data-label="Added">${p.value.join("\n")}</div>`
      : `<div class="rdiff rdiff-del" data-change="${changes}" data-label="Removed">${p.value.join("\n")}</div>`;
  }
  return { html, changes };
}
