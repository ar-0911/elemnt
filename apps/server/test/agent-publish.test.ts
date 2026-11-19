import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../src/db/schema.js";
import { SITES_DOMAIN, setup } from "./helpers.js";

let t: Awaited<ReturnType<typeof setup>>;
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

/** The page as the editor sees it: published and draft revision ids. */
async function pageState(path: string) {
  const tree = (await (await t.call("/api/spaces/docs/tree", { token: t.ownerToken })).json()) as { pages: { id: string; path: string }[] };
  const pg = tree.pages.find((p) => p.path === path)!;
  const body = (await (await t.call(`/api/pages/${pg.id}`, { token: t.ownerToken })).json()) as {
    page: { id: string; publishedRevisionId: string | null; draftRevisionId: string | null };
    source: string;
    headRevisionId: string;
  };
  return { id: pg.id, ...body.page, source: body.source, head: body.headRevisionId };
}

const turnOn = (token = t.ownerToken, on = true) => t.call("/api/spaces/docs", { method: "PATCH", token, json: { agentPublish: on } });

beforeEach(async () => {
  t = await setup();
  await t.call("/api/spaces", { method: "POST", token: t.ownerToken, json: { slug: "docs", name: "Docs", visibility: "public" } });
  await t.call("/api/spaces/docs/pages", { method: "POST", token: t.ownerToken, json: { path: "deploy", source: "---\ntitle: Deploying\n---\nShip with the canary pipeline." } });
});
afterEach(() => t.close());

describe("Let Claude publish, per space", () => {
  it("is off by default, and only admins can turn it on", async () => {
    const spaces = JSON.parse((await tool(t.ownerToken, "list_spaces", {})).text) as { slug: string; agentPublish: boolean }[];
    expect(spaces.find((s) => s.slug === "docs")!.agentPublish).toBe(false);
    const editor = await t.addMember("e@example.com", "editor");
    expect((await turnOn(editor)).status).toBe(403);
    expect((await turnOn()).status).toBe(200);
    expect(JSON.parse((await tool(t.ownerToken, "list_spaces", {})).text)[0].agentPublish).toBe(true);
  });

  it("refuses to publish while it's off, and nothing goes live", async () => {
    const created = await tool(t.ownerToken, "create_draft", { space: "docs", path: "rollback", source: "---\ntitle: Rolling back\n---\nRevert the tag.", publish: true });
    expect(created.isError).toBe(true);
    expect(created.text).toContain("Let Claude publish");
    const edit = await tool(t.ownerToken, "suggest_edit", { space: "docs", path: "deploy", summary: "Mention blue/green", edits: [{ find: "canary pipeline", replace: "blue/green pipeline" }], publish: true });
    expect(edit.isError).toBe(true);
    expect((await pageState("deploy")).source).toContain("canary pipeline");
  });

  it("when on, publishes new pages and Claude's own edits straight away", async () => {
    await turnOn();
    const created = JSON.parse((await tool(t.ownerToken, "create_draft", { space: "docs", path: "rollback", source: "---\ntitle: Rolling back\n---\nRevert the tag.", publish: true })).text);
    expect(created.status).toBe("published");
    const rb = await pageState("rollback");
    expect(rb.publishedRevisionId).toBeTruthy();
    expect(rb.draftRevisionId).toBeNull();

    const edit = JSON.parse((await tool(t.ownerToken, "suggest_edit", { space: "docs", path: "deploy", summary: "Blue/green now", edits: [{ find: "canary pipeline", replace: "blue/green pipeline" }], publish: true })).text);
    expect(edit.published).toBe(true);
    const dep = await pageState("deploy");
    expect(dep.draftRevisionId).toBeNull();
    expect(dep.source).toContain("blue/green pipeline");
  });

  it("won't publish a page with errors", async () => {
    await turnOn();
    const bad = await tool(t.ownerToken, "create_draft", { space: "docs", path: "broken", source: "---\ntitle: [unclosed\n---\nHi", publish: true });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("Not published");
  });

  it("never publishes over a person's draft; the change stays a suggestion", async () => {
    await turnOn();
    const before = await pageState("deploy");
    // A person starts a draft in the editor.
    const saved = await t.call(`/api/pages/${before.id}`, { method: "PUT", token: t.ownerToken, json: { source: "---\ntitle: Deploying\n---\nShip with the canary pipeline. WIP: new notes.", baseRevisionId: before.head, publish: false } });
    expect(saved.status).toBe(200);

    const edit = JSON.parse((await tool(t.ownerToken, "suggest_edit", { space: "docs", path: "deploy", summary: "Blue/green now", edits: [{ find: "canary pipeline", replace: "blue/green pipeline" }], publish: true })).text);
    expect(edit.published).toBe(false);
    expect(edit.note).toContain("written by a person");
    expect(edit.suggestionId).toBeTruthy();
    const after = await pageState("deploy");
    expect(after.publishedRevisionId).toBe(before.publishedRevisionId);
    expect(after.draftRevisionId).toBeTruthy();

    // publish_page won't publish the person's draft either.
    const pub = await tool(t.ownerToken, "publish_page", { space: "docs", path: "deploy" });
    expect(pub.isError).toBe(true);
    expect(pub.text).toContain("written by a person");
  });

  it("publishes Claude's earlier drafts and suggestions once turned on", async () => {
    await tool(t.ownerToken, "create_draft", { space: "docs", path: "rollback", source: "---\ntitle: Rolling back\n---\nRevert the tag." });
    const sug = JSON.parse((await tool(t.ownerToken, "suggest_edit", { space: "docs", path: "deploy", summary: "Blue/green now", edits: [{ find: "canary pipeline", replace: "blue/green pipeline" }] })).text);
    expect((await tool(t.ownerToken, "publish_page", { space: "docs", path: "rollback" })).isError).toBe(true);

    await turnOn();
    expect((await tool(t.ownerToken, "publish_page", { space: "docs", path: "rollback" })).isError).toBe(false);
    expect((await pageState("rollback")).publishedRevisionId).toBeTruthy();
    const acc = await tool(t.ownerToken, "accept_suggestion", { space: "docs", suggestion: sug.suggestionId });
    expect(acc.isError).toBe(false);
    expect((await pageState("deploy")).source).toContain("blue/green pipeline");
  });

  it("only accepts suggestions Claude made over MCP", async () => {
    await turnOn();
    const sug = JSON.parse((await tool(t.ownerToken, "suggest_edit", { space: "docs", path: "deploy", summary: "Manual deploys", edits: [{ find: "canary", replace: "manual" }] })).text);
    // Pretend it came from the in-app assistant instead.
    await t.db.update(schema.suggestions).set({ origin: "assist" }).where(eq(schema.suggestions.id, sug.suggestionId));
    const acc = await tool(t.ownerToken, "accept_suggestion", { space: "docs", suggestion: sug.suggestionId });
    expect(acc.isError).toBe(true);
    expect(acc.text).toContain("made over MCP");
    expect((await pageState("deploy")).source).toContain("canary");
  });

  it("covers the websites that show the space", async () => {
    await t.call("/api/sites", { method: "POST", token: t.ownerToken, json: { slug: "acme", name: "Acme", space: "docs" } });
    const change = { site: "acme", summary: "New home", files: [{ path: "pages/index.html", content: "---\nlayout: base\ntitle: Home\n---\n<h1>Rocket v2</h1>" }], publish: true };
    expect((await tool(t.ownerToken, "propose_site_changes", change)).isError).toBe(true);
    await turnOn();
    expect(JSON.parse((await tool(t.ownerToken, "list_sites", {})).text)[0].agentPublish).toBe(true);
    const done = JSON.parse((await tool(t.ownerToken, "propose_site_changes", change)).text);
    expect(done.published).toBe(true);
    expect(await (await t.app.request(`https://acme.${SITES_DOMAIN}/`)).text()).toContain("Rocket v2");
  });
});
