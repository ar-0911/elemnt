import { themeTokensCss } from "@elemnt/core";
import { randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import type { Db } from "./db/index.js";
import type { BlobStore } from "./lib/blobs.js";
import { loadWidget } from "./services/widgets.js";

/**
 * The sandbox origin (spec §7). Only /w/* exists here. Every page is loaded
 * in an iframe with sandbox="allow-scripts", so it runs in an opaque origin
 * with no cookies or storage, and its CSP takes away network, workers,
 * WebAssembly, eval, forms and plugins.
 */

export const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";

interface SandboxDeps {
  db: Db;
  blobs: BlobStore;
  /** Allowed to frame sandbox pages. */
  publicUrl: string;
}

const hostSource = (host: string) => `https://${host}`;

export function widgetCsp(nonce: string, publicUrl: string, hosts: string[]): string {
  const remote = hosts.map(hostSource).join(" ");
  return [
    "default-src 'none'",
    // No 'unsafe-eval' and no 'wasm-unsafe-eval': eval, new Function and WebAssembly all throw.
    `script-src 'nonce-${nonce}'`,
    // Google Fonts only, so a widget can use the page's fonts.
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    `img-src data: blob:${remote ? ` ${remote}` : ""}`,
    "font-src data: https://fonts.gstatic.com",
    "media-src data: blob:",
    `connect-src ${remote || "'none'"}`,
    "worker-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${new URL(publicUrl).origin}`,
  ].join("; ");
}

export function runnerCsp(nonce: string, publicUrl: string, runtime: "javascript" | "python"): string {
  const cdn = "https://cdn.jsdelivr.net";
  return [
    "default-src 'none'",
    // The runner is a throwaway frame with nothing to steal: eval is how it runs the snippet.
    runtime === "python" ? `script-src 'nonce-${nonce}' 'unsafe-eval' 'wasm-unsafe-eval' ${cdn}` : `script-src 'nonce-${nonce}' 'unsafe-eval'`,
    `connect-src ${runtime === "python" ? cdn : "'none'"}`,
    "worker-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${new URL(publicUrl).origin}`,
  ].join("; ");
}

/** Keeps user code from closing the script element it's embedded in. */
export function inlineScript(js: string): string {
  return js.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}

/**
 * Runs before the widget's own code. `elemnt.open(url)` and links go through
 * the host's "you're leaving" dialog; `elemnt.copy(text)` copies; heartbeats
 * let the host stop a frame whose main thread is stuck.
 */
const BRIDGE = `(() => {
  const post = (m) => parent.postMessage(Object.assign({ elemnt: 1 }, m), "*");
  const listeners = [];
  let dark = document.documentElement.dataset.theme === "dark";
  const api = {
    get dark() { return dark; },
    open(url) { post({ type: "open", url: String(url) }); },
    copy(text) { post({ type: "copy", text: String(text) }); },
    onTheme(fn) { listeners.push(fn); fn(dark); },
  };
  Object.defineProperty(window, "elemnt", { value: Object.freeze(api) });
  addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== parent || !m || m.elemnt !== 1 || m.type !== "theme") return;
    dark = Boolean(m.dark);
    const root = document.documentElement;
    root.dataset.theme = dark ? "dark" : "light";
    // The page style's tokens, so the widget matches the page around it.
    for (const [k, v] of Object.entries(m.vars || {})) {
      if (/^--[a-z0-9-]+$/.test(k) && typeof v === "string" && !/url\\(/i.test(v)) root.style.setProperty(k, v);
    }
    if (typeof m.fonts === "string" && m.fonts.startsWith("https://fonts.googleapis.com/css2?") && !document.querySelector("link[data-fonts]")) {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = m.fonts; l.dataset.fonts = "";
      document.head.append(l);
    }
    for (const fn of listeners) try { fn(dark); } catch (err) { console.error(err); }
  });
  document.addEventListener("click", (e) => {
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (!a) return;
    e.preventDefault();
    api.open(a.href);
  }, true);
  setInterval(() => post({ type: "beat" }), 1000);
  let last = 0;
  new ResizeObserver(() => {
    const h = Math.ceil(document.documentElement.scrollHeight);
    if (h !== last) post({ type: "resize", height: (last = h) });
  }).observe(document.documentElement);
  post({ type: "ready" });
})();`;

const WIDGET_CSS = `${themeTokensCss}
html,body{margin:0;background:transparent;color:var(--fg);font:15px/1.5 var(--font-body,system-ui,sans-serif)}
h1,h2,h3,h4{font-family:var(--font-head,inherit)}code,pre{font-family:var(--font-mono,ui-monospace,monospace)}
body{padding:12px}*{box-sizing:border-box}`;

const RUNNER = {
  javascript: `
const out = [];
const show = (v) => typeof v === "string" ? v : (() => { try { return JSON.stringify(v, null, 2) ?? String(v); } catch { return String(v); } })();
for (const k of ["log", "info", "warn", "error", "debug"]) console[k] = (...a) => out.push(a.map(show).join(" "));
addEventListener("message", async (e) => {
  const m = e.data;
  if (e.source !== parent || !m || m.elemnt !== 1 || m.type !== "run") return;
  try {
    const result = await (0, eval)("(async () => {\\n" + String(m.code) + "\\n})()");
    if (result !== undefined) out.push(show(result));
    parent.postMessage({ elemnt: 1, type: "done", output: out.join("\\n").slice(0, 100000) }, "*");
  } catch (err) {
    parent.postMessage({ elemnt: 1, type: "done", output: out.join("\\n").slice(0, 100000), error: String(err && err.stack || err) }, "*");
  }
});
parent.postMessage({ elemnt: 1, type: "ready" }, "*");`,
  python: `
let py;
try {
  const { loadPyodide } = await import("${PYODIDE}pyodide.mjs");
  py = await loadPyodide({ indexURL: "${PYODIDE}" });
} catch (err) {
  // Answer the run request with the failure instead of leaving the reader waiting a minute.
  addEventListener("message", (e) => e.source === parent && e.data?.type === "run" && parent.postMessage({ elemnt: 1, type: "done", error: "Couldn't load Python (Pyodide from cdn.jsdelivr.net): " + String(err && err.message || err) }, "*"));
  parent.postMessage({ elemnt: 1, type: "ready" }, "*");
  throw err;
}
const out = [];
py.setStdout({ batched: (s) => out.push(s) });
py.setStderr({ batched: (s) => out.push(s) });
addEventListener("message", async (e) => {
  const m = e.data;
  if (e.source !== parent || !m || m.elemnt !== 1 || m.type !== "run") return;
  try {
    await py.loadPackagesFromImports(String(m.code));
    const result = await py.runPythonAsync(String(m.code));
    if (result !== undefined && result !== null) out.push(String(result));
    parent.postMessage({ elemnt: 1, type: "done", output: out.join("\\n").slice(0, 100000) }, "*");
  } catch (err) {
    parent.postMessage({ elemnt: 1, type: "done", output: out.join("\\n").slice(0, 100000), error: String(err && err.message || err) }, "*");
  }
});
parent.postMessage({ elemnt: 1, type: "ready" }, "*");`,
};

function secure(c: Context, csp: string) {
  c.header("Content-Security-Policy", csp);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cross-Origin-Resource-Policy", "cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), display-capture=(), clipboard-read=()");
}

export function sandboxApp(deps: SandboxDeps) {
  const app = new Hono();

  app.get("/w/run/:runtime{javascript|python}", (c) => {
    const runtime = c.req.param("runtime") as "javascript" | "python";
    const nonce = randomBytes(16).toString("base64");
    secure(c, runnerCsp(nonce, deps.publicUrl, runtime));
    c.header("Cache-Control", "public, max-age=3600");
    return c.html(`<!doctype html><meta charset="utf-8"><title>Run</title><script type="module" nonce="${nonce}">${RUNNER[runtime]}</script>`);
  });

  app.get("/w/:hash{[0-9a-f]{64}}", async (c) => {
    const w = await loadWidget(deps.db, deps.blobs, c.req.param("hash"));
    if (!w) return c.text("No such widget.", 404);
    if (w.blocked) return c.text(`This widget was disabled: ${w.blocked}`, 410);
    if (w.findings.some((f) => f.severity === "error")) return c.text("This widget failed the safety scan.", 410);
    const nonce = randomBytes(16).toString("base64");
    const theme = c.req.query("theme") === "dark" ? "dark" : "light";
    secure(c, widgetCsp(nonce, deps.publicUrl, w.hosts));
    // Code is content-addressed, but blocks must apply at once: no long caching.
    c.header("Cache-Control", "no-cache");
    return c.html(`<!doctype html>
<html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>${WIDGET_CSS}</style><style>${w.code.css.replace(/<\/(style)/gi, "<\\/$1")}</style>
<script nonce="${nonce}">${BRIDGE}</script>
</head><body>
${w.code.html}
<script type="module" nonce="${nonce}">${inlineScript(w.code.js)}</script>
</body></html>`);
  });

  app.all("*", (c) => c.text("Not found.", 404));
  return app;
}
