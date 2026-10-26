import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { Hono } from "hono";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".map": "application/json",
};

/** The editor bundles its own scripts, Mermaid included, and compiles in a worker. */
export function editorCsp(sandboxUrl?: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    `frame-src ${sandboxUrl ? new URL(sandboxUrl).origin : "'none'"}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Serves the built editor (apps/web/dist) under /app. Hashed assets are cached
 * for a year; every other path falls back to index.html for client routing.
 */
export function editorApp(dir: string, sandboxUrl?: string) {
  const csp = editorCsp(sandboxUrl);
  const root = normalize(dir) + sep;
  const web = new Hono();
  web.get("*", async (c) => {
    const rel = c.req.path.replace(/^\/app\/?/, "");
    const file = normalize(join(root, rel));
    const isAsset = rel.startsWith("assets/") && file.startsWith(root);
    let body: Buffer;
    let path = file;
    try {
      if (!isAsset) throw new Error("spa");
      body = await readFile(file);
    } catch {
      if (isAsset) return c.notFound();
      path = join(root, "index.html");
      body = await readFile(path);
    }
    c.header("Content-Type", TYPES[extname(path)] ?? "application/octet-stream");
    c.header("Content-Security-Policy", csp);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cache-Control", isAsset ? "public, max-age=31536000, immutable" : "no-cache");
    return c.body(new Uint8Array(body));
  });
  return web;
}
