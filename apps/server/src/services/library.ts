import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { libraryComponents } from "../db/schema.js";
import { newId } from "../lib/ids.js";
import type { AiClient } from "./ai.js";
import { HttpError } from "./errors.js";
import { scanWidget } from "./widgets.js";

/**
 * Make me a component: describe a widget, Claude writes its HTML, CSS and JS
 * plus the summary agents read, and the workspace keeps it in a library.
 * Library entries are inserted into pages as ordinary :::widget blocks, so
 * they go through the same sandbox, scan and kill switch as any widget.
 */

export interface ComponentDraft {
  name: string;
  slug: string;
  description: string;
  summary: string;
  html: string;
  css: string;
  js: string;
  height: number;
}

export const COMPONENT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Short human name, e.g. Latency budget calculator" },
    slug: { type: "string", description: "lowercase-with-dashes id" },
    description: { type: "string", description: "One sentence: when an author would use it" },
    summary: { type: "string", description: "What the widget shows, in words, for agents and readers without JavaScript (10 to 300 characters)" },
    html: { type: "string" },
    css: { type: "string" },
    js: { type: "string" },
    height: { type: "integer", description: "Initial height in pixels, 120 to 900" },
  },
  required: ["name", "slug", "description", "summary", "html", "css", "js", "height"],
  additionalProperties: false,
} as const;

export const COMPONENT_SYSTEM = `You build small interactive widgets for documentation pages in Elemnt.

A widget is HTML, CSS and JavaScript that runs in a sandboxed iframe on a separate origin:
- No network access at all: no fetch, XMLHttpRequest, WebSocket or external scripts, fonts or images. Inline everything; draw with SVG or canvas.
- No eval, new Function, WebAssembly, workers, forms, alerts or popups. Links go through elemnt.open(url).
- The page's colour tokens are available as CSS variables: --fg, --muted, --line, --surface, --accent, --soft. Use them so the widget follows light and dark mode. elemnt.onTheme(dark => …) is called when the theme changes.
- The frame resizes to fit its content; height is only the starting size.
- The body has 12px padding and a system font.

Write plain, readable, modern JavaScript (no frameworks, no build step, no minification) that runs as a module after the HTML. Keep it under 200 lines. Make it accessible: labels for inputs, keyboard support, enough contrast. The summary must state what the widget shows and its key facts in words, because that is all an agent gets.`;

const MAX = 100_000;

export function validateDraft(d: ComponentDraft) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(d.slug)) throw new HttpError(400, "slug: lowercase letters, digits and dashes.");
  if (d.summary.trim().length < 10) throw new HttpError(400, "summary must describe what the widget shows (10+ characters).");
  if (d.html.length + d.css.length + d.js.length > MAX) throw new HttpError(400, "The widget's code is over 100 KB.");
  return { ...d, height: Math.min(2000, Math.max(40, Math.round(d.height || 320))) };
}

export async function generateComponent(ai: AiClient, description: string): Promise<ComponentDraft & { findings: ReturnType<typeof scanWidget> }> {
  const draft = await ai.json<ComponentDraft>({ system: COMPONENT_SYSTEM, prompt: `Build this widget: ${description}`, schema: COMPONENT_SCHEMA, effort: "high" });
  const d = validateDraft({ ...draft, slug: draft.slug.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63) || "widget" });
  return { ...d, findings: scanWidget(d) };
}

/** The :::widget block for a library component. Fences grow when the code itself contains backticks. */
export function widgetSnippet(c: Pick<ComponentDraft, "summary" | "height" | "html" | "css" | "js" | "name">): string {
  const fence = (lang: string, code: string) => {
    if (!code.trim()) return "";
    const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
    const f = "`".repeat(longest + 1);
    return `${f}${lang}\n${code.replace(/\n$/, "")}\n${f}\n`;
  };
  const attr = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, "&quot;").replace(/\n/g, " ");
  return `:::widget{title="${attr(c.name)}" height=${c.height} summary="${attr(c.summary)}"}\n${fence("html", c.html)}${fence("css", c.css)}${fence("js", c.js)}:::\n`;
}

export async function listComponents(db: Db, workspaceId: string) {
  return db.select().from(libraryComponents).where(eq(libraryComponents.workspaceId, workspaceId)).orderBy(asc(libraryComponents.name));
}

export async function saveComponent(db: Db, input: { workspaceId: string; userId: string; draft: ComponentDraft }) {
  const d = validateDraft(input.draft);
  const errors = scanWidget(d).filter((f) => f.severity === "error");
  if (errors.length) throw new HttpError(422, errors.map((e) => e.message).join("; "));
  const values = { name: d.name.slice(0, 100), description: d.description.slice(0, 500), summary: d.summary.slice(0, 1000), html: d.html, css: d.css, js: d.js, height: d.height };
  const [row] = await db
    .insert(libraryComponents)
    .values({ id: newId("cmp"), workspaceId: input.workspaceId, slug: d.slug, createdBy: input.userId, ...values })
    .onConflictDoUpdate({ target: [libraryComponents.workspaceId, libraryComponents.slug], set: values })
    .returning();
  return row!;
}

export async function deleteComponent(db: Db, workspaceId: string, id: string) {
  await db.delete(libraryComponents).where(and(eq(libraryComponents.workspaceId, workspaceId), eq(libraryComponents.id, id)));
}

/** The workspace's components, appended to the authoring guide for agents. */
export function libraryGuide(items: { name: string; description: string; summary: string; height: number; html: string; css: string; js: string }[]): string {
  if (!items.length) return "";
  return `\n## Workspace components\n\nYour team's saved widgets. Paste the block as is; don't edit the code.\n\n${items
    .map((c) => `### ${c.name}\n\n${c.description}\n\n~~~~~md\n${widgetSnippet(c)}~~~~~`)
    .join("\n\n")}\n`;
}
