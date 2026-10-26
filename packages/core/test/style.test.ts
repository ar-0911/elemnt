import { describe, expect, it } from "vitest";
import { cleanCss, createElemnt, fontsHref, parsePageStyle, presets, resolveStyle, styleCss } from "../src/index.js";

const elemnt = createElemnt();

describe("page styles", () => {
  it("accepts a preset name or a style object in frontmatter", () => {
    expect(elemnt.compile("---\nstyle: aurora\n---\nHi").frontmatter.style).toEqual({ preset: "aurora" });
    const r = elemnt.compile('---\nstyle:\n  preset: editorial\n  accent: "#ff0066"\n  headingFont: Playfair Display\n---\nHi');
    expect(r.ok).toBe(true);
    expect(r.frontmatter.style).toEqual({ preset: "editorial", accent: "#ff0066", headingFont: "Playfair Display" });
  });

  it("refuses values that could carry markup or reach the network", () => {
    expect(parsePageStyle({ accent: "red;}</style><script>" }).problems[0]).toMatch(/hex/);
    expect(parsePageStyle({ headingFont: "x');@import url(evil)" }).problems[0]).toMatch(/font family/);
    expect(parsePageStyle({ glow: true }).problems.length).toBe(1);
    expect(elemnt.compile("---\nstyle: neon\n---\nHi").ok).toBe(false);
  });

  it("layers the page over the workspace theme over the preset", () => {
    const s = resolveStyle({ preset: "sunset", accent: "#123456" }, { width: "wide" });
    expect(s.name).toBe("sunset");
    expect(s.light.accent).toBe("#123456");
    expect(s.width).toBe("wide");
    expect(s.headingFont).toBe(presets.sunset.headingFont);
  });

  it("gives a page that picks its own preset that preset as designed", () => {
    const s = resolveStyle({ preset: "sunset", accent: "#123456" }, { preset: "terminal" });
    expect(s.light.accent).toBe(presets.terminal.light.accent);
  });

  it("keeps a locked workspace theme's colours and fonts, and says what it overrode", () => {
    const s = resolveStyle({ preset: "blueprint", lock: true }, { preset: "aurora", accent: "#ff0066", width: "narrow" });
    expect(s.name).toBe("blueprint");
    expect(s.light.accent).toBe(presets.blueprint.light.accent);
    expect(s.width).toBe("narrow");
    expect(s.overridden).toEqual(["preset", "accent"]);
  });

  it("emits light and dark tokens that follow the reader's toggle", () => {
    const css = styleCss(resolveStyle(null, { preset: "aurora" }));
    expect(css).toContain(":root[data-theme=dark]{");
    expect(css).toContain(":root:not([data-theme=light])");
    expect(css).toContain('--font-head:"Space Grotesk"');
    expect(styleCss(resolveStyle(), ".preview")).toContain(":root[data-theme=dark] .preview");
  });

  it("loads only non-system fonts", () => {
    expect(fontsHref(resolveStyle())).toBeUndefined();
    expect(fontsHref(resolveStyle(null, { preset: "aurora" }))).toBe(
      "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap",
    );
  });

  it("strips imports and remote urls from admin CSS", () => {
    const css = cleanCss('@import "https://evil/x.css"; .a{background:url(https://evil/p.gif)} .b{background:url(data:image/png;base64,AA)}</style>');
    expect(css).not.toContain("evil");
    expect(css).toContain("url(data:image/png");
    expect(css).not.toContain("</style");
  });
});

describe("layout components", () => {
  it("renders a hero with buttons and projects it to a plain heading", () => {
    const r = elemnt.compile(':::hero[Ship it]{eyebrow="Guide"}\nLede.\n\n[Start](#a) [Docs](/s/x)\n:::');
    expect(r.ok).toBe(true);
    expect(r.html).toContain('<p class="elemnt-hero-actions"><a href="#a">Start</a>');
    expect(r.html).toContain('<svg class="elemnt-art elemnt-art-orbit" aria-hidden="true"');
    expect(r.markdown).toBe("_Guide_\n\n# Ship it\n\nLede.\n\n[Start](#a) [Docs](/s/x)\n");
  });

  it("keeps cards, stats and timelines readable as Markdown", () => {
    const r = elemnt.compile(
      '## Plans\n\n::::cards{cols=2}\n:::card[Free]{icon="🌱"}\nFor tinkering.\n:::\n:::card[Team]{href="/s/pricing"}\nFor teams.\n:::\n::::\n\n:::stats\n::stat[99.9%]{label="Uptime"}\n:::\n\n::::timeline\n:::event[Launch]{date="2026-03"}\nGA.\n:::\n::::',
    );
    expect(r.ok).toBe(true);
    expect(r.markdown).toBe("## Plans\n\n### Free\n\nFor tinkering.\n\n### [Team](/s/pricing)\n\nFor teams.\n\n- **99.9%** Uptime\n\n### 2026-03: Launch\n\nGA.\n");
  });

  it("rejects stray cards and javascript: links", () => {
    expect(elemnt.compile(":::card[x]\ny\n:::").ok).toBe(false);
    expect(elemnt.compile('::::cards\n:::card[x]{href="javascript:alert(1)"}\ny\n:::\n::::').ok).toBe(false);
  });
});

describe("graphic", () => {
  const graphic = (svg: string) => elemnt.compile(`:::graphic{alt="A test graphic"}\n\`\`\`svg\n${svg}\n\`\`\`\n:::`);

  it("draws SVG inline, with ids that can't collide and references that still work", () => {
    const r = graphic('<svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><rect fill="url(#g)" width="10" height="10"><animate attributeName="opacity" values="1;0;1" dur="2s" repeatCount="indefinite"/></rect></svg>');
    expect(r.ok).toBe(true);
    const id = r.html.match(/id="(user-content-g[0-9a-f]{6}-g)"/)?.[1];
    expect(id).toBeTruthy();
    expect(r.html).toContain(`fill="url(#${id})"`);
    expect(r.html).toContain('<animate attributeName="opacity"');
    expect(r.html).toContain('role="img" aria-label="A test graphic"');
    expect(r.markdown).toBe("_Graphic: A test graphic_\n");
  });

  it("removes script, handlers, foreignObject, style, external refs and href animation", () => {
    const r = graphic(
      '<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><foreignObject><iframe src="https://evil"></iframe></foreignObject><style>*{x:url(https://evil)}</style><rect style="fill:red" fill="url(https://evil/a.svg#x)"/><use href="https://evil/x.svg#y"/><a href="javascript:alert(3)"><text>x</text></a><use href="#ok"><set attributeName="href" to="javascript:alert(4)"/></use></svg>',
    );
    expect(r.ok).toBe(true);
    expect(r.diagnostics[0]?.severity).toBe("warning");
    for (const bad of ["alert", "evil", "foreignObject", "<style", "<a", "onload", "javascript"]) expect(r.html).not.toContain(bad);
  });

  it("requires exactly one svg and an alt", () => {
    expect(graphic("<p>hi</p>").ok).toBe(false);
    expect(elemnt.compile(":::graphic\n```svg\n<svg></svg>\n```\n:::").ok).toBe(false);
  });
});
