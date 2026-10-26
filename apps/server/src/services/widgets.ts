import type { CompileResult, WidgetCode } from "@elemnt/core";
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { spaces, users, widgetBlocks, widgetReports, widgets, workspaces } from "../db/schema.js";
import type { BlobStore } from "../lib/blobs.js";
import { HttpError } from "./errors.js";

type Finding = { severity: "error" | "warning"; message: string };

const MINERS = /coin-?hive|cryptonight|crypto-?loot|coinimp|webmine(?:pool)?|minero\.cc|jsecoin|deepminer|monero-?miner|xmrig|nerohut|cryptonoter|authedmine/i;
const POOL = /stratum\+(?:tcp|ssl|tls)|stratum:\/\/|\bpool\.[a-z0-9.-]+:\d{4}\b/i;
const WASM = /WebAssembly\s*\.\s*(?:instantiate(?:Streaming)?|compile(?:Streaming)?|Module|Instance)|\\0asm|\\x00asm|AGFzbQ/;
const PASSWORD = /type\s*=\s*["']?password|autocomplete\s*=\s*["']?(?:current|new)-password/i;
const NETWORK = /\bfetch\s*\(|XMLHttpRequest|\bWebSocket\b|\bEventSource\b|sendBeacon|RTCPeerConnection/;
const LOGIN_BAIT = /(?:sign|log)\s*in|verify your (?:account|identity)|seed phrase|recovery phrase|wallet/i;

/**
 * Scan on save (spec §7): known-bad code is refused before it's published.
 * The sandbox enforces the real limits (no network, no WebAssembly, no eval);
 * this catches the obvious cases early and tells honest authors why.
 */
export function scanWidget(code: WidgetCode, opts: { networkAllowed?: boolean } = {}): Finding[] {
  const all = `${code.html}\n${code.css}\n${code.js}`;
  const out: Finding[] = [];
  if (MINERS.test(all)) out.push({ severity: "error", message: "widget contains known crypto-mining code" });
  if (POOL.test(all)) out.push({ severity: "error", message: "widget references a mining pool" });
  if (WASM.test(all)) out.push({ severity: "error", message: "widgets can't use WebAssembly" });
  if (PASSWORD.test(code.html) || PASSWORD.test(code.js)) out.push({ severity: "error", message: "widgets can't ask for passwords" });
  if (/<input|createElement\(\s*["']input/i.test(all) && LOGIN_BAIT.test(all)) {
    out.push({ severity: "warning", message: "widget asks for input next to sign-in or wallet wording; readers may be warned" });
  }
  if (!opts.networkAllowed && NETWORK.test(code.js)) {
    out.push({ severity: "warning", message: "widgets have no network access; fetch, WebSocket and similar calls will fail" });
  }
  if (/\beval\s*\(|new\s+Function\s*\(/.test(code.js)) out.push({ severity: "warning", message: "eval and new Function are blocked in the sandbox" });
  const longest = Math.max(0, ...code.js.split("\n").map((l) => l.length));
  const escapes = (code.js.match(/\\x[0-9a-f]{2}|\\u[0-9a-f]{4}/gi) ?? []).length;
  const charCodes = (code.js.match(/fromCharCode/g) ?? []).length;
  if (longest > 3000 || escapes > 200 || charCodes > 20) {
    out.push({ severity: "error", message: "widget code looks obfuscated or minified; publish the readable source" });
  }
  return out;
}

/** Adds scan findings to a compile result, as diagnostics on the page. */
export function withWidgetFindings(result: CompileResult, opts: { networkAllowed?: boolean } = {}): CompileResult & { findings: Map<string, Finding[]> } {
  const findings = new Map<string, Finding[]>();
  const extra = result.widgets.flatMap((w) => {
    const f = scanWidget(w.code, opts);
    findings.set(w.hash, f);
    return f.map((x) => ({ ...x, component: "widget" }));
  });
  const diagnostics = [...result.diagnostics, ...extra];
  return { ...result, diagnostics, ok: !diagnostics.some((d) => d.severity === "error"), findings };
}

export const widgetBody = (code: WidgetCode) => JSON.stringify([code.html, code.css, code.js]);

export async function storeWidgets(
  db: Db,
  blobs: BlobStore,
  input: { spaceId: string; pageId?: string; authorId: string; widgets: CompileResult["widgets"]; findings: Map<string, Finding[]> },
) {
  if (input.widgets.length === 0) return;
  const [space] = await db.select({ workspaceId: spaces.workspaceId }).from(spaces).where(eq(spaces.id, input.spaceId));
  for (const w of input.widgets) {
    // The blob's sha256 is the widget hash: the content addresses itself.
    await blobs.put(w.hash, widgetBody(w.code));
    await db
      .insert(widgets)
      .values({ hash: w.hash, workspaceId: space!.workspaceId, authorId: input.authorId, pageId: input.pageId ?? null, summary: w.summary, findings: input.findings.get(w.hash) ?? [] })
      .onConflictDoNothing();
  }
}

export async function loadWidget(db: Db, blobs: BlobStore, hash: string) {
  if (!/^[0-9a-f]{64}$/.test(hash)) return undefined;
  const [row] = await db
    .select({ hash: widgets.hash, workspaceId: widgets.workspaceId, findings: widgets.findings, blocked: widgetBlocks.reason, verified: workspaces.widgetsVerified, hosts: workspaces.widgetHosts })
    .from(widgets)
    .innerJoin(workspaces, eq(workspaces.id, widgets.workspaceId))
    .leftJoin(widgetBlocks, eq(widgetBlocks.hash, widgets.hash))
    .where(eq(widgets.hash, hash));
  if (!row) return undefined;
  const body = await blobs.get(hash);
  if (body === undefined) return undefined;
  const [html, css, js] = JSON.parse(body) as [string, string, string];
  return { ...row, code: { html, css, js }, hosts: row.verified ? row.hosts : [] };
}

/**
 * Adds what the reader needs to the stored HTML at serve time: who wrote each
 * widget, which hosts it may reach, and whether it has been blocked. Stored
 * HTML stays immutable, so a block takes effect on every page immediately.
 */
export async function decorateWidgets(db: Db, html: string): Promise<string> {
  const hashes = [...html.matchAll(/<elemnt-widget data-hash="([0-9a-f]{64})"/g)].map((m) => m[1]!);
  if (hashes.length === 0) return html;
  const rows = await db
    .select({ hash: widgets.hash, author: sql<string | null>`coalesce(${users.name}, ${users.email})`, blocked: widgetBlocks.reason, verified: workspaces.widgetsVerified, hosts: workspaces.widgetHosts })
    .from(widgets)
    .innerJoin(workspaces, eq(workspaces.id, widgets.workspaceId))
    .leftJoin(users, eq(users.id, widgets.authorId))
    .leftJoin(widgetBlocks, eq(widgetBlocks.hash, widgets.hash))
    .where(inArray(widgets.hash, hashes));
  const info = new Map(rows.map((r) => [r.hash, r]));
  const attr = (s: string) => s.replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c]!);
  return html.replace(/<elemnt-widget data-hash="([0-9a-f]{64})"/g, (all, hash: string) => {
    const r = info.get(hash);
    // Unknown hash (stored before scanning existed, or tampered): treat as blocked.
    if (!r) return `${all} data-blocked="this widget isn't registered"`;
    const extra = [r.author ? ` data-author="${attr(r.author)}"` : "", r.blocked ? ` data-blocked="${attr(r.blocked)}"` : "", r.verified && r.hosts.length ? ` data-hosts="${attr(r.hosts.join(", "))}"` : ""];
    return all + extra.join("");
  });
}

export async function widgetSettings(db: Db, workspaceId: string) {
  const [ws] = await db.select({ verified: workspaces.widgetsVerified, hosts: workspaces.widgetHosts }).from(workspaces).where(eq(workspaces.id, workspaceId));
  return ws ?? { verified: false, hosts: [] };
}

export async function reportWidget(db: Db, input: { hash: string; reason: string; pageUrl?: string; reporterId?: string }) {
  const [w] = await db.select({ hash: widgets.hash }).from(widgets).where(eq(widgets.hash, input.hash));
  if (!w) throw new HttpError(404, "No such widget.");
  await db.insert(widgetReports).values({ hash: input.hash, reason: input.reason.slice(0, 500), pageUrl: input.pageUrl?.slice(0, 500) ?? null, reporterId: input.reporterId ?? null });
}

export async function blockWidget(db: Db, input: { hash: string; reason: string; userId: string }) {
  await db
    .insert(widgetBlocks)
    .values({ hash: input.hash, reason: input.reason.slice(0, 200), blockedBy: input.userId })
    .onConflictDoUpdate({ target: widgetBlocks.hash, set: { reason: input.reason.slice(0, 200), blockedBy: input.userId } });
}

export async function unblockWidget(db: Db, hash: string) {
  await db.delete(widgetBlocks).where(eq(widgetBlocks.hash, hash));
}

export async function listReports(db: Db, workspaceId: string) {
  return db
    .select({ hash: widgetReports.hash, reason: widgetReports.reason, pageUrl: widgetReports.pageUrl, createdAt: widgetReports.createdAt, summary: widgets.summary, blocked: widgetBlocks.reason })
    .from(widgetReports)
    .innerJoin(widgets, eq(widgets.hash, widgetReports.hash))
    .leftJoin(widgetBlocks, eq(widgetBlocks.hash, widgetReports.hash))
    .where(eq(widgets.workspaceId, workspaceId))
    .orderBy(desc(widgetReports.createdAt))
    .limit(200);
}
