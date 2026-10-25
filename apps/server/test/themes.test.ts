import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setup } from "./helpers.js";

let t: Awaited<ReturnType<typeof setup>>;
let id = 0;

const STYLED = `---
title: Launch
style:
  preset: aurora
  accent: "#ff0066"
---
:::hero[Launch day]{eyebrow="Guide"}
Everything in one place.

[Start](#steps)
:::

## Steps
Go.
`;

async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await t.call("/mcp", {
    method: "POST",
    token,
    headers: { Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" },
    json: { jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } },
  });
  const result = ((await res.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
  return { text: result.content[0]!.text, isError: Boolean(result.isError) };
}

beforeEach(async () => {
  t = await setup();
  await t.call("/api/spaces", { method: "POST", token: t.ownerToken, json: { slug: "pub", name: "Pub", visibility: "public" } });
  expect((await t.call("/api/spaces/pub/pages", { method: "POST", token: t.ownerToken, json: { path: "launch", source: STYLED } })).status).toBe(201);
});
afterEach(() => t.close());

describe("page styles in the reader", () => {
  it("draws the page in its style, with fonts, art, a theme toggle and the page's default mode", async () => {
    const res = await t.call("/s/pub/launch");
    const html = await res.text();
    expect(html).toContain('<body class="elemnt-styled elemnt-bg-aurora elemnt-headings-gradient elemnt-preset-aurora">');
    expect(html).toContain("--accent:#ff0066");
    expect(html).toContain('data-elemnt-fonts href="https://fonts.googleapis.com/css2?family=Space+Grotesk');
    expect(html).toContain('id="theme-toggle"');
    expect(html).toContain('t=t==="light"||t==="dark"?t:"dark"');
    expect(html).toContain('class="elemnt-hero"');
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("font-src 'self' data: https://fonts.gstatic.com");
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
  });

  it("styles present mode the same way", async () => {
    const html = await (await t.call("/s/pub/launch?view=present")).text();
    expect(html).toContain("elemnt-bg-aurora");
    expect(html).toContain("--accent:#ff0066");
  });

  it("refuses to save a style that isn't valid", async () => {
    const res = await t.call("/api/spaces/pub/pages", { method: "POST", token: t.ownerToken, json: { path: "bad", source: '---\ntitle: Bad\nstyle:\n  accent: "red</style>"\n---\nx' } });
    expect(res.status).toBe(422);
  });
});

describe("organization theme", () => {
  it("lets admins set it, everyone read it, and applies it to pages without a style", async () => {
    const editor = await t.addMember("ed@example.com", "editor");
    const theme = { preset: "editorial", accent: "#0f766e", notes: "Plain words. No exclamation marks." };
    expect((await t.call("/api/settings/theme", { method: "PUT", token: editor, json: { theme } })).status).toBe(403);
    expect((await t.call("/api/settings/theme", { method: "PUT", token: t.ownerToken, json: { theme: { preset: "neon" } } })).status).toBe(400);
    expect(await (await t.call("/api/settings/theme", { method: "PUT", token: t.ownerToken, json: { theme } })).json()).toEqual({ theme });
    expect(await (await t.call("/api/settings/theme", { token: editor })).json()).toEqual({ theme });

    await t.call("/api/spaces/pub/pages", { method: "POST", token: t.ownerToken, json: { path: "plain", source: "---\ntitle: Plain\n---\nHello" } });
    const html = await (await t.call("/s/pub/plain")).text();
    expect(html).toContain("elemnt-preset-editorial");
    expect(html).toContain("--accent:#0f766e");
    expect(html).toContain("family=Fraunces");
  });

  it("wins over the page's colours and fonts when locked", async () => {
    await t.call("/api/settings/theme", { method: "PUT", token: t.ownerToken, json: { theme: { preset: "blueprint", lock: true, css: ".elemnt-page h1{letter-spacing:0} @import url(https://evil/x.css);" } } });
    const html = await (await t.call("/s/pub/launch")).text();
    expect(html).toContain("elemnt-preset-blueprint");
    expect(html).not.toContain("--accent:#ff0066");
    expect(html).toContain(".elemnt-page h1{letter-spacing:0}");
    expect(html).not.toContain("evil");
  });
});

describe("personal style", () => {
  it("saves and returns the user's own style", async () => {
    expect((await t.call("/api/me/style", { method: "PUT", token: t.ownerToken, json: { style: { preset: "sunset", headingFont: "x;}" } } })).status).toBe(400);
    await t.call("/api/me/style", { method: "PUT", token: t.ownerToken, json: { style: { preset: "sunset", headingFont: "Outfit" } } });
    expect(await (await t.call("/api/me/style", { token: t.ownerToken })).json()).toEqual({ style: { preset: "sunset", headingFont: "Outfit" } });
    const me = (await (await t.call("/api/me", { token: t.ownerToken })).json()) as { style: unknown; theme: unknown };
    expect(me.style).toEqual({ preset: "sunset", headingFont: "Outfit" });
    expect(me.theme).toBeNull();
  });
});

describe("style guide over MCP", () => {
  it("tells Claude to ask about style when there's no theme, and saves the answer", async () => {
    const guide = await callTool(t.ownerToken, "get_style_guide");
    expect(guide.text).toContain("Ask before you write");
    expect(guide.text).toContain("**aurora**");
    expect(guide.text).toContain(":::hero[");
    expect(guide.text).toContain("This workspace has no theme");

    const saved = await callTool(t.ownerToken, "save_my_style", { style: { preset: "terminal", monoFont: "Fira Code" } });
    expect(saved.isError).toBe(false);
    expect((await callTool(t.ownerToken, "get_style_guide")).text).toContain("monoFont: Fira Code");
    expect((await callTool(t.ownerToken, "save_my_style", { style: { preset: "neon" } })).isError).toBe(true);
  });

  it("tells Claude to follow a locked organization theme without asking", async () => {
    await t.call("/api/settings/theme", { method: "PUT", token: t.ownerToken, json: { theme: { preset: "blueprint", lock: true, notes: "Write like an SRE." } } });
    const guide = (await callTool(t.ownerToken, "get_style_guide")).text;
    expect(guide).toContain("**locked**");
    expect(guide).toContain("Skip the style questions");
    expect(guide).toContain("Write like an SRE.");
    expect(guide).not.toContain("Ask before you write");
  });
});
