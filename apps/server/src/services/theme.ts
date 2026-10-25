import { fontsHref, orgThemeSchema, pageStyleSchema, parsePageStyle, presets, resolveStyle, styleClasses, styleCss, type OrgTheme, type PageStyle, type ResolvedStyle } from "@elemnt/core";
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { revisions, users, workspaces } from "../db/schema.js";
import { HttpError } from "./errors.js";

/**
 * Organization themes, personal styles, and what the reader needs to draw a
 * page in its style. A page's own `style:` is stored on each revision.
 */

export async function getOrgTheme(db: Db, workspaceId: string): Promise<OrgTheme | null> {
  const [ws] = await db.select({ theme: workspaces.theme }).from(workspaces).where(eq(workspaces.id, workspaceId));
  return ws?.theme ?? null;
}

/** Validates and saves the workspace theme; `null` removes it. */
export async function setOrgTheme(db: Db, workspaceId: string, input: unknown): Promise<OrgTheme | null> {
  const theme = input === null ? null : parse(orgThemeSchema, input, "theme");
  await db.update(workspaces).set({ theme: theme && Object.keys(theme).length ? theme : null }).where(eq(workspaces.id, workspaceId));
  return theme;
}

export async function getUserStyle(db: Db, userId: string): Promise<PageStyle | null> {
  const [u] = await db.select({ style: users.style }).from(users).where(eq(users.id, userId));
  return u?.style ?? null;
}

export async function setUserStyle(db: Db, userId: string, input: unknown): Promise<PageStyle | null> {
  const style = input === null ? null : parse(pageStyleSchema, input, "style");
  await db.update(users).set({ style: style && Object.keys(style).length ? style : null }).where(eq(users.id, userId));
  return style;
}

export async function revisionStyle(db: Db, revisionId: string): Promise<PageStyle | null> {
  const [r] = await db.select({ style: revisions.style }).from(revisions).where(eq(revisions.id, revisionId));
  return r?.style ?? null;
}

function parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, input: unknown, what: string): T {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  throw new HttpError(400, r.error.issues.map((i) => `${what}${i.path.length ? "." + i.path.map(String).join(".") : ""}: ${i.message}`).join("; "));
}

/** Everything the reader shell and present mode need to draw a page in its style. */
export interface PageLook {
  css: string;
  classes: string[];
  fontsHref?: string;
  mode: ResolvedStyle["mode"];
  resolved: ResolvedStyle;
}

export function pageLook(org: OrgTheme | null, page: PageStyle | null, options: { fonts: boolean }): PageLook {
  const resolved = resolveStyle(org, page);
  const href = options.fonts ? fontsHref(resolved) : undefined;
  return { css: styleCss(resolved), classes: styleClasses(resolved), ...(href ? { fontsHref: href } : {}), mode: resolved.mode, resolved };
}

const yaml = (s: PageStyle) =>
  ["style:", ...Object.entries(s).map(([k, v]) => `  ${k}: ${typeof v === "string" && /^#/.test(v) ? `"${v}"` : v}`)].join("\n");

/**
 * The style guide Claude reads over MCP (`get_style_guide`) before it writes a
 * page: the workspace theme if there is one, the writer's saved style, the
 * presets, and how to write docs that pull a reader in and stay clear.
 */
export function styleGuide(input: { org: OrgTheme | null; mine: PageStyle | null; layoutDocs: string; library: string }): string {
  const { org, mine } = input;
  const presetList = Object.values(presets)
    .map((p) => `- **${p.name}**: ${p.description} Fonts: ${p.headingFont} / ${p.bodyFont}.`)
    .join("\n");

  const theme = org
    ? [
        "## Your organization's theme",
        "",
        org.lock
          ? "The workspace theme is **locked**: every page uses its colours and fonts, whatever the page asks for. Don't ask the user about colours or fonts; you can still choose `width` and `background` per page."
          : "This workspace has a theme. Follow it: leave colours and fonts alone unless the user asks for something different for this page.",
        "",
        "```yaml",
        yaml(Object.fromEntries(Object.entries(org).filter(([k]) => !["lock", "css", "notes"].includes(k))) as PageStyle),
        "```",
        ...(org.notes ? ["", "Notes from the workspace admins (voice, tone, rules):", "", org.notes] : []),
        ...(org.css ? ["", "The workspace also adds its own CSS; you don't need to repeat it."] : []),
      ].join("\n")
    : "## Your organization's theme\n\nThis workspace has no theme, so each page picks its own style.";

  const personal = mine
    ? `## The user's saved style\n\nThey saved this as their usual style. Use it unless they ask for something else:\n\n\`\`\`yaml\n${yaml(mine)}\n\`\`\``
    : "## The user's saved style\n\nNone saved yet. When they pick a style, offer to save it with `save_my_style` so you don't have to ask next time.";

  const ask = org?.lock
    ? "1. **Skip the style questions.** The organization theme decides colours and fonts. Ask only what the page is for and who reads it."
    : `1. **Ask before you write**, in one short message, unless the user already said or has a saved style:
   - Who reads it and what they should be able to do afterwards.
   - The feel they want. Offer the presets below by name with a few words each, or "something custom".
   - Fonts, if they care: a heading font and a body font from Google Fonts (e.g. "Space Grotesk + Inter", "Fraunces + Source Serif 4").
   - An accent colour, if they have a brand colour.
   ${org ? "   - Mention that the workspace theme applies unless they want this page to differ." : ""}
   If they say "you choose", pick the preset that fits the subject and say which one you used.`;

  return `# Elemnt style guide

Read this before you write or restyle a page. Elemnt pages are meant to be **read for pleasure as well as reference**: they should look like a designed web page, pull the reader in from the first screen, and still be exact and easy to scan. Agents get a plain Markdown version of the same page automatically, so spend your effort on the people.

${theme}

${personal}

## How to work

${ask}
2. **Plan the page like a landing page with a manual inside.** First screen: what this is and why it matters. Then the path through it. Then the reference detail.
3. **Write the style into the frontmatter** (see below), then the page.
4. **Check it** with \`validate\` before \`create_page\` or \`suggest_edit\`. Fix every error; warnings about removed SVG parts mean something won't show.
5. **Tell the user** which style you used and how to change it (edit \`style:\` in the frontmatter, or the workspace theme in Settings).

## Setting the style

Put a \`style:\` block in the frontmatter. Every key is optional; a preset name alone also works (\`style: aurora\`).

\`\`\`yaml
---
title: Payments, explained
summary: How money moves, what can fail, and the one setting you must not touch.
style:
  preset: aurora          # ${Object.keys(presets).join(" | ")}
  accent: "#7c3aed"       # 6-digit hex
  accent2: "#06b6d4"      # second colour for gradients
  headingFont: Space Grotesk   # any Google Fonts family
  bodyFont: Inter
  monoFont: JetBrains Mono
  background: aurora      # plain | aurora | grid | dots | mesh
  headings: gradient      # plain | gradient | underline
  radius: 14              # corner radius in px, 0–28
  width: wide             # narrow | normal | wide
  mode: dark              # auto | light | dark: what readers see before they toggle
---
\`\`\`

Readers can always switch light and dark with the toggle; every preset has both. Use \`var(--accent)\`, \`var(--accent-2)\`, \`var(--fg)\`, \`var(--muted)\`, \`var(--surface)\` and \`currentColor\` in graphics and widgets so they follow the style in both modes.

### Presets

${presetList}

## Make it extravagant, keep it understandable

- **Open with a hero.** \`:::hero[Title]{eyebrow=… art=orbit|waves|grid}\` with a one- or two-sentence promise and a row of links that become buttons. It replaces the \`# title\`.
- **Show before you tell.** Put a \`:::graphic\` (inline SVG, animated if it helps), a \`:::diagram\` (Mermaid) or a \`:::chart\` near the top of every major section. A picture of the flow beats a paragraph about it.
- **Use big numbers** (\`:::stats\`) for the three facts a reader should remember.
- **Cards for choices and next steps** (\`::::cards\`), a **timeline** for anything that happens in order (\`::::timeline\`), **bands** (\`:::band{tone=glow}\`) to mark the turn from story to reference.
- **Let readers poke it.** \`:::explore\` with \`:var\` sliders for any number that depends on another, \`:::quiz\` after a tricky idea, \`\`\`js run\`\`\` for code they can try, \`:::widget\` for anything bespoke. A widget with only HTML and CSS can hold any custom layout you can build and loads without a click.
- **Rhythm.** Alternate dense and airy: a paragraph, a visual, a short list, a callout. No wall of text longer than about 120 words. Headings are promises ("Retries never double-charge"), not labels ("Retries").
- **Voice.** Second person, present tense, concrete. Lead with the outcome. Cut hedges. One idea per paragraph.
- **Understandable beats impressive.** Every flourish has to carry information. If a graphic doesn't explain something, cut it. Define jargon with \`:term\`. Every component must make sense in the Markdown version too: give graphics a real \`alt\`, widgets a real \`summary\`.
- **Accessibility.** Don't put text in graphics that isn't also in the page. Keep contrast: don't put muted text on accent bands. Motion is decoration only; it stops for readers who ask for reduced motion.

## Layout components

${input.layoutDocs}
${input.library ? `${input.library}\nThese are your organization's own components: prefer them over writing a new widget.\n` : ""}

The full component catalog is in \`get_authoring_guide\`.
`;
}

/** Normalizes a value from MCP or the API into a page style, or throws a 400 with the problems. */
export function toPageStyle(input: unknown): PageStyle {
  const { style, problems } = parsePageStyle(input);
  if (problems.length || !style) throw new HttpError(400, problems.join("; ") || "style is empty.");
  return style;
}
