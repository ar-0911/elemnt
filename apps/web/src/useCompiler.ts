import type { Diagnostic, PageStyle, WidgetCode } from "@elemnt/core";
import { useEffect, useRef, useState } from "react";

export interface Compiled {
  html: string;
  markdown: string;
  diagnostics: Diagnostic[];
  /** Code of every valid widget, for the preview to register with the sandbox. */
  widgets: WidgetCode[];
  /** The page's `style:` frontmatter, if valid. */
  style?: PageStyle;
}

/** Compiles in a Web Worker so typing never waits on the parser. Only the latest result is kept. */
export function useCompiler(source: string): Compiled | undefined {
  const worker = useRef<Worker | undefined>(undefined);
  const latest = useRef(0);
  const [result, setResult] = useState<Compiled>();

  useEffect(() => {
    const w = new Worker(new URL("./compile.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<Compiled & { id: number }>) => {
      if (e.data.id === latest.current) setResult(e.data);
    };
    worker.current = w;
    return () => w.terminate();
  }, []);

  useEffect(() => {
    const id = ++latest.current;
    worker.current?.postMessage({ id, source });
  }, [source]);

  return result;
}
