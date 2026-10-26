/// <reference lib="webworker" />
import { createElemnt } from "@elemnt/core";

// The same compiler the server uses, so the preview is exactly what readers get.
const elemnt = createElemnt();

self.onmessage = (e: MessageEvent<{ id: number; source: string }>) => {
  const { id, source } = e.data;
  const result = elemnt.compile(source);
  self.postMessage({ id, html: result.html, markdown: result.markdown, diagnostics: result.diagnostics, widgets: result.widgets.map((w) => w.code) });
};
