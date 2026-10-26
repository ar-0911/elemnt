import { enhanceAnnotate } from "./annotate.js";
import { enhanceChart } from "./chart.js";
import { enhanceDatagrid } from "./datagrid.js";
import { enhanceExplore } from "./explore.js";
import { enhanceMermaid, type MermaidLoader } from "./mermaid.js";
import { enhanceQuery } from "./query.js";
import { enhanceQuiz } from "./quiz.js";
import { enhanceRun } from "./run.js";
import { enhanceTabs } from "./tabs.js";
import { enhanceWidgets, type WidgetOptions } from "./widget.js";

export interface EnhanceOptions {
  /** Where sandboxed code runs, e.g. https://acme.elemntusercontent.com. Widgets and runnable code are off without it. */
  sandboxOrigin?: string;
  widgets?: Omit<WidgetOptions, "sandboxOrigin">;
  /** Base for `:query` lookups; defaults to the current origin. */
  queryEndpoint?: string;
  loadMermaid?: MermaidLoader;
}

/**
 * Hydrates server-rendered Elemnt HTML inside `root`. Safe to call again after
 * the HTML changes (the editor preview does on every compile): each element
 * is enhanced once.
 */
export function enhance(root: ParentNode, options: EnhanceOptions = {}): void {
  enhanceTabs(root);
  enhanceChart(root);
  enhanceDatagrid(root);
  enhanceExplore(root);
  enhanceAnnotate(root);
  enhanceQuiz(root);
  enhanceQuery(root, options.queryEndpoint ?? "");
  enhanceMermaid(root, options.loadMermaid);
  if (options.sandboxOrigin) {
    enhanceWidgets(root, { ...options.widgets, sandboxOrigin: options.sandboxOrigin });
    enhanceRun(root, options.sandboxOrigin);
  }
}

export { isDark, onThemeChange } from "./theme.js";
export { mountAsk, type AskOptions } from "./ask.js";
export { trackReading } from "./signals.js";
export { mountDeck } from "./present.js";
export type { WidgetOptions };
