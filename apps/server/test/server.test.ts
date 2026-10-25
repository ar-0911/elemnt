import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PUBLIC_URL, setup } from "./helpers.js";

const PAGE = `---
title: Deploying billing
summary: From merged PR to production.
---

:::callout{type=warn}
Needs the deployer role.
:::

::::tabs
:::tab[npm]
npm i
:::
:::tab[pnpm]
pnpm add
:::
::::
`;

let t: Awaited<ReturnType<typeof setup>>;

async function createSpace(slug: string, visibility: "public" | "workspace" | "private") {
  const res = await t.call("/api/spaces", { method: "POST", token: t.ownerToken, json: { slug, name: slug.toUpperCase(), visibility } });
  expect(res.status).toBe(201);
}

async function createPage(space: string, path: string, source = PAGE) {
  const res = await t.call(`/api/spaces/${space}/pages`, { method: "POST", token: t.ownerToken, json: { path, source } });
  return { res, body: (await res.json()) as { pageId: string; revisionId: string; url: string; error?: string; diagnostics?: unknown[] } };
}

beforeEach(async () => {
  t = await setup();
});
afterEach(async () => {
  await t.close();
});

describe("pages API", () => {
  it("creates a page and stores all three renditions", async () => {
    await createSpace("eng", "workspace");
    const { res, body } = await createPage("eng", "billing");
    expect(res.status).toBe(201);
    expect(body.url).toBe(`${PUBLIC_URL}/s/eng/billing`);

    for (const [rendition, needle] of [["source", ":::callout"], ["html", "elemnt-callout"], ["markdown", "> **Warning**: Needs the deployer role."]] as const) {
      const r = await t.call(`/api/revisions/${body.revisionId}/${rendition}`, { token: t.ownerToken });
      expect(await r.text()).toContain(needle);
    }
  });

  it("rejects source with errors and returns diagnostics with positions", async () => {
    await createSpace("eng", "workspace");
    const { res, body } = await createPage("eng", "bad", "Intro\n\n:::nope\nx\n:::");
    expect(res.status).toBe(422);
    expect(body.diagnostics).toEqual([{ severity: "error", message: 'Unknown component "nope"', component: "nope", line: 3, column: 1 }]);
  });

  it("requires the parent page and valid paths", async () => {
    await createSpace("eng", "workspace");
    expect((await createPage("eng", "guides/deploy")).res.status).toBe(400);
    expect((await createPage("eng", "Guides")).res.status).toBe(400);
    expect((await createPage("eng", "guides")).res.status).toBe(201);
    expect((await createPage("eng", "guides/deploy")).res.status).toBe(201);
    expect((await createPage("eng", "guides")).res.status).toBe(409);

    const tree = await (await t.call("/api/spaces/eng/tree", { token: t.ownerToken })).json();
    expect(tree.pages.map((p: { path: string }) => p.path)).toEqual(["guides", "guides/deploy"]);
  });

  it("saves revisions with optimistic locking", async () => {
    await createSpace("eng", "workspace");
    const { body: created } = await createPage("eng", "billing");
    const save = (base: string, source: string) => t.call(`/api/pages/${created.pageId}`, { method: "PUT", token: t.ownerToken, json: { source, baseRevisionId: base } });

    const first = await save(created.revisionId, "# Updated\n\nNew text.");
    expect(first.status).toBe(200);
    const stale = await save(created.revisionId, "# Lost update");
    expect(stale.status).toBe(409);
    const { currentRevisionId } = await stale.json();
    expect(currentRevisionId).toBe((await first.json()).revisionId);

    const revs = await (await t.call(`/api/pages/${created.pageId}/revisions`, { token: t.ownerToken })).json();
    expect(revs).toHaveLength(2);
    expect(revs[0].parentRevisionId).toBe(created.revisionId);
  });

  it("enforces roles", async () => {
    await createSpace("eng", "workspace");
    const viewerToken = await t.addMember("v@example.com", "viewer");
    expect((await t.call("/api/spaces/eng/pages", { method: "POST", token: viewerToken, json: { path: "x", source: "x" } })).status).toBe(403);
    expect((await t.call("/api/spaces/eng/pages", { method: "POST", json: { path: "x", source: "x" } })).status).toBe(401);
    expect((await t.call("/api/spaces/eng/pages", { method: "POST", token: "elm_bogus", json: { path: "x", source: "x" } })).status).toBe(401);
  });
});

describe("reader", () => {
  beforeEach(async () => {
    await createSpace("pub", "public");
    await createSpace("eng", "workspace");
    await createPage("pub", "billing");
    await createPage("eng", "secret");
  });

  it("serves the page with a Page / Markdown toggle, OG tags and a markdown alternate", async () => {
    const res = await t.call("/s/pub/billing");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<aside class="elemnt-callout" data-type="warn"');
    expect(html).toContain('aria-current="page">Page</a>');
    expect(html).toContain(`href="${PUBLIC_URL}/s/pub/billing?view=markdown"`);
    expect(html).toContain(`<link rel="alternate" type="text/markdown" href="${PUBLIC_URL}/s/pub/billing.md">`);
    expect(html).toContain('<meta property="og:title" content="Deploying billing">');
    expect(html).toContain('<meta property="og:description" content="From merged PR to production.">');
    expect(res.headers.get("content-security-policy")).toMatch(/script-src 'nonce-/);
  });

  it("shows the stored Markdown in the Markdown view", async () => {
    const html = await (await t.call("/s/pub/billing?view=markdown")).text();
    expect(html).toContain('aria-current="page">Markdown</a>');
    expect(html).toContain("&gt; **Warning**: Needs the deployer role.");
    expect(html).toContain('id="copy-md"');
  });

  it("serves .md files and honours Accept: text/markdown", async () => {
    const file = await t.call("/s/pub/billing.md");
    expect(file.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await file.text()).toMatch(/^# Deploying billing\n\n> From merged PR to production\./);
    const negotiated = await t.call("/s/pub/billing", { headers: { Accept: "text/markdown" } });
    expect(negotiated.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
  });

  it("publishes llms.txt and llms-full.txt", async () => {
    expect(await (await t.call("/s/pub/llms.txt")).text()).toContain(`- [Deploying billing](${PUBLIC_URL}/s/pub/billing.md): From merged PR to production.`);
    const full = await (await t.call("/s/pub/llms-full.txt")).text();
    expect(full).toContain(`<!-- source: ${PUBLIC_URL}/s/pub/billing -->`);
    expect(full).toContain("## npm\n\nnpm i");
  });

  it("hides workspace spaces from anonymous readers and shows them to members", async () => {
    const anon = await t.call("/s/eng/secret");
    expect(anon.status).toBe(302);
    expect(anon.headers.get("location")).toBe("/login?next=%2Fs%2Feng%2Fsecret");
    expect((await t.call("/s/eng/llms.txt")).status).toBe(404);
    expect((await t.call("/s/eng/secret", { token: t.ownerToken })).status).toBe(200);
  });

  it("signs in with a token cookie", async () => {
    const form = new URLSearchParams({ token: t.ownerToken, next: "/s/eng/secret" });
    const res = await t.app.request("/login", { method: "POST", body: form, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/s/eng/secret");
    const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
    expect((await t.app.request("/s/eng/secret", { headers: { Cookie: cookie } })).status).toBe(200);
  });

  it("refuses open redirects after sign-in", async () => {
    const form = new URLSearchParams({ token: t.ownerToken, next: "//evil.example" });
    const res = await t.app.request("/login", { method: "POST", body: form, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    expect(res.headers.get("location")).toBe("/");
  });

  it("counts views by format and source", async () => {
    await t.call("/s/pub/billing?utm_source=linkedin&utm_campaign=pub/billing");
    await t.call("/s/pub/billing");
    await t.call("/s/pub/billing.md");
    const tree = await (await t.call("/api/spaces/pub/tree", { token: t.ownerToken })).json();
    const stats = await (await t.call(`/api/pages/${tree.pages[0].id}/stats`, { token: t.ownerToken })).json();
    expect(stats.total).toBe(3);
    expect(stats.breakdown).toEqual(
      expect.arrayContaining([
        { format: "html", source: "linkedin", views: 1 },
        { format: "html", source: "direct", views: 1 },
        { format: "markdown", source: "direct", views: 1 },
      ]),
    );
  });
});
