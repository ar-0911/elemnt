import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PUBLIC_URL, SITES_DOMAIN, setup } from "./helpers.js";

let t: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  t = await setup();
});
afterEach(async () => {
  await t.close();
});

const site = (slug: string, path = "/", init: RequestInit = {}) => t.app.request(`https://${slug}.${SITES_DOMAIN}${path}`, init);

async function makeSite(json: Record<string, unknown> = {}) {
  await t.call("/api/spaces", { method: "POST", token: t.ownerToken, json: { slug: "acme-docs", name: "Acme docs", visibility: "public" } });
  const res = await t.call("/api/sites", { method: "POST", token: t.ownerToken, json: { slug: "acme", name: "Acme", space: "acme-docs", repo: "acme/rocket", tagline: "Rockets for everyone.", ...json } });
  expect(res.status).toBe(201);
  return res.json() as Promise<{ url: string; slug: string }>;
}

async function page(path: string, source: string) {
  const res = await t.call(`/api/spaces/acme-docs/pages`, { method: "POST", token: t.ownerToken, json: { path, source } });
  expect(res.status).toBe(201);
}

async function publish(body: Record<string, unknown> = {}) {
  return t.call("/api/sites/acme/publish", { method: "POST", token: t.ownerToken, json: body });
}

async function putFiles(files: { path: string; content: string | null }[]) {
  const res = await t.call("/api/sites/acme/files", { method: "PUT", token: t.ownerToken, json: { files } });
  expect(res.status).toBe(200);
}

describe("project websites", () => {
  it("creates a site from the starter design at its own subdomain", async () => {
    const made = await makeSite();
    expect(made.url).toBe(`https://acme.${SITES_DOMAIN}`);
    const files = (await (await t.call("/api/sites/acme", { token: t.ownerToken })).json()) as { files: { path: string }[] };
    expect(files.files.map((f) => f.path)).toEqual(expect.arrayContaining(["site.json", "layouts/base.liquid", "layouts/docs.liquid", "pages/index.html", "scripts/scene.js", "styles/site.css"]));
    // Not served until published.
    expect((await site("acme")).status).toBe(404);
  });

  it("serves the published home page with nav, the 3D scene and Elemnt's head", async () => {
    await makeSite();
    expect((await publish()).status).toBe(200);
    const res = await site("acme");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<title>Acme</title>");
    expect(html).toContain('href="/docs"');
    expect(html).toContain('<canvas class="scene"');
    expect(html).toContain('"three":"/_elemnt/vendor/three.module.js"');
    expect(html).toContain("https://github.com/acme/rocket");
    expect(res.headers.get("content-security-policy")).toContain(`frame-ancestors 'self' ${PUBLIC_URL}`);
    // Scripts, styles and three.js come from the site itself.
    expect((await site("acme", "/scripts/scene.js")).headers.get("content-type")).toContain("javascript");
    expect(await (await site("acme", "/styles/site.css")).text()).toContain("--accent");
    const three = await site("acme", "/_elemnt/vendor/three.module.js");
    expect(three.status).toBe(200);
    expect((await site("acme", "/_elemnt/vendor/three/addons/controls/OrbitControls.js")).status).toBe(200);
    expect((await site("acme", "/_elemnt/vendor/three/addons/../../package.json")).status).toBe(404);
    // Layouts and pages aren't files anyone can download.
    expect((await site("acme", "/layouts/base.liquid")).status).toBe(404);
  });

  it("puts the space's Markdown pages under /docs inside the docs layout", async () => {
    await makeSite();
    await page("getting-started", "---\ntitle: Getting started\nsummary: Launch in a minute.\n---\n\n## Install\n\nRun it.\n\n## Launch\n\n:::callout{type=warn}\nStand back.\n:::\n");
    await page("api", "---\ntitle: API\n---\n\nThe API.\n");
    await publish();
    const res = await site("acme", "/docs/getting-started");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("<title>Getting started · Acme</title>");
    expect(html).toContain('class="docs-side"');
    expect(html).toContain('href="/docs/api"');
    expect(html).toContain("elemnt-callout");
    expect(html).toContain('data-elemnt-toc');
    expect(html).toContain('href="#install"');
    // Docs index, Markdown for agents, search, sitemap, llms.txt.
    expect(await (await site("acme", "/docs")).text()).toContain("elemnt-docs-card");
    expect(await (await site("acme", "/docs/getting-started.md")).text()).toContain("## Install");
    const md = await site("acme", "/docs/api", { headers: { accept: "text/markdown" } });
    expect(md.headers.get("content-type")).toContain("text/markdown");
    const search = (await (await site("acme", "/_elemnt/search.json")).json()) as { items: { title: string; url: string }[] };
    expect(search.items.map((i) => i.url)).toEqual(expect.arrayContaining(["/", "/showcase", "/docs/getting-started", "/docs/api"]));
    const sitemap = await (await site("acme", "/sitemap.xml")).text();
    expect(sitemap).toContain(`<loc>https://acme.${SITES_DOMAIN}/docs/getting-started</loc>`);
    expect(await (await site("acme", "/llms.txt")).text()).toContain(`(https://acme.${SITES_DOMAIN}/docs/api.md)`);
    // Unknown routes get a 404 page in the site's design.
    const missing = await site("acme", "/nope");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("site-header");
  });

  it("can show one subtree of a shared space as the site's docs", async () => {
    await makeSite();
    await page("ares", "---\ntitle: Ares\nsummary: Agents on machines.\n---\n\nOverview. [Flags](/s/acme-docs/ares/flags#core) and [Braid](/s/acme-docs/braid).\n");
    await page("ares/flags", "---\ntitle: Flags\n---\n\nAll flags.\n");
    await page("braid", "# Braid\n\nNot this one.\n");
    const cfg = JSON.parse(((await (await t.call("/api/sites/acme/files/site.json", { token: t.ownerToken })).json()) as { content: string }).content) as { docs?: Record<string, unknown> };
    cfg.docs = { ...cfg.docs, root: "ares" };
    await putFiles([{ path: "site.json", content: JSON.stringify(cfg) }]);
    await publish();
    const index = await (await site("acme", "/docs")).text();
    expect(index).toContain("Overview.");
    expect(index).toContain('href="/docs/flags"');
    expect(index).toContain('href="/docs/flags#core"');
    expect(index).toContain(`href="${PUBLIC_URL}/s/acme-docs/braid"`);
    expect(index).not.toContain("<h1>Braid");
    expect((await site("acme", "/docs/flags")).status).toBe(200);
    expect((await site("acme", "/docs/braid")).status).toBe(404);
    expect((await site("acme", "/docs/ares/flags")).status).toBe(404);
    expect(await (await site("acme", "/llms.txt")).text()).toContain(`(https://acme.${SITES_DOMAIN}/docs/flags.md)`);
  });

  it("links each docs page to the same page on its website, closest site first", async () => {
    await makeSite();
    await page("ares", "# Ares\n\nAgents.\n");
    await page("ares/flags", "# Flags\n\nAll flags.\n");
    await page("braid", "# Braid\n\nWeaving.\n");
    // Nothing published yet: no link.
    expect(await (await t.call("/s/acme-docs/braid")).text()).not.toContain("Website ↗");
    await publish();
    const braid = await (await t.call("/s/acme-docs/braid")).text();
    expect(braid).toContain(`href="https://acme.${SITES_DOMAIN}/docs/braid"`);
    expect(braid).toContain("Website ↗");
    expect(await (await t.call("/s/acme-docs")).text()).toContain(`href="https://acme.${SITES_DOMAIN}/"`);
    // A second site showing only the ares branch wins for pages under it.
    expect((await t.call("/api/sites", { method: "POST", token: t.ownerToken, json: { slug: "ares", name: "Ares", space: "acme-docs" } })).status).toBe(201);
    const cfg = JSON.parse(((await (await t.call("/api/sites/ares/files/site.json", { token: t.ownerToken })).json()) as { content: string }).content) as { docs?: Record<string, unknown> };
    cfg.docs = { ...cfg.docs, root: "ares" };
    expect((await t.call("/api/sites/ares/files", { method: "PUT", token: t.ownerToken, json: { files: [{ path: "site.json", content: JSON.stringify(cfg) }] } })).status).toBe(200);
    expect((await t.call("/api/sites/ares/publish", { method: "POST", token: t.ownerToken, json: {} })).status).toBe(200);
    expect(await (await t.call("/s/acme-docs/ares/flags")).text()).toContain(`href="https://ares.${SITES_DOMAIN}/docs/flags"`);
    expect(await (await t.call("/s/acme-docs/ares")).text()).toContain(`href="https://ares.${SITES_DOMAIN}/docs"`);
    expect(await (await t.call("/s/acme-docs/braid")).text()).toContain(`href="https://acme.${SITES_DOMAIN}/docs/braid"`);
  });

  it("only links to a members-only website for readers who can open it", async () => {
    await makeSite({ visibility: "members" });
    await page("braid", "# Braid\n\nWeaving.\n");
    await publish();
    expect(await (await t.call("/s/acme-docs/braid")).text()).not.toContain(`acme.${SITES_DOMAIN}`);
    expect(await (await t.call("/s/acme-docs/braid", { token: t.ownerToken })).text()).toContain(`href="https://acme.${SITES_DOMAIN}/docs/braid"`);
  });

  it("keeps docs current: a page published later shows up without republishing the site", async () => {
    await makeSite();
    await publish();
    expect((await site("acme", "/docs/later")).status).toBe(404);
    await page("later", "# Later\n\nNew.");
    await new Promise((r) => setTimeout(r, 3100));
    expect((await site("acme", "/docs/later")).status).toBe(200);
  }, 10_000);

  it("fills :::section blocks in Markdown with the site's partials", async () => {
    await makeSite();
    await putFiles([{ path: "partials/banner.liquid", content: '<div class="banner" data-tone="{{ props.tone }}">{{ content }}<span>{{ site.name }}</span></div>' }]);
    await page("intro", '# Intro\n\n:::section{use="banner" tone="loud"}\n**Big news**\n:::\n\n::section{use="missing"}\n');
    await publish();
    const html = await (await site("acme", "/docs/intro")).text();
    expect(html).toContain('<div class="banner" data-tone="loud"><p><strong>Big news</strong></p><span>Acme</span></div>');
    expect(html).toContain('class="section section-missing"');
    // In the regular reader the section is just its content.
    const reader = await (await t.app.request("/s/acme-docs/intro")).text();
    expect(reader).toContain("<strong>Big news</strong>");
    expect(reader).not.toContain(`class="banner"`);
  });

  it("previews the draft at an unguessable address without touching the live site", async () => {
    await makeSite();
    await publish();
    await putFiles([{ path: "pages/index.html", content: "---\ntitle: New home\n---\n<h1>Brand new</h1>" }]);
    expect(await (await site("acme")).text()).not.toContain("Brand new");
    const prev = (await (await t.call("/api/sites/acme/preview", { method: "POST", token: t.ownerToken })).json()) as { url: string; diagnostics: unknown[] };
    expect(prev.url).toMatch(new RegExp(`^https://acme--[0-9a-f]{16}\\.${SITES_DOMAIN.replace(/\./g, "\\.")}$`));
    const res = await t.app.request(prev.url + "/");
    const html = await res.text();
    expect(html).toContain("Brand new");
    expect(html).toContain('name="robots" content="noindex"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect((await t.app.request(`https://acme--0000000000000000.${SITES_DOMAIN}/`)).status).toBe(404);
  });

  it("refuses to publish a template error, and can roll back", async () => {
    await makeSite();
    const first = (await (await publish()).json()) as { release: string };
    await putFiles([{ path: "pages/index.html", content: "{% if %}broken" }]);
    const bad = await publish();
    expect(bad.status).toBe(422);
    expect(JSON.stringify(await bad.json())).toContain("pages/index.html");
    await putFiles([{ path: "pages/index.html", content: "<h1>v2</h1>" }]);
    await publish();
    expect(await (await site("acme")).text()).toContain("v2");
    expect((await publish({ release: first.release })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 3100));
    expect(await (await site("acme")).text()).not.toContain("v2");
  }, 10_000);

  it("applies Claude's change sets after review and catches conflicts", async () => {
    await makeSite();
    const proposed = await t.call("/api/sites/acme/changesets", { method: "POST", token: t.ownerToken, json: { summary: "Make it orange", files: [{ path: "styles/site.css", content: ":root{--accent:#f97316}" }, { path: "pages/showcase.html", content: null }] } });
    expect(proposed.status).toBe(201);
    const { id } = (await proposed.json()) as { id: string };
    const review = (await (await t.call(`/api/sites/acme/changesets/${id}`, { token: t.ownerToken })).json()) as { files: { path: string; current: string; conflict: boolean }[] };
    expect(review.files[0]!.current).toContain("--accent:#8b5cf6");
    expect(review.files.every((f) => !f.conflict)).toBe(true);

    // Someone edits the CSS before the review is done.
    await putFiles([{ path: "styles/site.css", content: "body{}" }]);
    const clash = await t.call(`/api/sites/acme/changesets/${id}/apply`, { method: "POST", token: t.ownerToken, json: {} });
    expect(clash.status).toBe(409);
    const ok = await t.call(`/api/sites/acme/changesets/${id}/apply`, { method: "POST", token: t.ownerToken, json: { force: true } });
    expect(ok.status).toBe(200);
    const files = ((await ok.json()) as { files: { path: string }[] }).files.map((f) => f.path);
    expect(files).not.toContain("pages/showcase.html");
    expect(((await (await t.call("/api/sites/acme/files/styles/site.css", { token: t.ownerToken })).json()) as { content: string }).content).toBe(":root{--accent:#f97316}");
  });

  it("rejects bad file paths, reserved names and viewers", async () => {
    await makeSite();
    const bad = await t.call("/api/sites/acme/files", { method: "PUT", token: t.ownerToken, json: { files: [{ path: "../etc/passwd", content: "x" }] } });
    expect(bad.status).toBe(400);
    expect((await t.call("/api/sites", { method: "POST", token: t.ownerToken, json: { slug: "docs", name: "Docs" } })).status).toBe(400);
    expect((await t.call("/api/sites", { method: "POST", token: t.ownerToken, json: { slug: "a--b", name: "x" } })).status).toBe(400);
    const viewer = await t.addMember("v@example.com", "viewer");
    expect((await t.call("/api/sites/acme/publish", { method: "POST", token: viewer, json: {} })).status).toBe(403);
  });

  it("serves a site on its own hostname and lists sites for hub pages", async () => {
    await makeSite();
    await publish();
    await t.call("/api/sites", { method: "POST", token: t.ownerToken, json: { slug: "www", name: "Hub", template: "blank" } });
    await t.call("/api/sites/www/files", { method: "PUT", token: t.ownerToken, json: { files: [{ path: "pages/index.html", content: "{% for s in elemnt.sites %}<a href=\"{{ s.url }}\">{{ s.name }}: {{ s.tagline }}</a>{% endfor %}" }] } });
    expect((await t.call("/api/sites/www", { method: "PATCH", token: t.ownerToken, json: { hostname: "hub.example.org" } })).status).toBe(200);
    await t.call("/api/sites/www/publish", { method: "POST", token: t.ownerToken, json: {} });
    const html = await (await t.app.request("https://hub.example.org/")).text();
    expect(html).toContain(`<a href="https://acme.${SITES_DOMAIN}">Acme: Rockets for everyone.</a>`);
    expect((await t.call("/api/sites/acme", { method: "PATCH", token: t.ownerToken, json: { hostname: "docs.example.com" } })).status).toBe(400);
  });

  it("never treats the app's own host as a site, and never sends credentials to API passthroughs", async () => {
    await makeSite();
    await publish();
    expect(await (await t.app.request(`${PUBLIC_URL}/`)).text()).not.toContain('class="site-header"');
    // A site's scripts can't write to the app with a visitor's session.
    const res = await site("acme", "/api/me/account", { method: "PUT", headers: { Authorization: `Bearer ${t.ownerToken}` } });
    expect(res.status).toBe(405);
  });

  it("lets sites embed widgets from the sandbox", async () => {
    await makeSite();
    const run = await t.app.request("https://sandbox.example.com/w/run/javascript");
    expect(run.headers.get("content-security-policy")).toContain(`frame-ancestors ${PUBLIC_URL} https://*.${SITES_DOMAIN}`);
  });
});

describe("on-demand HTTPS", () => {
  it("only vouches for hostnames this server answers", async () => {
    const allow = async (domain: string) => (await t.app.request(`http://server:8787/internal/tls-allow?domain=${domain}`)).status;
    expect(await allow("docs.example.com")).toBe(200);
    expect(await allow("sandbox.example.com")).toBe(200);
    expect(await allow("evil.example.org")).toBe(404);
    expect(await allow(`nope.${SITES_DOMAIN}`)).toBe(404);
    await t.call("/api/sites", { method: "POST", token: t.ownerToken, json: { slug: "rocket", name: "Rocket" } });
    expect((await t.call("/api/sites/rocket/publish", { method: "POST", token: t.ownerToken })).status).toBe(200);
    expect(await allow(`rocket.${SITES_DOMAIN}`)).toBe(200);
  });
});
