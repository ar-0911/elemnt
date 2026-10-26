import { BACKGROUNDS, createElemnt, HEADINGS, presets, type OrgTheme, type PageStyle } from "@elemnt/core";
import { useMemo, useState } from "react";
import { previewLook } from "./look";

const FONTS = ["Inter", "Space Grotesk", "Outfit", "Manrope", "DM Sans", "IBM Plex Sans", "Fraunces", "Playfair Display", "Source Serif 4", "Literata", "Newsreader", "JetBrains Mono", "Fira Code", "IBM Plex Mono"];

const SAMPLE = createElemnt().compile(`:::hero[Your docs, in your style]{eyebrow="Preview" art=orbit}
A page that pulls the reader in and still answers the question.

[Get started](#) [Reference](#)
:::

:::stats
::stat[99.9%]{label="Uptime"}
::stat[118 ms]{label="P99 latency"}
:::

## Why it matters :badge[New]

::::cards{cols=2}
:::card[Fast]{icon="⚡"}
Readers find what they need in seconds.
:::
:::card[Clear]{icon="🧭"}
Every flourish carries information.
:::
::::

:::callout{type=tip}
Code looks like \`this\`.
:::
`).html;

type Value = OrgTheme & PageStyle;

/**
 * Picks a style: preset, colours, fonts and layout, with a live sample. Used
 * for the workspace theme (admins) and for each person's own style.
 */
export function StyleForm({ value, onChange, org, base }: { value: Value; onChange(v: Value): void; org?: boolean; base?: OrgTheme | null }) {
  const set = <K extends keyof Value>(k: K, v: Value[K] | "" | undefined) => {
    const next = { ...value };
    if (v === "" || v === undefined) delete next[k];
    else next[k] = v as Value[K];
    onChange(next);
  };
  const [id] = useState(() => `style-sample-${Math.random().toString(36).slice(2, 8)}`);
  const look = useMemo(() => (org ? previewLook({ ...value, css: "" }, null, `#${id}`) : previewLook(base, value, `#${id}`)), [JSON.stringify(value), base, org, id]);
  const preset = presets[value.preset ?? look.resolved.name];

  return (
    <>
      <div className="swatches" role="group" aria-label="Preset">
        {Object.values(presets).map((p) => (
          <button key={p.name} type="button" className="swatch" aria-pressed={look.resolved.name === p.name} title={p.description} onClick={() => set("preset", p.name)}>
            <i style={{ background: `linear-gradient(100deg, ${p.dark.bg} 0 35%, ${p.light.accent} 35% 70%, ${p.light.accent2} 70%)` }} />
            {p.label}
          </button>
        ))}
      </div>
      <p className="hint">{preset.description}</p>
      <div className="style-form">
        <label>
          Accent
          <span className="row">
            <input type="color" value={value.accent ?? preset.light.accent} onChange={(e) => set("accent", e.target.value)} aria-label="Accent colour" />
            {value.accent && <button type="button" className="link" onClick={() => set("accent", undefined)}>reset</button>}
          </span>
        </label>
        <label>
          Second colour
          <span className="row">
            <input type="color" value={value.accent2 ?? preset.light.accent2} onChange={(e) => set("accent2", e.target.value)} aria-label="Second colour" />
            {value.accent2 && <button type="button" className="link" onClick={() => set("accent2", undefined)}>reset</button>}
          </span>
        </label>
        {(["headingFont", "bodyFont", "monoFont"] as const).map((k) => (
          <label key={k}>
            {{ headingFont: "Heading font", bodyFont: "Body font", monoFont: "Code font" }[k]}
            <input list="elemnt-fonts" value={value[k] ?? ""} placeholder={preset[k]} onChange={(e) => set(k, e.target.value)} />
          </label>
        ))}
        <datalist id="elemnt-fonts">
          {FONTS.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <label>
          Background
          <select value={value.background ?? ""} onChange={(e) => set("background", e.target.value as Value["background"])}>
            <option value="">Preset ({preset.background})</option>
            {BACKGROUNDS.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <label>
          Headings
          <select value={value.headings ?? ""} onChange={(e) => set("headings", e.target.value as Value["headings"])}>
            <option value="">Preset ({preset.headings})</option>
            {HEADINGS.map((h) => (
              <option key={h}>{h}</option>
            ))}
          </select>
        </label>
        <label>
          Width
          <select value={value.width ?? ""} onChange={(e) => set("width", e.target.value as Value["width"])}>
            <option value="">Preset ({preset.width})</option>
            <option>narrow</option>
            <option>normal</option>
            <option>wide</option>
          </select>
        </label>
        <label>
          Readers first see
          <select value={value.mode ?? ""} onChange={(e) => set("mode", e.target.value as Value["mode"])}>
            <option value="">Preset ({preset.mode})</option>
            <option value="auto">their system setting</option>
            <option value="light">light</option>
            <option value="dark">dark</option>
          </select>
        </label>
        <label>
          Corner radius
          <input type="number" min={0} max={28} value={value.radius ?? ""} placeholder={String(preset.radius)} onChange={(e) => set("radius", e.target.value === "" ? undefined : Number(e.target.value))} />
        </label>
        {org && (
          <>
            <label className="wide">
              Notes for writers and Claude (voice, tone, rules)
              <textarea value={value.notes ?? ""} maxLength={4000} placeholder="Plain words, second person. Every page opens with a hero. No exclamation marks." onChange={(e) => set("notes", e.target.value)} />
            </label>
            <label className="wide">
              Extra CSS (no @import or remote url())
              <textarea value={value.css ?? ""} maxLength={20000} placeholder=".elemnt-page h2 { text-transform: uppercase; }" onChange={(e) => set("css", e.target.value)} />
            </label>
          </>
        )}
      </div>
      <div id={id} className={`preview style-sample ${look.classes.join(" ")}`} {...(look.mode !== "auto" ? { "data-theme": look.mode } : {})}>
        <style>{look.css}</style>
        {/* Safe: compiled and sanitized by @elemnt/core from the fixed sample above. */}
        <article className="elemnt-page" dangerouslySetInnerHTML={{ __html: SAMPLE }} />
      </div>
    </>
  );
}
