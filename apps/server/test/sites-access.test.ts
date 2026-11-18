import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../src/db/schema.js";
import { PUBLIC_URL, SITES_DOMAIN, setup } from "./helpers.js";

let t: Awaited<ReturnType<typeof setup>>;
afterEach(() => t.close());

const site = (path = "/", init: RequestInit = {}) => t.app.request(`https://infra.${SITES_DOMAIN}${path}`, init);
const html = { headers: { accept: "text/html" } };

let id = 0;
async function tool(token: string, name: string, args: Record<string, unknown>) {
  const res = await t.call("/mcp", {
    method: "POST",
    token,
    headers: { Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" },
    json: { jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } },
  });
  const result = ((await res.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
  return { text: result.content[0]!.text, isError: Boolean(result.isError) };
}

/** Walks the sign-in handshake for a viewer and returns the site cookie. */
async function signIn(token: string, ret = "/docs/tunnel") {
  const first = await site(ret, html);
  expect(first.status).toBe(302);
  const enter = new URL(first.headers.get("location")!);
  expect(`${enter.origin}${enter.pathname}`).toBe(`${PUBLIC_URL}/sites/enter`);
  const handoff = await t.call(`${enter.pathname}${enter.search}`, { token });
  if (handoff.status !== 302) return { status: handoff.status, cookie: undefined };
  const auth = new URL(handoff.headers.get("location")!);
  expect(auth.host).toBe(`infra.${SITES_DOMAIN}`);
  const back = await site(`${auth.pathname}${auth.search}`);
  expect(back.status).toBe(302);
  expect(back.headers.get("location")).toBe(ret);
  const setCookie = back.headers.get("set-cookie")!;
  expect(setCookie).toMatch(/^__Host-elemnt_site=/);
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("Secure");
  expect(setCookie).not.toMatch(/Domain=/i);
  return { status: 200, cookie: setCookie.split(";")[0]! };
}

describe("members-only sites", () => {
  let editor: string;

  beforeEach(async () => {
    t = await setup();
    editor = await t.addMember("grace@example.com", "editor");
    await t.call("/api/spaces", { method: "POST", token: t.ownerToken, json: { slug: "infrastructure", name: "Infrastructure", visibility: "private" } });
    expect((await t.call("/api/spaces/infrastructure/pages", { method: "POST", token: t.ownerToken, json: { path: "tunnel", source: "---\ntitle: Tunnel\n---\n\nThe hub at 10.0.0.1." } })).status).toBe(201);
  });

  it("won't put a private space's docs on a public site", async () => {
    const res = await t.call("/api/sites", { method: "POST", token: t.ownerToken, json: { slug: "infra", name: "Infra", space: "infrastructure" } });
    expect(res.status).toBe(400);
  });

  it("sends visitors to sign in, lets space members in, and keeps everyone else out", async () => {
    expect((await t.call("/api/sites", { method: "POST", token: t.ownerToken, json: { slug: "infra", name: "Infra", space: "infrastructure", visibility: "members" } })).status).toBe(201);
    expect((await t.call("/api/sites/infra/publish", { method: "POST", token: t.ownerToken, json: {} })).status).toBe(200);

    // Anonymous: no content, just the way to sign in.
    const api = await site("/docs/tunnel");
    expect(api.status).toBe(401);
    expect(await api.text()).not.toContain("10.0.0.1");
    // A forged or other-site code doesn't work.
    expect((await site("/_elemnt/auth?code=nope")).status).toBe(400);

    // The owner gets in, and the page is never cached by a shared cache.
    const owner = await signIn(t.ownerToken);
    const page = await site("/docs/tunnel", { headers: { cookie: owner.cookie! } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("10.0.0.1");
    expect(page.headers.get("cache-control")).toBe("private, no-store");
    expect(page.headers.get("x-robots-tag")).toContain("noindex");

    // A workspace editor who isn't in the space is refused at the app.
    expect((await signIn(editor)).status).toBe(403);

    // Added to the space, they get in; removed, they're out again.
    const grace = (await t.db.select().from(schema.users)).find((u) => u.email === "grace@example.com")!.id;
    expect((await t.call(`/api/spaces/infrastructure/members/${grace}`, { method: "PUT", token: t.ownerToken })).status).toBe(204);
    const g = await signIn(editor);
    expect((await site("/docs/tunnel", { headers: { cookie: g.cookie! } })).status).toBe(200);

    // A session cookie doesn't open some other site.
    expect((await t.call("/api/sites", { method: "POST", token: t.ownerToken, json: { slug: "other", name: "Other", space: "infrastructure", visibility: "members" } })).status).toBe(201);
    await t.call("/api/sites/other/publish", { method: "POST", token: t.ownerToken, json: {} });
    expect((await t.app.request(`https://other.${SITES_DOMAIN}/`, { headers: { cookie: g.cookie! } })).status).toBe(401);
  });

  it("only owners and admins can change who can open a site or let Claude publish", async () => {
    await t.call("/api/sites", { method: "POST", token: t.ownerToken, json: { slug: "infra", name: "Infra", space: "infrastructure", visibility: "members" } });
    expect((await t.call("/api/sites/infra", { method: "PATCH", token: editor, json: { agentPublish: true } })).status).toBe(403);
    // Making it public while it shows a private space isn't allowed.
    expect((await t.call("/api/sites/infra", { method: "PATCH", token: t.ownerToken, json: { visibility: "public" } })).status).toBe(400);
    expect((await t.call("/api/sites/infra", { method: "PATCH", token: t.ownerToken, json: { agentPublish: true } })).status).toBe(200);
  });
});

describe("Claude publishing sites over MCP", () => {
  beforeEach(async () => {
    t = await setup();
    await t.call("/api/spaces", { method: "POST", token: t.ownerToken, json: { slug: "acme-docs", name: "Acme docs", visibility: "public" } });
    await t.call("/api/sites", { method: "POST", token: t.ownerToken, json: { slug: "acme", name: "Acme", space: "acme-docs" } });
  });

  const change = (publish?: boolean) => ({
    site: "acme",
    summary: "New home",
    files: [{ path: "pages/index.html", content: "---\nlayout: base\ntitle: Home\n---\n<h1>Rocket v2</h1>" }],
    ...(publish === undefined ? {} : { publish }),
  });

  it("refuses until the site's owner turns it on, then publishes in one step", async () => {
    const refused = await tool(t.ownerToken, "propose_site_changes", change(true));
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("Let Claude publish");
    expect((await tool(t.ownerToken, "publish_site", { site: "acme" })).isError).toBe(true);
    // Still not live.
    expect((await t.app.request(`https://acme.${SITES_DOMAIN}/`)).status).toBe(404);

    expect((await t.call("/api/sites/acme", { method: "PATCH", token: t.ownerToken, json: { agentPublish: true } })).status).toBe(200);
    const done = await tool(t.ownerToken, "propose_site_changes", change(true));
    expect(done.isError).toBe(false);
    expect(JSON.parse(done.text).published).toBe(true);
    expect(await (await t.app.request(`https://acme.${SITES_DOMAIN}/`)).text()).toContain("Rocket v2");
    expect(JSON.parse((await tool(t.ownerToken, "list_sites", {})).text)[0].agentPublish).toBe(true);
  });

  it("doesn't publish a change with template errors", async () => {
    await t.call("/api/sites/acme", { method: "PATCH", token: t.ownerToken, json: { agentPublish: true } });
    const bad = await tool(t.ownerToken, "propose_site_changes", {
      site: "acme",
      summary: "Broken",
      files: [{ path: "pages/index.html", content: "---\nlayout: base\n---\n{% if %}" }],
      publish: true,
    });
    expect(JSON.parse(bad.text).published).toBe(false);
    expect((await t.app.request(`https://acme.${SITES_DOMAIN}/`)).status).toBe(404);
  });

  it("without publish, a change still waits for review", async () => {
    await t.call("/api/sites/acme", { method: "PATCH", token: t.ownerToken, json: { agentPublish: true } });
    const res = JSON.parse((await tool(t.ownerToken, "propose_site_changes", change())).text);
    expect(res.published).toBeUndefined();
    expect(res.review).toContain("changeset=");
  });
});
