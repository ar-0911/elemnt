import type { Code } from "mdast";

/** Languages the in-page sandbox can execute: JavaScript natively, Python through Pyodide. */
const RUNNABLE: Record<string, "javascript" | "python"> = {
  js: "javascript",
  javascript: "javascript",
  python: "python",
  py: "python",
};

function metaTokens(code: Code): string[] {
  return (code.meta ?? "").split(/\s+/).filter(Boolean);
}

/** True when the fence asks to be runnable, e.g. ```python run. */
export function wantsRun(code: Code): boolean {
  return metaTokens(code).includes("run");
}

export function runtimeFor(code: Code): "javascript" | "python" | undefined {
  return code.lang ? RUNNABLE[code.lang.toLowerCase()] : undefined;
}

/** The fence's meta without the `run` flag, so agents see a plain code block. */
export function metaWithoutRun(code: Code): string | null {
  const rest = metaTokens(code).filter((t) => t !== "run");
  return rest.length ? rest.join(" ") : null;
}
