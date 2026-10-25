import { claim, make } from "./theme.js";

const TIMEOUT_MS = { javascript: 5000, python: 60000 } as const;

/**
 * ```js run / ```python run: a Run button that executes the block in a
 * throwaway sandboxed frame on the sandbox origin (no network, no access to
 * the page) and shows what it printed.
 */
export function enhanceRun(root: ParentNode, sandboxOrigin: string): void {
  for (const el of root.querySelectorAll<HTMLElement>("elemnt-run")) {
    if (!claim(el)) continue;
    const runtime = el.dataset.runtime === "python" ? "python" : "javascript";
    const code = el.querySelector("code")?.textContent ?? "";
    const button = make("button", { type: "button", className: "elemnt-run-btn", textContent: "Run" });
    const note = make("span", { className: "elemnt-run-note", textContent: runtime === "python" ? "Python in your browser (first run downloads Pyodide)" : "Runs in a sandbox" });
    const output = make("pre", { className: "elemnt-run-output" });
    output.hidden = true;
    output.setAttribute("aria-live", "polite");
    el.append(make("div", { className: "elemnt-run-bar" }, button, note), output);

    button.onclick = () => {
      button.disabled = true;
      output.hidden = false;
      output.removeAttribute("data-error");
      output.textContent = runtime === "python" ? "Loading Python…" : "Running…";
      const frame = make("iframe", { src: `${sandboxOrigin}/w/run/${runtime}` });
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("allow", "");
      frame.hidden = true;
      let timer = 0;
      const finish = (text: string, error = false) => {
        clearTimeout(timer);
        removeEventListener("message", onMessage);
        frame.remove();
        output.textContent = text || "(no output)";
        output.toggleAttribute("data-error", error);
        button.disabled = false;
      };
      const onMessage = (e: MessageEvent) => {
        if (e.source !== frame.contentWindow) return;
        const m = e.data as { elemnt?: number; type?: string; output?: string; error?: string };
        if (m?.elemnt !== 1) return;
        if (m.type === "ready") frame.contentWindow?.postMessage({ elemnt: 1, type: "run", code }, "*");
        if (m.type === "done") finish([m.output, m.error].filter(Boolean).join("\n"), Boolean(m.error));
      };
      addEventListener("message", onMessage);
      timer = window.setTimeout(() => finish(`Stopped after ${TIMEOUT_MS[runtime] / 1000} s.`, true), TIMEOUT_MS[runtime]);
      document.body.append(frame);
    };
  }
}
