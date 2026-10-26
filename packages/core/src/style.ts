import { z } from "zod";

/**
 * Page styles and workspace themes. A style is plain data (frontmatter
 * `style:` on a page, or a workspace theme set by an admin), so agents can
 * read and write it over MCP and it can never carry markup or script. It
 * compiles to CSS custom properties and a font stylesheet link.
 */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "use a 6-digit hex colour like #7c3aed");
/** Google Fonts family names: letters, digits and spaces. */
const font = z.string().regex(/^[A-Za-z0-9 ]{1,40}$/, "use a font family name like Inter or Space Grotesk");

export const PRESET_NAMES = ["clean", "aurora", "editorial", "terminal", "blueprint", "sunset", "paper"] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

export const BACKGROUNDS = ["plain", "aurora", "grid", "dots", "mesh"] as const;
export const HEADINGS = ["plain", "gradient", "underline"] as const;

export const pageStyleSchema = z
  .object({
    preset: z.enum(PRESET_NAMES).optional(),
    accent: hex.optional(),
    /** Second colour for gradients. */
    accent2: hex.optional(),
    headingFont: font.optional(),
    bodyFont: font.optional(),
    monoFont: font.optional(),
    background: z.enum(BACKGROUNDS).optional(),
    headings: z.enum(HEADINGS).optional(),
    radius: z.coerce.number().int().min(0).max(28).optional(),
    width: z.enum(["narrow", "normal", "wide"]).optional(),
    /** The look a reader gets before they pick light or dark themselves. */
    mode: z.enum(["auto", "light", "dark"]).optional(),
  })
  .strict();
export type PageStyle = z.infer<typeof pageStyleSchema>;

export const orgThemeSchema = pageStyleSchema
  .extend({
    /** Locked: pages keep the workspace colours and fonts; they can still pick width and background. */
    lock: z.boolean().optional(),
    /** Extra CSS from an admin, applied after everything else. No @import and no remote url(). */
    css: z.string().max(20_000).optional(),
    /** Plain-language notes for writers and Claude: voice, tone, what to avoid. */
    notes: z.string().max(4000).optional(),
  })
  .strict();
export type OrgTheme = z.infer<typeof orgThemeSchema>;

interface Palette {
  bg: string;
  fg: string;
  muted: string;
  line: string;
  surface: string;
  accent: string;
  accent2: string;
  code: string;
}

export interface Preset {
  name: PresetName;
  label: string;
  /** One line for the style picker and for Claude to offer the user. */
  description: string;
  light: Palette;
  dark: Palette;
  headingFont: string;
  bodyFont: string;
  monoFont: string;
  background: (typeof BACKGROUNDS)[number];
  headings: (typeof HEADINGS)[number];
  radius: number;
  width: "narrow" | "normal" | "wide";
  mode: "auto" | "light" | "dark";
}

const SYSTEM = "system-ui";
const MONO = "ui-monospace";

export const presets: Record<PresetName, Preset> = {
  clean: {
    name: "clean",
    label: "Clean",
    description: "Quiet and familiar: system fonts, blue accent, no background art. Good for reference docs.",
    light: { bg: "#f7f8fa", fg: "#161a22", muted: "#5b6374", line: "#dde1e8", surface: "#ffffff", accent: "#2949c7", accent2: "#7b4fd6", code: "#eef0f4" },
    dark: { bg: "#0f1218", fg: "#e4e7ee", muted: "#9aa2b4", line: "#2a303c", surface: "#161a22", accent: "#8aa2ff", accent2: "#c09bff", code: "#1c212b" },
    headingFont: SYSTEM,
    bodyFont: SYSTEM,
    monoFont: MONO,
    background: "plain",
    headings: "plain",
    radius: 8,
    width: "normal",
    mode: "auto",
  },
  aurora: {
    name: "aurora",
    label: "Aurora",
    description: "Dark-first and vivid: violet-to-cyan gradients, glowing aurora background, Space Grotesk headings. For launches and explainers.",
    light: { bg: "#f6f5ff", fg: "#15132b", muted: "#5d5a7a", line: "#dedbf3", surface: "#ffffff", accent: "#6d3df5", accent2: "#0ea5c6", code: "#efedfb" },
    dark: { bg: "#0a0915", fg: "#ecebff", muted: "#a6a3c8", line: "#2a2747", surface: "#14122a", accent: "#a78bfa", accent2: "#22d3ee", code: "#1b1836" },
    headingFont: "Space Grotesk",
    bodyFont: "Inter",
    monoFont: "JetBrains Mono",
    background: "aurora",
    headings: "gradient",
    radius: 14,
    width: "wide",
    mode: "dark",
  },
  editorial: {
    name: "editorial",
    label: "Editorial",
    description: "A long-read magazine: Fraunces serif headings, Source Serif body, warm paper, narrow column. For stories, essays and postmortems.",
    light: { bg: "#fbf8f3", fg: "#221d16", muted: "#6d6355", line: "#e7dfd2", surface: "#fffdf9", accent: "#b4441f", accent2: "#7a5c2e", code: "#f2ece2" },
    dark: { bg: "#17140f", fg: "#efe8dc", muted: "#b0a593", line: "#332d24", surface: "#1f1b15", accent: "#f08a5d", accent2: "#d6b27a", code: "#26211a" },
    headingFont: "Fraunces",
    bodyFont: "Source Serif 4",
    monoFont: "IBM Plex Mono",
    background: "plain",
    headings: "underline",
    radius: 4,
    width: "narrow",
    mode: "auto",
  },
  terminal: {
    name: "terminal",
    label: "Terminal",
    description: "Green phosphor on near-black, monospace everywhere, faint grid. For CLIs, runbooks and infra.",
    light: { bg: "#f3f7f2", fg: "#0f1d12", muted: "#4a6150", line: "#cfdccf", surface: "#fbfdfb", accent: "#127a32", accent2: "#0b6f6a", code: "#e6efe6" },
    dark: { bg: "#070b08", fg: "#c8f5d2", muted: "#7fa889", line: "#1b2a1f", surface: "#0c140e", accent: "#39ff88", accent2: "#2ee6d6", code: "#0f1a12" },
    headingFont: "JetBrains Mono",
    bodyFont: "JetBrains Mono",
    monoFont: "JetBrains Mono",
    background: "grid",
    headings: "plain",
    radius: 2,
    width: "normal",
    mode: "dark",
  },
  blueprint: {
    name: "blueprint",
    label: "Blueprint",
    description: "Engineering drawing: deep blue, white lines, IBM Plex, blueprint grid. For architecture and system design.",
    light: { bg: "#f2f6fc", fg: "#0d1b33", muted: "#4b5d7c", line: "#cbd8ec", surface: "#ffffff", accent: "#1d5fd1", accent2: "#0b8bb3", code: "#e7eef9" },
    dark: { bg: "#0b1d3a", fg: "#e6efff", muted: "#9fb4d8", line: "#21406f", surface: "#0f2549", accent: "#7cc4ff", accent2: "#a5f3fc", code: "#13305c" },
    headingFont: "IBM Plex Sans",
    bodyFont: "IBM Plex Sans",
    monoFont: "IBM Plex Mono",
    background: "grid",
    headings: "plain",
    radius: 6,
    width: "wide",
    mode: "auto",
  },
  sunset: {
    name: "sunset",
    label: "Sunset",
    description: "Warm and friendly: coral-to-amber gradients, soft mesh background, rounded Outfit type. For onboarding and product guides.",
    light: { bg: "#fff8f4", fg: "#2a1610", muted: "#7a5a50", line: "#f2dcd2", surface: "#ffffff", accent: "#e8513b", accent2: "#f59e0b", code: "#fbede6" },
    dark: { bg: "#1a0f0d", fg: "#fbe9e2", muted: "#c7a093", line: "#3a231d", surface: "#241512", accent: "#ff7a5c", accent2: "#fbbf24", code: "#2e1b17" },
    headingFont: "Outfit",
    bodyFont: "Outfit",
    monoFont: "Fira Code",
    background: "mesh",
    headings: "gradient",
    radius: 18,
    width: "normal",
    mode: "auto",
  },
  paper: {
    name: "paper",
    label: "Paper",
    description: "Notebook calm: dotted paper, ink-blue accent, Literata body. For tutorials and learning paths.",
    light: { bg: "#fdfdfb", fg: "#1d2330", muted: "#5f6676", line: "#e3e5ea", surface: "#ffffff", accent: "#2c5aa0", accent2: "#c2410c", code: "#f1f2f5" },
    dark: { bg: "#13161c", fg: "#e3e6ec", muted: "#9aa1b0", line: "#2a2f39", surface: "#1a1e26", accent: "#8db4f2", accent2: "#fb923c", code: "#20252e" },
    headingFont: "Literata",
    bodyFont: "Literata",
    monoFont: "JetBrains Mono",
    background: "dots",
    headings: "plain",
    radius: 6,
    width: "narrow",
    mode: "auto",
  },
};

export type ResolvedStyle = Omit<Preset, "label" | "description"> & {
  /** Admin CSS, already cleaned. */
  css: string;
  /** Page settings the workspace theme overrode because it is locked. */
  overridden: string[];
};

const LOCKED: (keyof PageStyle)[] = ["preset", "accent", "accent2", "headingFont", "bodyFont", "monoFont", "headings", "radius", "mode"];

type Base = Omit<Preset, "label" | "description">;

function apply(p: Base, s: PageStyle): Base {
  return {
    ...p,
    // A custom accent picked for light pages is usually too dark on a dark page; lift it there.
    light: { ...p.light, ...(s.accent ? { accent: s.accent } : {}), ...(s.accent2 ? { accent2: s.accent2 } : {}) },
    dark: { ...p.dark, ...(s.accent ? { accent: lift(s.accent) } : {}), ...(s.accent2 ? { accent2: lift(s.accent2) } : {}) },
    headingFont: s.headingFont ?? p.headingFont,
    bodyFont: s.bodyFont ?? p.bodyFont,
    monoFont: s.monoFont ?? p.monoFont,
    background: s.background ?? p.background,
    headings: s.headings ?? p.headings,
    radius: s.radius ?? p.radius,
    width: s.width ?? p.width,
    mode: s.mode ?? p.mode,
  };
}

/**
 * The look a page gets: its own `style:` on top of the workspace theme on top
 * of a preset. A locked workspace theme wins over the page for colours and
 * fonts. A page that picks a different preset from the workspace's gets that
 * preset as designed, without the workspace's colour and font tweaks.
 */
export function resolveStyle(org?: OrgTheme | null, page?: PageStyle | null): ResolvedStyle {
  const o = org ?? {};
  const pg = page ?? {};
  const overridden = o.lock ? LOCKED.filter((k) => pg[k] !== undefined) : [];
  const own: PageStyle = o.lock ? { width: pg.width, background: pg.background } : pg;
  const name = (o.lock ? o.preset : (pg.preset ?? o.preset)) ?? "clean";
  const orgApplies = o.lock || !pg.preset || pg.preset === o.preset;
  const { label: _l, description: _d, ...preset } = presets[name];
  const merged = apply(orgApplies ? apply(preset, o) : preset, own);
  return { ...merged, name, css: o.css ? cleanCss(o.css) : "", overridden };
}

/** Lightens a hex colour for dark backgrounds (mixes 35% towards white). */
function lift(hexColour: string): string {
  const n = parseInt(hexColour.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.35);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
  return `#${((1 << 24) | (r! << 16) | (g! << 8) | b!).toString(16).slice(1)}`;
}

const SYSTEM_FONTS = new Set([SYSTEM, MONO, "Georgia", "serif", "sans-serif", "monospace", "Menlo", "Arial", "Helvetica"]);

function stack(name: string, kind: "sans" | "serif" | "mono"): string {
  const fallback = {
    sans: `system-ui,-apple-system,"Segoe UI",sans-serif`,
    serif: `Georgia,"Times New Roman",serif`,
    mono: `ui-monospace,Menlo,Consolas,monospace`,
  }[kind];
  return name === SYSTEM || name === MONO ? fallback : `"${name}",${fallback}`;
}

const SERIFS = /serif|fraunces|literata|lora|merriweather|playfair|garamond|georgia|crimson|newsreader/i;
const kindOf = (name: string): "sans" | "serif" => (SERIFS.test(name) && !/sans/i.test(name) ? "serif" : "sans");

/** Google Fonts stylesheet for the style's fonts, or undefined when it uses system fonts only. */
export function fontsHref(style: Pick<ResolvedStyle, "headingFont" | "bodyFont" | "monoFont">): string | undefined {
  const families = [...new Set([style.headingFont, style.bodyFont, style.monoFont])].filter((f) => !SYSTEM_FONTS.has(f));
  if (!families.length) return undefined;
  const q = families.map((f) => `family=${f.replace(/ /g, "+")}:wght@400;500;600;700`).join("&");
  return `https://fonts.googleapis.com/css2?${q}&display=swap`;
}

/**
 * Admin CSS without the parts that reach the network or run code. It can still
 * restyle the page, which is what it is for; only workspace admins can set it.
 */
export function cleanCss(css: string): string {
  return css
    .replace(/<\/?style/gi, "")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*(['"]?)(?!data:|#)[^)]*\)/gi, "none")
    .replace(/expression\s*\(/gi, "(")
    .replace(/(-moz-binding|behavior)\s*:/gi, "x-blocked:");
}

const vars = (p: Palette) =>
  `--bg:${p.bg};--fg:${p.fg};--muted:${p.muted};--line:${p.line};--surface:${p.surface};--accent:${p.accent};--accent-2:${p.accent2};--code:${p.code};` +
  `--soft:color-mix(in srgb,${p.accent} 13%,${p.bg})`;

const WIDTHS = { narrow: "680px", normal: "760px", wide: "1040px" };

/**
 * CSS for a resolved style. `scope` is where the tokens apply: `:root` on the
 * reader, a preview container in the editor.
 */
export function styleCss(style: ResolvedStyle, scope = ":root"): string {
  const root = scope === ":root";
  const dark = root ? ":root[data-theme=dark]" : `:root[data-theme=dark] ${scope},${scope}[data-theme=dark]`;
  const autoDark = root ? ":root:not([data-theme=light])" : `:root:not([data-theme=light]) ${scope}:not([data-theme=light])`;
  const fonts =
    `--font-head:${stack(style.headingFont, style.headingFont === style.monoFont ? "mono" : kindOf(style.headingFont))};` +
    `--font-body:${stack(style.bodyFont, style.bodyFont === style.monoFont ? "mono" : kindOf(style.bodyFont))};` +
    `--font-mono:${stack(style.monoFont, "mono")};--radius:${style.radius}px;--page-width:${WIDTHS[style.width]}`;
  return [
    `${scope}{${vars(style.light)};${fonts};color-scheme:light}`,
    `${dark}{${vars(style.dark)};color-scheme:dark}`,
    `@media (prefers-color-scheme:dark){${autoDark}{${vars(style.dark)};color-scheme:dark}}`,
    style.css,
  ].join("\n");
}

/** Class names for the page wrapper that switch on background art and heading treatment. */
export function styleClasses(style: ResolvedStyle): string[] {
  return ["elemnt-styled", `elemnt-bg-${style.background}`, `elemnt-headings-${style.headings}`, `elemnt-preset-${style.name}`];
}

/** Validates a `style:` frontmatter value; problems come back as messages. */
export function parsePageStyle(value: unknown): { style?: PageStyle; problems: string[] } {
  if (value === undefined || value === null) return { problems: [] };
  if (typeof value === "string") {
    return (PRESET_NAMES as readonly string[]).includes(value)
      ? { style: { preset: value as PresetName }, problems: [] }
      : { problems: [`style: unknown preset "${value}"; pick one of ${PRESET_NAMES.join(", ")}`] };
  }
  const r = pageStyleSchema.safeParse(value);
  if (r.success) return { style: r.data, problems: [] };
  return { problems: r.error.issues.map((i) => `style${i.path.length ? "." + i.path.join(".") : ""}: ${i.message}`) };
}
