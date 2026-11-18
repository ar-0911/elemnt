import type { Element, ElementContent } from "hast";
import { h, s } from "hastscript";
import type { Code } from "mdast";
import { z } from "zod";
import { splitDirective } from "../directive.js";
import type { DirectiveNode, ElemntComponent } from "../types.js";

/**
 * An infrastructure diagram: regions, networks and subnets drawn as nested
 * boundaries, services drawn with icons, and links with labels and moving
 * traffic. The source is a small text language inside an ```arch block, so
 * agents read exactly what the picture shows.
 *
 *   zone aws "AWS · eu-west-1" region {
 *     zone vpc "Hub VPC · 10.40.0.0/16" vpc {
 *       lb nlb "Network LB" "UDP 51820"
 *       server hub "VPN hub"
 *     }
 *   }
 *   laptop dev "Engineer laptop"
 *   dev => nlb "WireGuard"
 *   nlb -> hub
 */

// ---------- The language ----------

export const ARCH_NODE_KINDS = {
  compute: ["server", "vm", "container", "function", "cluster", "service"],
  network: ["lb", "gateway", "router", "vpn", "dns", "cdn", "internet", "nat"],
  data: ["db", "cache", "queue", "storage", "bucket"],
  security: ["firewall", "secret", "key", "identity"],
  people: ["user", "users", "laptop", "phone", "browser"],
  external: ["cloud", "api", "chat", "repo", "email"],
  ops: ["monitor", "logs", "alert"],
} as const;
export const ARCH_ZONE_KINDS = ["region", "vpc", "subnet", "public", "private", "onprem", "cloud", "account", "cluster", "office", "group"] as const;

const CATEGORY = new Map<string, string>();
for (const [cat, kinds] of Object.entries(ARCH_NODE_KINDS)) for (const k of kinds) CATEGORY.set(k, cat);

type Dir = "right" | "down";
interface ArchNode { type: "node"; id: string; kind: string; label: string; sub?: string; line: number }
interface ArchZone { type: "zone"; id: string; kind: string; label: string; dir?: Dir; items: ArchItem[]; line: number }
type ArchItem = ArchNode | ArchZone;
interface ArchLink { from: string; to: string; label?: string; style: "solid" | "dashed" | "tunnel"; both: boolean; line: number }
export interface ArchSpec { dir: Dir; items: ArchItem[]; links: ArchLink[] }

const STR = /"((?:[^"\\]|\\.)*)"/g;
const unq = (v: string) => v.replace(/\\"/g, '"');

/** Parses arch source. Problems carry 1-based line numbers within the block. */
export function parseArch(src: string): { spec: ArchSpec; problems: string[] } {
  const problems: string[] = [];
  const root: ArchZone = { type: "zone", id: "", kind: "group", label: "", items: [], line: 0 };
  const stack: ArchZone[] = [root];
  const links: ArchLink[] = [];
  const ids = new Map<string, ArchItem>();
  let dir: Dir = "right";
  src.split("\n").forEach((raw, i) => {
    const line = i + 1;
    const text = raw.replace(/(^|\s)(#|\/\/).*$/, "").trim();
    if (!text) return;
    const strings: string[] = [];
    const bare = text.replace(STR, (_m, v: string) => (strings.push(unq(v)), " \u0000 ")).trim();
    const words = bare.split(/\s+/).filter(Boolean);
    const cur = stack[stack.length - 1]!;
    if (words[0] === "}") {
      if (stack.length === 1) problems.push(`line ${line}: "}" without an open zone`);
      else stack.pop();
      return;
    }
    if (words[0] === "direction") {
      if (words[1] === "right" || words[1] === "down") dir = words[1];
      else problems.push(`line ${line}: direction must be right or down`);
      return;
    }
    if (words[0] === "zone" || words[0] === "group") {
      const id = words[1];
      if (!id || id === "\u0000" || !words.includes("{")) {
        problems.push(`line ${line}: write zones as  zone <id> "Label" [kind] [right|down] {`);
        return;
      }
      const rest = words.slice(2).filter((w) => w !== "\u0000" && w !== "{");
      const kind = rest.find((w) => (ARCH_ZONE_KINDS as readonly string[]).includes(w)) ?? "group";
      const zdir = rest.find((w): w is Dir => w === "right" || w === "down");
      const unknown = rest.filter((w) => w !== kind && w !== zdir);
      if (unknown.length) problems.push(`line ${line}: unknown zone word "${unknown[0]}"; zone kinds are ${ARCH_ZONE_KINDS.join(", ")}`);
      const z: ArchZone = { type: "zone", id, kind, label: strings[0] ?? id, dir: zdir, items: [], line };
      if (ids.has(id)) problems.push(`line ${line}: "${id}" is defined twice`);
      ids.set(id, z);
      cur.items.push(z);
      stack.push(z);
      return;
    }
    const arrow = words.findIndex((w) => /^(<?-->?|<?->|<?=>)$/.test(w));
    if (arrow === 1 && words.length >= 3) {
      const a = words[1]!;
      const from = words[0]!, to = words[2]!;
      links.push({
        from, to, label: strings[0], line,
        style: a.includes("=") ? "tunnel" : a.includes("--") ? "dashed" : "solid",
        both: a.startsWith("<") && a.endsWith(">"),
      });
      return;
    }
    const [kind, id] = words;
    if (kind && id && id !== "\u0000" && CATEGORY.has(kind)) {
      const n: ArchNode = { type: "node", id, kind, label: strings[0] ?? id, sub: strings[1], line };
      if (ids.has(id)) problems.push(`line ${line}: "${id}" is defined twice`);
      ids.set(id, n);
      cur.items.push(n);
      return;
    }
    if (kind && !CATEGORY.has(kind) && id) problems.push(`line ${line}: unknown kind "${kind}"; use one of ${[...CATEGORY.keys()].join(", ")}`);
    else problems.push(`line ${line}: can't read "${text.slice(0, 60)}"`);
  });
  if (stack.length > 1) problems.push(`zone "${stack[stack.length - 1]!.id}" is never closed with }`);
  for (const l of links) {
    for (const end of [l.from, l.to]) {
      const t = ids.get(end);
      if (!t) problems.push(`line ${l.line}: link to "${end}", which isn't defined`);
      else if (t.type === "zone") problems.push(`line ${l.line}: links join services, not zones ("${end}")`);
    }
  }
  if (!root.items.length) problems.push("the diagram is empty; add at least one service");
  return { spec: { dir, items: root.items, links }, problems };
}

// ---------- Layout ----------

interface Box { x: number; y: number; w: number; h: number }
const NODE_H = 96, GAP = 34, PAD = 22, HEAD = 30;
const CH = 6.9; // average glyph width at 12.5px

function wrap(text: string, max = 20): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/)) {
    if (line && (line + " " + w).length > max) { out.push(line); line = w; }
    else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out.slice(0, 2);
}

interface Placed { item: ArchItem; box: Box; lines?: string[]; children?: Placed[] }

/** Every service id inside an item. */
function idsIn(item: ArchItem, out = new Set<string>()): Set<string> {
  if (item.type === "node") out.add(item.id);
  else item.items.forEach((c) => idsIn(c, out));
  return out;
}

/** How wide the gap between two neighbours must be so a labelled link between them has room. */
type GapNeed = (a: ArchItem, b: ArchItem) => number;

function measure(item: ArchItem, parentDir: Dir, need: GapNeed): Placed {
  if (item.type === "node") {
    const lines = wrap(item.label);
    const w = Math.max(128, ...lines.map((l) => l.length * CH + 26), (item.sub?.length ?? 0) * 6.2 + 22);
    return { item, lines, box: { x: 0, y: 0, w, h: NODE_H + (lines.length > 1 ? 15 : 0) + (item.sub ? 4 : 0) } };
  }
  const dir: Dir = item.dir ?? (parentDir === "right" ? "down" : "right");
  const kids = item.items.map((c) => measure(c, dir, need));
  // Side by side, a labelled link needs a gap as wide as its label.
  const gaps = kids.slice(1).map((k, i) => (dir === "right" ? Math.max(GAP, need(kids[i]!.item, k.item)) : GAP));
  const gapSum = gaps.reduce((a, g) => a + g, 0);
  let w = 0, h = 0;
  if (dir === "right") {
    w = kids.reduce((a, k) => a + k.box.w, 0) + gapSum;
    h = Math.max(0, ...kids.map((k) => k.box.h));
  } else {
    h = kids.reduce((a, k) => a + k.box.h, 0) + gapSum;
    w = Math.max(0, ...kids.map((k) => k.box.w));
  }
  w = Math.max(w + PAD * 2, item.label.length * 6.6 + 40, 160);
  h = h + PAD * 2 + HEAD;
  // Lay children out inside, centred on the cross axis.
  let cx = PAD, cy = HEAD + PAD;
  const innerW = w - PAD * 2, innerH = h - PAD * 2 - HEAD;
  kids.forEach((k, i) => {
    const g = gaps[i] ?? 0;
    if (dir === "right") {
      k.box.x = cx; k.box.y = cy + (innerH - k.box.h) / 2; cx += k.box.w + g;
    } else {
      k.box.y = cy; k.box.x = cx + (innerW - k.box.w) / 2; cy += k.box.h + g;
    }
  });
  if (dir === "right") {
    const used = kids.reduce((a, k) => a + k.box.w, 0) + gapSum;
    const shift = (innerW - used) / 2;
    for (const k of kids) k.box.x += shift;
  }
  return { item, box: { x: 0, y: 0, w, h }, children: kids };
}

function layoutArch(spec: ArchSpec): { placed: Placed[]; w: number; h: number; boxes: Map<string, Box> } {
  const top: ArchZone = { type: "zone", id: "", kind: "group", label: "", dir: spec.dir, items: spec.items, line: 0 };
  const labelled = spec.links.filter((l) => l.label).map((l) => ({ from: l.from, to: l.to, w: l.label!.length * 6.2 + 14 + 36 }));
  const need: GapNeed = (a, b) => {
    const ia = idsIn(a), ib = idsIn(b);
    let w = 0;
    for (const l of labelled) if ((ia.has(l.from) && ib.has(l.to)) || (ia.has(l.to) && ib.has(l.from))) w = Math.max(w, l.w);
    return w;
  };
  const root = measure(top, spec.dir === "right" ? "down" : "right", need);
  // The invisible root needs no header or padding.
  const offX = -PAD + 8, offY = -(HEAD + PAD) + 8;
  const boxes = new Map<string, Box>();
  const abs = (p: Placed, ox: number, oy: number) => {
    p.box.x += ox; p.box.y += oy;
    boxes.set(p.item.id, p.box);
    p.children?.forEach((c) => abs(c, p.box.x, p.box.y));
  };
  root.children!.forEach((c) => abs(c, offX, offY));
  return { placed: root.children!, w: root.box.w - PAD * 2 + 16, h: root.box.h - PAD * 2 - HEAD + 16, boxes };
}

// ---------- Drawing ----------

const ICONS: Record<string, string> = {
  server: "M7 6h18v6H7zM7 14h18v6H7zM7 22h18v5H7zM10 9h4M10 17h4M21 9h1M21 17h1",
  vm: "M5 7h22v15H5zM9 11h14v7H9zM12 26h8M16 22v4",
  container: "M16 4l11 6v12l-11 6-11-6V10zM5 10l11 6 11-6M16 16v12",
  function: "M9 6h4l9 20M16 15l-6 11",
  cluster: "M16 3l10 5 3 11-7 9H10l-7-9 3-11zM16 9v14M9 13l14 6M23 13L9 19",
  service: "M16 4l10 6v12l-10 6-10-6V10zM11 16h10M16 11v10",
  lb: "M16 5a11 11 0 1 0 0 22 11 11 0 0 0 0-22zM8 16h6M14 16l6-6M14 16h8M14 16l6 6",
  gateway: "M5 27V14a11 11 0 0 1 22 0v13M3 27h26M12 27v-8h8v8",
  router: "M16 5a11 11 0 1 0 0 22 11 11 0 0 0 0-22zM16 8v6M16 18v6M8 16h6M18 16h6M13 11l3-3 3 3M13 21l3 3 3-3",
  vpn: "M10 15v-4a6 6 0 0 1 12 0v4M7 15h18v12H7zM16 19v4",
  dns: "M16 4v24M7 7h15l3 3-3 3H7zM25 16H10l-3 3 3 3h15z",
  cdn: "M16 4a12 12 0 1 0 0 24 12 12 0 0 0 0-24zM4 16h24M17 9l-4 8h6l-4 8",
  internet: "M16 4a12 12 0 1 0 0 24 12 12 0 0 0 0-24zM4 16h24M16 4c5 4 5 20 0 24M16 4c-5 4-5 20 0 24",
  nat: "M5 11h17M18 7l4 4-4 4M27 21H10M14 17l-4 4 4 4",
  db: "M6 8c0-4 20-4 20 0v16c0 4-20 4-20 0zM6 8c0 4 20 4 20 0M6 16c0 4 20 4 20 0",
  cache: "M18 4L8 18h8l-2 10 10-14h-8z",
  queue: "M4 10h24v12H4zM10 10v12M16 10v12M22 10v12",
  storage: "M5 9h22v6H5zM5 17h22v6H5zM9 12h2M9 20h2",
  bucket: "M6 9h20l-3 18H9zM6 9c0 3 20 3 20 0",
  firewall: "M4 7h24v20H4zM4 14h24M4 20h24M11 7v7M21 7v7M16 14v6M26 14v6M6 14v6M11 20v7M21 20v7",
  secret: "M10 15v-4a6 6 0 0 1 12 0v4M7 15h18v12H7zM14 21h4",
  key: "M11 21a6 6 0 1 1 4.5-10L28 23v4h-4v-3h-3v-3h-3.5",
  identity: "M5 7h22v18H5zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM7 22c0-3 2-5 5-5s5 2 5 5M19 12h5M19 16h5",
  user: "M16 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM6 28c0-6 4-10 10-10s10 4 10 10",
  users: "M12 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 26c0-5 4-8 9-8s9 3 9 8M22 13a3.5 3.5 0 1 0 0-7M24 18c3 1 5 4 5 8",
  laptop: "M7 8h18v12H7zM3 24h26l-2-4H5z",
  phone: "M10 4h12v24H10zM15 24h2",
  browser: "M4 6h24v20H4zM4 11h24M7 8.5h1M10 8.5h1",
  cloud: "M9 24a6 6 0 0 1-.5-12A8 8 0 0 1 24 13a5.5 5.5 0 0 1 0 11z",
  api: "M12 6c-4 0-4 4-4 6s-2 4-4 4c2 0 4 2 4 4s0 6 4 6M20 6c4 0 4 4 4 6s2 4 4 4c-2 0-4 2-4 4s0 6-4 6",
  chat: "M5 7h22v14H14l-6 5v-5H5zM10 12h12M10 16h8",
  repo: "M10 5v22M10 19c0-6 12-4 12-10M10 5a2 2 0 1 0 0 .1M22 9a2 2 0 1 0 0 .1M10 27a2 2 0 1 0 0 .1",
  email: "M4 8h24v16H4zM4 8l12 9 12-9",
  monitor: "M4 6h24v16H4zM7 18l5-5 4 3 7-7M12 26h8M16 22v4",
  logs: "M8 4h12l4 4v20H8zM12 12h8M12 16h8M12 20h6",
  alert: "M16 4l13 23H3zM16 12v7M16 22v1",
};

const num = (v: number) => Math.round(v * 10) / 10;

type Side = "l" | "r" | "t" | "b";

type Pt = [number, number];

function port(box: Box, side: Side, offset: number): Pt {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  if (side === "l") return [box.x, cy + offset];
  if (side === "r") return [box.x + box.w, cy + offset];
  if (side === "t") return [cx + offset, box.y];
  return [cx + offset, box.y + box.h];
}

const SIDE_PAIRS: [Side, Side][] = [
  ["r", "l"], ["l", "r"], ["b", "t"], ["t", "b"],
  ["r", "t"], ["r", "b"], ["l", "t"], ["l", "b"], ["b", "l"], ["b", "r"], ["t", "l"], ["t", "r"],
];
const isH = (side: Side) => side === "l" || side === "r";
const dirOf = (side: Side): Pt => (side === "l" ? [-1, 0] : side === "r" ? [1, 0] : side === "t" ? [0, -1] : [0, 1]);

/** Orthogonal routes from p0 (leaving by s0) to p1 (entering by s1): straight, L, or Z with the bend at several places. */
function candidates(p0: Pt, s0: Side, p1: Pt, s1: Side): Pt[][] {
  const out: Pt[][] = [];
  const [dx0, dy0] = dirOf(s0), [dx1, dy1] = dirOf(s1);
  const M = 12;
  // The link must leave toward the target and arrive moving into it.
  if (isH(s0) && isH(s1)) {
    if (dx0 !== -dx1 || (p1[0] - p0[0]) * dx0 < 2 * M) return out;
    if (Math.abs(p0[1] - p1[1]) < 3) return [[p0, [p1[0], p0[1]]]];
    const lo = Math.min(p0[0], p1[0]) + M, hi = Math.max(p0[0], p1[0]) - M, mid = (p0[0] + p1[0]) / 2;
    for (const k of [0, 1, -1, 2, -2, 3, -3, 5, -5, 8, -8, 12, -12, 18, -18]) {
      const mx = mid + k * 10;
      if (mx >= lo && mx <= hi) out.push([p0, [mx, p0[1]], [mx, p1[1]], p1]);
    }
    return out;
  }
  if (!isH(s0) && !isH(s1)) {
    if (dy0 !== -dy1 || (p1[1] - p0[1]) * dy0 < 2 * M) return out;
    if (Math.abs(p0[0] - p1[0]) < 3) return [[p0, [p0[0], p1[1]]]];
    const lo = Math.min(p0[1], p1[1]) + M, hi = Math.max(p0[1], p1[1]) - M, mid = (p0[1] + p1[1]) / 2;
    for (const k of [0, 1, -1, 2, -2, 3, -3, 5, -5, 8, -8, 12, -12, 18, -18]) {
      const my = mid + k * 10;
      if (my >= lo && my <= hi) out.push([p0, [p0[0], my], [p1[0], my], p1]);
    }
    return out;
  }
  // L shape: one bend at the corner.
  const corner: Pt = isH(s0) ? [p1[0], p0[1]] : [p0[0], p1[1]];
  const ok0 = (corner[0] - p0[0]) * dx0 + (corner[1] - p0[1]) * dy0 >= M;
  const ok1 = (p1[0] - corner[0]) * -dx1 + (p1[1] - corner[1]) * -dy1 >= M;
  if (ok0 && ok1) out.push([p0, corner, p1]);
  return out;
}

function segHitsBox(a: Pt, b: Pt, r: Box, pad: number): boolean {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  return x1 > r.x - pad && x0 < r.x + r.w + pad && y1 > r.y - pad && y0 < r.y + r.h + pad;
}

interface Obstacles { nodes: Box[]; tabs: Box[]; segs: [Pt, Pt][] }

function shrink(b: Box, by: number): Box {
  return { x: b.x + by, y: b.y + by, w: b.w - by * 2, h: b.h - by * 2 };
}

/** Lower is better: crossing a card is never worth it, zone tabs and other links are avoided, then shorter with fewer bends. */
function score(pts: Pt[], a: Box, b: Box, obs: Obstacles): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]!, q = pts[i]!;
    for (const box of obs.nodes) {
      if (box === a || box === b) { if (segHitsBox(p, q, shrink(box, 2), 0)) n += 1000; }
      else if (segHitsBox(p, q, box, 6)) n += 1000;
    }
    for (const t of obs.tabs) if (segHitsBox(p, q, t, 2)) n += 120;
    for (const [u, v] of obs.segs) {
      const horiz = p[1] === q[1], uh = u[1] === v[1];
      if (horiz !== uh) continue;
      if (horiz ? Math.abs(p[1] - u[1]) > 5 : Math.abs(p[0] - u[0]) > 5) continue;
      const [s0, s1] = horiz ? [Math.min(p[0], q[0]), Math.max(p[0], q[0])] : [Math.min(p[1], q[1]), Math.max(p[1], q[1])];
      const [t0, t1] = horiz ? [Math.min(u[0], v[0]), Math.max(u[0], v[0])] : [Math.min(u[1], v[1]), Math.max(u[1], v[1])];
      if (Math.min(s1, t1) - Math.max(s0, t0) > 6) n += 90;
    }
  }
  return n + pathLength(pts) + (pts.length - 2) * 28;
}

function bestRoute(a: Box, b: Box, obs: Obstacles, pairs: [Side, Side][], off: [number, number]): { pts: Pt[]; sides: [Side, Side]; cost: number } | undefined {
  let best: { pts: Pt[]; sides: [Side, Side]; cost: number } | undefined;
  for (const [s0, s1] of pairs) {
    for (const pts of candidates(port(a, s0, off[0]), s0, port(b, s1, off[1]), s1)) {
      const cost = score(pts, a, b, obs);
      if (!best || cost < best.cost) best = { pts, sides: [s0, s1], cost };
    }
  }
  return best;
}

const pathD = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${num(p[0])} ${num(p[1])}`).join("");

/** Where a label reads best: on a long stretch, clear of cards, zone tabs and other labels. */
function labelSpot(pts: Pt[], tw: number, obs: Obstacles, placed: Box[]): Pt {
  let best = Infinity, at: Pt = pts[0]!;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!, [x1, y1] = pts[i]!;
    const len = Math.abs(x1 - x0) * 1.6 + Math.abs(y1 - y0);
    for (const f of [0.5, 0.3, 0.7, 0.2, 0.8]) {
      const c: Pt = [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
      const r: Box = { x: c[0] - tw / 2, y: c[1] - 10, w: tw, h: 20 };
      const hit = (bx: Box) => r.x < bx.x + bx.w && r.x + r.w > bx.x && r.y < bx.y + bx.h && r.y + r.h > bx.y;
      let cost = -len + Math.abs(f - 0.5) * 40;
      cost += obs.nodes.filter(hit).length * 2000 + obs.tabs.filter(hit).length * 300 + placed.filter(hit).length * 1500;
      if (cost < best) { best = cost; at = c; }
    }
  }
  return at;
}

function arrowHead(from: [number, number], to: [number, number]): string {
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const l = 9, w = 5;
  const bx = to[0] - Math.cos(ang) * l, by = to[1] - Math.sin(ang) * l;
  const px = -Math.sin(ang) * w, py = Math.cos(ang) * w;
  return `${num(to[0])},${num(to[1])} ${num(bx + px)},${num(by + py)} ${num(bx - px)},${num(by - py)}`;
}

function pathLength(pts: Pt[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.abs(pts[i]![0] - pts[i - 1]![0]) + Math.abs(pts[i]![1] - pts[i - 1]![1]);
  return n;
}

function drawZone(p: Placed, out: Element[]) {
  const z = p.item as ArchZone;
  const { x, y, w, h: hh } = p.box;
  out.push(s("g", { className: ["ea-zone", `ea-z-${z.kind}`] }, [
    s("rect", { x: num(x), y: num(y), width: num(w), height: num(hh), rx: 10 }),
    s("rect", { className: ["ea-zone-tab"], x: num(x), y: num(y), width: num(Math.min(w, z.label.length * 6.6 + 26)), height: 24, rx: 10 }),
    s("text", { x: num(x + 12), y: num(y + 16) }, z.label),
  ]));
  for (const c of p.children ?? []) if (c.item.type === "zone") drawZone(c, out);
}

function drawNodes(p: Placed, out: Element[]) {
  if (p.item.type === "zone") {
    for (const c of p.children ?? []) drawNodes(c, out);
    return;
  }
  const n = p.item;
  const { x, y, w, h: hh } = p.box;
  const cat = CATEGORY.get(n.kind) ?? "compute";
  const cx = x + w / 2;
  const lines = p.lines ?? [n.label];
  out.push(s("g", { className: ["ea-node", `ea-c-${cat}`] }, [
    s("rect", { className: ["ea-card"], x: num(x), y: num(y), width: num(w), height: num(hh), rx: 12 }),
    s("rect", { className: ["ea-tile"], x: num(cx - 21), y: num(y + 10), width: 42, height: 42, rx: 10 }),
    s("path", { className: ["ea-icon"], d: ICONS[n.kind] ?? ICONS.service!, transform: `translate(${num(cx - 16)} ${num(y + 15)})` }),
    s("text", { className: ["ea-label"], x: num(cx), y: num(y + 70) }, lines.map((l, i) => s("tspan", { x: num(cx), dy: i ? 15 : 0 }, l))),
    ...(n.sub ? [s("text", { className: ["ea-sub"], x: num(cx), y: num(y + 70 + lines.length * 15 + 2) }, n.sub)] : []),
  ]));
}

export function renderArch(spec: ArchSpec, title: string): Element {
  const { placed, w, h: hh, boxes } = layoutArch(spec);
  const zones: Element[] = [], nodes: Element[] = [], links: Element[] = [], labels: Element[] = [];
  placed.forEach((p) => (p.item.type === "zone" ? drawZone(p, zones) : null));
  placed.forEach((p) => drawNodes(p, nodes));
  // Obstacles: every card, and the label tab of every zone.
  const obs: Obstacles = { nodes: [], tabs: [], segs: [] };
  const collect = (p: Placed) => {
    if (p.item.type === "zone") {
      obs.tabs.push({ x: p.box.x, y: p.box.y, w: Math.min(p.box.w, p.item.label.length * 6.6 + 26), h: 24 });
      p.children?.forEach(collect);
    } else obs.nodes.push(p.box);
  };
  placed.forEach(collect);
  // Pass 1: the best sides for each link on its own. Then spread links that share a side so they don't overlap.
  const plans = spec.links.map((l) => {
    const a = boxes.get(l.from), b = boxes.get(l.to);
    if (!a || !b) return undefined;
    const first = bestRoute(a, b, { ...obs, segs: [] }, SIDE_PAIRS, [0, 0]);
    return first ? { l, a, b, sides: first.sides, off: [0, 0] as [number, number] } : undefined;
  });
  type Plan = NonNullable<(typeof plans)[number]>;
  const bySide = new Map<string, { plan: Plan; end: 0 | 1 }[]>();
  for (const plan of plans) {
    if (!plan) continue;
    ([0, 1] as const).forEach((end) => {
      const key = `${end ? plan.l.to : plan.l.from}:${plan.sides[end]}`;
      bySide.set(key, [...(bySide.get(key) ?? []), { plan, end }]);
    });
  }
  for (const [key, list] of bySide) {
    const side = key.slice(key.lastIndexOf(":") + 1);
    const along = side === "l" || side === "r" ? "y" : "x";
    const other = (e: { plan: Plan; end: 0 | 1 }) => {
      const o = e.end ? e.plan.a : e.plan.b;
      return along === "y" ? o.y + o.h / 2 : o.x + o.w / 2;
    };
    list.sort((p, q) => other(p) - other(q));
    const box = list[0]!.end ? list[0]!.plan.b : list[0]!.plan.a;
    const span = (along === "y" ? box.h : box.w) * 0.6;
    const step = list.length > 1 ? Math.min(18, span / (list.length - 1)) : 0;
    list.forEach((e, k) => (e.plan.off[e.end] = (k - (list.length - 1) / 2) * step));
  }
  // Pass 2: route for real, steering clear of links already drawn.
  const labelBoxes: Box[] = [];
  plans.forEach((plan, i) => {
    if (!plan) return;
    const { l, a, b } = plan;
    const r = bestRoute(a, b, obs, [plan.sides], plan.off) ?? bestRoute(a, b, obs, SIDE_PAIRS, [0, 0]);
    if (!r) return;
    const pts = r.pts;
    for (let k = 1; k < pts.length; k++) obs.segs.push([pts[k - 1]!, pts[k]!]);
    const d = pathD(pts);
    const last = pts.length - 1;
    const len = pathLength(pts);
    const cls = ["ea-link", `ea-l-${l.style}`];
    const dur = Math.max(1.6, len / 90);
    links.push(s("g", { className: cls }, [
      ...(l.style === "tunnel" ? [s("path", { className: ["ea-tube"], d })] : []),
      s("path", { className: ["ea-wire"], d }),
      s("polygon", { className: ["ea-head"], points: arrowHead(pts[last - 1]!, pts[last]!) }),
      ...(l.both ? [s("polygon", { className: ["ea-head"], points: arrowHead(pts[1]!, pts[0]!) })] : []),
      s("circle", { className: ["ea-packet"], r: l.style === "tunnel" ? 4 : 3 }, [
        s("animateMotion", { path: d, dur: `${num(dur)}s`, begin: `-${num(((i * 0.37) % 1) * dur)}s`, repeatCount: "indefinite" }),
      ]),
    ]));
    if (l.label) {
      const tw = l.label.length * 6.2 + 14;
      const at = labelSpot(pts, tw, obs, labelBoxes);
      labelBoxes.push({ x: at[0] - tw / 2, y: at[1] - 10, w: tw, h: 20 });
      labels.push(s("g", { className: ["ea-link-label", `ea-l-${l.style}`] }, [
        s("rect", { x: num(at[0] - tw / 2), y: num(at[1] - 10), width: num(tw), height: 20, rx: 10 }),
        s("text", { x: num(at[0]), y: num(at[1] + 4) }, l.label),
      ]));
    }
  });
  return s("svg", { viewBox: `0 0 ${num(w)} ${num(hh)}`, width: num(w), height: num(hh), role: "img", ariaLabel: title, className: ["ea-svg"] }, [
    s("title", title),
    s("g", zones),
    s("g", links),
    s("g", nodes),
    s("g", labels),
  ]);
}

/** A plain-words outline of the diagram, for agents and screen readers. */
export function describeArch(spec: ArchSpec): string {
  const names = new Map<string, string>();
  const lines: string[] = [];
  const walk = (items: ArchItem[], depth: number) => {
    for (const it of items) {
      names.set(it.id, it.label);
      const pad = "  ".repeat(depth);
      if (it.type === "zone") {
        lines.push(`${pad}- ${it.label} (${it.kind})`);
        walk(it.items, depth + 1);
      } else lines.push(`${pad}- ${it.label}: ${it.kind}${it.sub ? `, ${it.sub}` : ""}`);
    }
  };
  walk(spec.items, 0);
  if (spec.links.length) {
    lines.push("", "Connections:");
    for (const l of spec.links) {
      const arrow = l.both ? "↔" : "→";
      lines.push(`- ${names.get(l.from) ?? l.from} ${arrow} ${names.get(l.to) ?? l.to}${l.label ? `: ${l.label}` : ""}${l.style === "tunnel" ? " (tunnel)" : l.style === "dashed" ? " (optional or async)" : ""}`);
    }
  }
  return lines.join("\n");
}

// ---------- The component ----------

const props = z.object({ caption: z.string().max(300).optional() });

function source(node: DirectiveNode): Code | undefined {
  return splitDirective(node).content.find((c): c is Code => c.type === "code" && c.lang === "arch");
}

export const architecture: ElemntComponent<z.infer<typeof props>> = {
  name: "architecture",
  kinds: ["containerDirective"],
  props,
  validate(node) {
    const code = source(node);
    if (!code) return ["architecture must contain one ```arch code block"];
    return parseArch(code.value).problems.map((p) => `architecture: ${p}`);
  },
  render(node, { caption }, ctx) {
    const code = source(node);
    const { spec, problems } = parseArch(code?.value ?? "");
    const title = caption ?? ctx.labelText(node) ?? "Architecture diagram";
    const art: ElementContent = problems.length && !spec.items.length ? h("pre", code?.value ?? "") : renderArch(spec, title);
    return h("figure", { className: ["elemnt-arch"] }, [
      h("div", { className: ["elemnt-arch-scroll"] }, [art]),
      ...(caption ? [h("figcaption", caption)] : ctx.label(node).length ? [h("figcaption", ctx.label(node))] : []),
    ]);
  },
  toMarkdown(node, { caption }, ctx) {
    const code = source(node);
    const { spec } = parseArch(code?.value ?? "");
    const text = caption ?? ctx.labelText(node);
    return [
      { type: "paragraph", children: [{ type: "strong", children: [{ type: "text", value: `Architecture${text ? `: ${text}` : ""}` }] }] },
      { type: "code", lang: "text", value: describeArch(spec) },
    ];
  },
  authoring: {
    doc:
      "Infrastructure diagram: nested zones (region, vpc, subnet, public, private, onprem, cloud, account, cluster, office, group) holding services with icons, and labelled links with moving traffic. " +
      "Inside an ```arch block: `zone <id> \"Label\" [kind] [right|down] {` … `}`; a service is `<kind> <id> \"Label\" [\"detail\"]`; a link is `a -> b \"label\"` (`<->` both ways, `-->` dashed, `=>` tunnel). " +
      `Service kinds: ${[...CATEGORY.keys()].join(", ")}. Use it instead of a flowchart whenever the picture is about infrastructure.`,
    snippet:
      ':::architecture{caption="Remote access through the VPN hub"}\n```arch\nlaptop dev "Engineer laptop"\nzone aws "AWS · eu-west-1" region {\n  zone vpc "Hub VPC · 10.40.0.0/16" vpc {\n    lb nlb "Network LB" "UDP 51820"\n    vpn hub "VPN hub"\n  }\n  db app "App database" "10.50.2.15"\n}\ndev => nlb "WireGuard"\nnlb -> hub\nhub -> app "5432"\n```\n:::',
  },
};
