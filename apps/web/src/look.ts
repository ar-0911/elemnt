import { fontsHref, resolveStyle, styleClasses, styleCss, type OrgTheme, type PageStyle } from "@elemnt/core";
import { Document, parseDocument } from "yaml";

/**
 * Page styles in the editor: the same tokens and classes the reader uses,
 * scoped to a preview container instead of the whole page.
 */
export function previewLook(org: OrgTheme | null | undefined, page: PageStyle | null | undefined, scope: string, fonts = true) {
  const resolved = resolveStyle(org, page);
  const href = fonts ? fontsHref(resolved) : undefined;
  if (href) loadFonts(href);
  return { css: styleCss(resolved, scope), classes: styleClasses(resolved), mode: resolved.mode, resolved };
}

const loaded = new Set<string>();
function loadFonts(href: string) {
  if (loaded.has(href)) return;
  loaded.add(href);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.elemntFonts = "";
  document.head.append(link);
}

function frontmatter(source: string) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  return { doc: m ? parseDocument(m[1]!) : new Document({}), rest: m ? source.slice(m[0].length) : source };
}

function assemble(doc: Document, rest: string) {
  const yaml = doc.toString().trimEnd();
  return `---\n${yaml === "{}" ? "" : yaml}\n---\n${rest.startsWith("\n") ? rest : `\n${rest}`}`;
}

/** Replaces the page's whole `style:` block, e.g. with the writer's saved style for a new page. */
export function withStyle(source: string, style: PageStyle): string {
  const { doc, rest } = frontmatter(source);
  doc.set("style", doc.createNode(style));
  return assemble(doc, rest);
}

/**
 * Sets `style.preset` in a page's frontmatter, keeping its other style keys
 * and everything else. `undefined` removes the style so the workspace theme applies.
 */
export function withPreset(source: string, preset: string | undefined): string {
  const { doc, rest } = frontmatter(source);
  const current = doc.get("style");
  if (preset === undefined) doc.delete("style");
  else if (current && typeof current === "object") doc.setIn(["style", "preset"], preset);
  else doc.set("style", preset);
  return assemble(doc, rest);
}
