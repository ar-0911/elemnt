import { confirmLeave } from "./dialog.js";
import { claim, isDark, make, onThemeChange } from "./theme.js";

/**
 * Host side of the widget sandbox (spec §7). The widget's code runs in an
 * iframe on the separate sandbox origin with sandbox="allow-scripts" only, and
 * a CSP there that forbids network, workers and WebAssembly. This side adds:
 *
 * - a label outside the frame that the widget can't draw over
 * - click-to-run for untrusted pages (trust tiers)
 * - loading only while on screen, unloading in background tabs and off screen
 * - a watchdog: the frame's runtime sends a heartbeat; a frame that stops
 *   beating (blocked main thread) or navigates away is shut down
 * - links only through a "you're leaving" confirmation
 * - a report button and server-side blocking by content hash
 *
 * Frame protocol (messages carry `elemnt: 1`):
 *   frame → host: ready, beat, resize {height}, open {url}, copy {text}
 *   host → frame: theme {dark}
 */
export interface WidgetOptions {
  sandboxOrigin: string;
  /** Run without a click. False on public pages of unverified workspaces. */
  autorun?: boolean;
  /** Keep frames loaded off screen and in background tabs, for printing (the LinkedIn carousel). */
  keepLoaded?: boolean;
  /** Adds "Try it live" with this link under the widget, for static copies such as the carousel PDF. */
  liveUrl?: string;
  /** POSTs a report; omitted in the editor. */
  report?(hash: string, reason: string): Promise<void>;
}

const BEAT_TIMEOUT_MS = 4000;
/** How long a frame may take to send its first message (cold starts, slow networks). */
const LOAD_TIMEOUT_MS = 15000;
const MAX_STRIKES = 2;
const OFFSCREEN_UNLOAD_MS = 3000;

interface Live {
  frame: HTMLIFrameElement;
  loads: number;
  started: number;
  lastBeat: number;
  /** Set by the frame's first message; until then a silent frame is still loading, not busy. */
  heard: boolean;
  strikes: number;
}

/** Tokens a widget gets from the page style, so it can match the page. */
const TOKENS = ["--bg", "--fg", "--muted", "--line", "--surface", "--accent", "--accent-2", "--soft", "--code", "--font-head", "--font-body", "--font-mono", "--radius"];

function themeMessage(el: HTMLElement, dark: boolean) {
  const cs = getComputedStyle(el);
  const vars: Record<string, string> = {};
  for (const t of TOKENS) {
    const v = cs.getPropertyValue(t).trim();
    if (v) vars[t] = v;
  }
  const fonts = document.querySelector<HTMLLinkElement>("link[data-elemnt-fonts]")?.href;
  return { elemnt: 1, type: "theme", dark, vars, ...(fonts ? { fonts } : {}) };
}

export function enhanceWidgets(root: ParentNode, opts: WidgetOptions): void {
  for (const el of root.querySelectorAll<HTMLElement>("elemnt-widget")) {
    if (!claim(el)) continue;
    setup(el, opts);
  }
}

function setup(el: HTMLElement, opts: WidgetOptions) {
  const hash = el.dataset.hash ?? "";
  const height = Math.min(2000, Math.max(40, Number(el.dataset.height) || 320));
  const summary = el.querySelector(".elemnt-widget-summary");
  const box = make("div", { className: "elemnt-widget-frame" });
  const label = make("div", { className: "elemnt-widget-label" });
  const who = el.dataset.author ? ` · by ${el.dataset.author}` : "";
  const hosts = el.dataset.hosts ? ` · can connect to ${el.dataset.hosts}` : "";
  label.append(make("span", { textContent: `Interactive widget${who}${hosts}` }));
  const stage = make("div");
  stage.style.minHeight = `${height}px`;
  box.append(label, stage);
  const liveLinkEl = opts.liveUrl ? liveLink(opts.liveUrl) : undefined;

  if (el.dataset.blocked) {
    stage.append(make("p", { className: "elemnt-widget-summary", textContent: `This widget was disabled: ${el.dataset.blocked}` }));
    el.replaceChildren(box);
    return;
  }

  if (opts.report) {
    const report = make("button", { type: "button", textContent: "Report" });
    report.onclick = async () => {
      const reason = prompt("What's wrong with this widget? (phishing, mining, broken, other)");
      if (!reason) return;
      await opts.report!(hash, reason.slice(0, 500));
      report.textContent = "Reported";
      report.disabled = true;
    };
    label.append(report);
  }

  let live: Live | undefined;
  let stopped = false;
  // Static widgets (HTML and CSS, no script) have nothing to run, so they load without a click.
  let wanted = Boolean(opts.autorun) || el.dataset.static !== undefined;
  let visible = false;
  let offscreenTimer: number | undefined;

  const showStatic = (why?: string) => {
    stage.replaceChildren();
    if (why) stage.append(make("p", { className: "elemnt-widget-summary", textContent: why }));
    if (summary) stage.append(summary.cloneNode(true));
    if (!wanted && !stopped) {
      const run = make("button", { type: "button", className: "elemnt-widget-run", textContent: "Run widget" });
      run.onclick = () => {
        wanted = true;
        start();
      };
      stage.append(run);
    }
  };

  const kill = (why: string) => {
    stopped = true;
    unload();
    showStatic(why);
  };

  const unload = () => {
    if (!live) return;
    live.frame.remove();
    live = undefined;
  };

  const start = () => {
    if (live || stopped || !wanted || !visible || document.hidden) return;
    const frame = make("iframe", { title: el.dataset.title ?? "Interactive widget", src: `${opts.sandboxOrigin}/w/${hash}?theme=${isDark() ? "dark" : "light"}` });
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("allow", "");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("credentialless", "");
    frame.style.height = `${height}px`;
    const l: Live = { frame, loads: 0, started: Date.now(), lastBeat: Date.now(), heard: false, strikes: 0 };
    frame.onload = () => {
      // A second load means the widget navigated its own frame somewhere else.
      if (++l.loads > 1) kill("This widget tried to navigate away and was stopped.");
    };
    live = l;
    stage.replaceChildren(frame);
  };

  const onMessage = (e: MessageEvent) => {
    if (!live || e.source !== live.frame.contentWindow) return;
    const m = e.data as { elemnt?: number; type?: string; height?: number; url?: string; text?: string };
    if (!m || m.elemnt !== 1) return;
    live.lastBeat = Date.now();
    live.heard = true;
    if (m.type === "ready") live.frame.contentWindow?.postMessage(themeMessage(el, isDark()), "*");
    if (m.type === "resize" && typeof m.height === "number") live.frame.style.height = `${Math.min(2000, Math.max(40, Math.round(m.height)))}px`;
    if (m.type === "open" && typeof m.url === "string") {
      let url: URL | undefined;
      try {
        url = new URL(m.url);
      } catch {
        return;
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") return;
      void confirmLeave(url).then((ok) => ok && window.open(url!.href, "_blank", "noopener,noreferrer"));
    }
    if (m.type === "copy" && typeof m.text === "string") void navigator.clipboard?.writeText(m.text.slice(0, 100_000)).catch(() => {});
  };
  addEventListener("message", onMessage);

  // Watchdog: a frame whose event loop is blocked can't send heartbeats.
  const watchdog = setInterval(() => {
    if (!el.isConnected) return cleanup();
    if (!live || document.hidden) return;
    if (!live.heard) {
      if (Date.now() - live.started > LOAD_TIMEOUT_MS) kill("This widget couldn't start. Reload the page to try again.");
      return;
    }
    if (Date.now() - live.lastBeat > BEAT_TIMEOUT_MS) {
      live.strikes++;
      live.lastBeat = Date.now();
      if (live.strikes >= MAX_STRIKES) kill("This widget was stopped because it kept your computer busy.");
    }
  }, 1000);

  const io = new IntersectionObserver(([entry]) => {
    visible = Boolean(entry?.isIntersecting);
    clearTimeout(offscreenTimer);
    if (visible) start();
    else if (!opts.keepLoaded) offscreenTimer = window.setTimeout(() => (unload(), showStatic()), OFFSCREEN_UNLOAD_MS);
  });
  io.observe(el);

  const onVisibility = () => (document.hidden ? opts.keepLoaded || (unload(), showStatic()) : start());
  document.addEventListener("visibilitychange", onVisibility);
  const offTheme = onThemeChange((dark) => live?.frame.contentWindow?.postMessage(themeMessage(el, dark), "*"));

  function cleanup() {
    clearInterval(watchdog);
    io.disconnect();
    removeEventListener("message", onMessage);
    document.removeEventListener("visibilitychange", onVisibility);
    offTheme();
  }

  el.replaceChildren(box, ...(liveLinkEl ? [liveLinkEl] : []));
  showStatic();
}

function liveLink(url: string): HTMLElement {
  const p = make("p", { className: "elemnt-widget-live", textContent: "Interactive on the page: " });
  let shown = url;
  try {
    const u = new URL(url, location.href);
    shown = u.host + u.pathname;
    url = u.href;
  } catch {}
  p.append(make("a", { href: url, textContent: shown }));
  return p;
}
