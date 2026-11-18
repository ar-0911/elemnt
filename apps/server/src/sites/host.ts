import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, normalize } from "node:path";
import { sha256Hex } from "@elemnt/core";
import * as sitesSvc from "../services/sites.js";
import { siteRenderer, SiteRenderError, type SiteRenderer } from "./render.js";
import { siteCss, siteJs } from "./runtime.js";
import { contentType, readFileBytes } from "./tree.js";

/**
 * Serves project websites. Each site is its own origin (`<slug>.<domain>` or a
 * custom hostname), so its free-form JavaScript can't read or ride on an
 * Elemnt session: the app's cookies are host-only and never sent here.
 */

export interface SiteHostDeps extends sitesSvc.SitesDeps {
  /** The @elemnt/elements bundle the app serves at /assets/elements.js. */
  elementsBundle(): Promise<{ js: string; map?: string | undefined; etag: string } | undefined>;
}

const require = createRequire(import.meta.url);
let threeDir: string | undefined;
function threeRoot() {
  if (threeDir === undefined) {
    try {
      // "three" resolves to build/three.cjs; the package root is two levels up.
      threeDir = dirname(dirname(require.resolve("three")));
    } catch {
      threeDir = "";
    }
  }
  return threeDir;
}

export function siteCsp(sandboxUrl: string | undefined, appUrl: string): string {
  return [
    "default-src 'self' https: data: blob:",
    // Designers write their own scripts (and pull libraries from CDNs): that's the point of a site.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob:",
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' https: data: blob:",
    "font-src 'self' https: data:",
    "media-src 'self' https: data: blob:",
    "connect-src 'self' https: wss:",
    "worker-src 'self' blob:",
    `frame-src ${sandboxUrl ? new URL(sandboxUrl).origin : ""} https:`.trim(),
    // The studio previews sites in a frame.
    `frame-ancestors 'self' ${new URL(appUrl).origin}`,
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}

export function siteHost(deps: SiteHostDeps) {
  const renderers = new Map<string, Promise<SiteRenderer>>();
  const pagesCache = new Map<string, { status: number; html: string; etag: string }>();
  const snapshots = new Map<string, { at: number; snap: Promise<Awaited<ReturnType<typeof sitesSvc.snapshot>>> }>();
  const secure = deps.publicUrl.startsWith("https://");

  function headers(extra: Record<string, string>, preview: boolean) {
    return {
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      ...(secure ? { "Strict-Transport-Security": "max-age=31536000" } : {}),
      ...extra,
      ...(preview ? { "X-Robots-Tag": "noindex", "Cache-Control": "private, no-store" } : {}),
    };
  }

  async function getSnapshot(match: sitesSvc.HostMatch) {
    const key = `${match.site.id}|${match.tree}|${match.preview ?? ""}|${match.site.name}|${match.site.spaceId}`;
    const hit = snapshots.get(key);
    if (hit && Date.now() - hit.at < 3000) return hit.snap;
    const snap = sitesSvc.snapshot(deps, match.site, match.tree, match.preview ? { preview: match.preview } : {});
    if (snapshots.size > 200) snapshots.clear();
    snapshots.set(key, { at: Date.now(), snap });
    return snap;
  }

  async function renderer(snap: Awaited<ReturnType<typeof sitesSvc.snapshot>>) {
    let r = renderers.get(snap.key);
    if (!r) {
      if (renderers.size > 30) renderers.clear();
      r = siteRenderer(sitesSvc.rendererDeps(deps), snap);
      renderers.set(snap.key, r);
      r.catch(() => renderers.delete(snap.key));
    }
    return r;
  }

  function errorPage(err: unknown, preview: boolean) {
    const detail =
      preview && err instanceof SiteRenderError
        ? `<pre style="white-space:pre-wrap;text-align:left;background:#111;color:#f88;padding:16px;border-radius:8px">${err.diagnostics.map((d) => `${d.file ?? d.route ?? ""}: ${d.message}`).join("\n").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</pre>`
        : "";
    if (!(err instanceof SiteRenderError)) console.error("site render failed", err);
    return `<!doctype html><meta charset="utf-8"><title>Something went wrong</title><body style="font:16px system-ui;max-width:720px;margin:80px auto;text-align:center"><h1>This page couldn't be built</h1><p>${preview ? "A template has an error:" : "Please try again in a moment."}</p>${detail}</body>`;
  }

  return async function serve(req: Request, match: sitesSvc.HostMatch): Promise<Response> {
    const url = new URL(req.url);
    const preview = Boolean(match.preview);
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    const path = url.pathname;

    // Elemnt's runtime, on the site's own origin.
    if (path === "/_elemnt/site.js") return new Response(siteJs, { headers: headers({ "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" }, false) });
    if (path === "/_elemnt/content.css") return new Response(siteCss, { headers: headers({ "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=300" }, false) });
    if (path === "/_elemnt/elements.js" || path === "/_elemnt/elements.js.map") {
      const b = await deps.elementsBundle();
      if (!b) return new Response("export function enhance() {}\nexport function mountThemeToggle() {}\n", { headers: { "Content-Type": "text/javascript; charset=utf-8" } });
      if (path.endsWith(".map")) return b.map ? new Response(b.map, { headers: { "Content-Type": "application/json" } }) : new Response("Not found", { status: 404 });
      if (req.headers.get("if-none-match") === b.etag) return new Response(null, { status: 304 });
      return new Response(b.js, { headers: headers({ "Content-Type": "text/javascript; charset=utf-8", ETag: b.etag, "Cache-Control": "public, max-age=300" }, false) });
    }
    if (path.startsWith("/_elemnt/vendor/")) return vendor(path.slice("/_elemnt/vendor/".length));

    let snap: Awaited<ReturnType<typeof sitesSvc.snapshot>>;
    let r: SiteRenderer;
    try {
      snap = await getSnapshot(match);
      r = await renderer(snap);
    } catch (err) {
      return new Response(errorPage(err, preview), { status: 500, headers: headers({ "Content-Type": "text/html; charset=utf-8" }, preview) });
    }
    const resolved = r.resolve(path);

    if (resolved?.kind === "file") {
      const entry = snap.tree.files[resolved.file]!;
      const etag = `"${entry.hash.slice(0, 20)}"`;
      if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304 });
      const bytes = await readFileBytes(deps.blobs, snap.tree, resolved.file);
      return new Response(bytes as BodyInit, { headers: headers({ "Content-Type": contentType(resolved.file), ETag: etag, "Cache-Control": "public, max-age=60, stale-while-revalidate=600", "Access-Control-Allow-Origin": "*" }, preview) });
    }
    if (resolved?.kind === "generated") {
      const body = resolved.name === "sitemap" ? r.sitemap() : resolved.name === "robots" ? r.robots() : resolved.name === "llms" ? r.llms() : await r.searchIndex();
      const type = resolved.name === "sitemap" ? "application/xml; charset=utf-8" : resolved.name === "search" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8";
      return new Response(body, { headers: headers({ "Content-Type": type, "Cache-Control": "public, max-age=60" }, preview) });
    }
    if (resolved?.kind === "markdown") {
      return new Response(await r.markdown(resolved.page), { headers: headers({ "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=60" }, preview) });
    }
    // Markdown for agents: Accept: text/markdown on a doc page.
    const accept = req.headers.get("accept") ?? "";
    if (resolved?.kind === "doc" && /text\/markdown/.test(accept) && !/text\/html/.test(accept)) {
      return new Response(await r.markdown(resolved.page), { headers: headers({ "Content-Type": "text/markdown; charset=utf-8", Vary: "Accept" }, preview) });
    }
    // Trailing slashes redirect to the canonical route.
    if (resolved && path !== "/" && path.endsWith("/")) return Response.redirect(new URL(path.replace(/\/+$/, "") + url.search, url).toString(), 301);

    const cacheKey = `${snap.key}|${resolved ? ("route" in resolved ? resolved.route : path) : "404"}`;
    let page = pagesCache.get(cacheKey);
    if (!page) {
      try {
        const out = !resolved
          ? await r.renderNotFound()
          : resolved.kind === "designed"
            ? await r.renderDesigned(resolved.route, resolved.file)
            : resolved.kind === "doc"
              ? await r.renderDoc(resolved.route, resolved.page)
              : await r.renderDocsIndex(resolved.route);
        page = { status: out.status, html: out.html, etag: `"${sha256Hex(out.html).slice(0, 20)}"` };
        if (pagesCache.size > 500) pagesCache.clear();
        pagesCache.set(cacheKey, page);
      } catch (err) {
        return new Response(errorPage(err, preview), { status: 500, headers: headers({ "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": siteCsp(deps.sandboxUrl, deps.publicUrl) }, preview) });
      }
    }
    if (req.headers.get("if-none-match") === page.etag) return new Response(null, { status: 304 });
    return new Response(req.method === "HEAD" ? null : page.html, {
      status: page.status,
      headers: headers({ "Content-Type": "text/html; charset=utf-8", ETag: page.etag, "Cache-Control": "public, max-age=0, must-revalidate", "Content-Security-Policy": siteCsp(deps.sandboxUrl, deps.publicUrl) }, preview),
    });
  };

  async function vendor(rest: string): Promise<Response> {
    const root = threeRoot();
    if (!root) return new Response("three.js isn't installed", { status: 404 });
    let file: string | undefined;
    if (rest === "three.module.js") file = join(root, "build", "three.module.min.js");
    else if (rest === "three.core.js") file = join(root, "build", "three.core.min.js");
    else if (rest.startsWith("three/addons/")) {
      const rel = normalize(rest.slice("three/addons/".length));
      if (rel.startsWith("..") || !/^[\w/.-]+\.js$/.test(rel)) return new Response("Not found", { status: 404 });
      file = join(root, "examples", "jsm", rel);
    }
    if (!file) return new Response("Not found", { status: 404 });
    try {
      const body = await readFile(file);
      return new Response(body as BodyInit, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=86400", "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }
}
