import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../src/db/schema.js";
import { setup } from "./helpers.js";

let t: Awaited<ReturnType<typeof setup>>;
afterEach(() => t.close());

const SECRET = "---\ntitle: Tunnel\n---\nThe tunnel uses wireguard on the bastion.";

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

async function userId(email: string) {
  const users = await t.db.select().from(schema.users);
  return users.find((u) => u.email === email)!.id;
}

describe("private spaces", () => {
  let editor: string;
  let pageId: string;
  let revisionId: string;

  beforeEach(async () => {
    t = await setup();
    editor = await t.addMember("grace@example.com", "editor");
    expect((await t.call("/api/spaces", { method: "POST", token: t.ownerToken, json: { slug: "infra", name: "Infra", visibility: "private" } })).status).toBe(201);
    await t.call("/api/spaces", { method: "POST", token: t.ownerToken, json: { slug: "eng", name: "Eng", visibility: "workspace" } });
    const created = await (await t.call("/api/spaces/infra/pages", { method: "POST", token: t.ownerToken, json: { path: "tunnel", source: SECRET } })).json();
    pageId = created.pageId;
    revisionId = created.revisionId;
  });

  it("stays hidden from workspace members who weren't added, everywhere they could look", async () => {
    const spaces = (await (await t.call("/api/spaces", { token: editor })).json()) as { slug: string }[];
    expect(spaces.map((s) => s.slug)).toEqual(["eng"]);
    expect((await t.call("/api/spaces/infra/tree", { token: editor })).status).toBe(404);
    expect((await t.call(`/api/pages/${pageId}`, { token: editor })).status).toBe(404);
    expect((await t.call(`/api/pages/${pageId}/comments`, { token: editor })).status).toBe(404);
    expect((await t.call(`/api/revisions/${revisionId}/markdown`, { token: editor })).status).toBe(404);
    expect((await t.call("/s/infra/tunnel", { token: editor })).status).toBe(404);
    expect((await t.call("/s/infra/llms-full.txt", { token: editor })).status).toBe(404);
    expect((await (await t.call("/api/search?q=wireguard", { token: editor })).json()).length).toBe(0);
    // Editors can't write into it either.
    expect((await t.call("/api/spaces/infra/pages", { method: "POST", token: editor, json: { path: "x", source: "Hello." } })).status).toBe(404);
    expect((await t.call(`/api/pages/${pageId}`, { method: "PUT", token: editor, json: { source: "Gone.", baseRevisionId: revisionId } })).status).toBe(404);
    // Nor through MCP.
    expect((await tool(editor, "list_spaces", {})).text).not.toContain("infra");
    expect((await tool(editor, "search", { query: "wireguard" })).text).not.toContain("tunnel");
    expect((await tool(editor, "get_page", { space: "infra", path: "tunnel" })).isError).toBe(true);
    // Outsiders are sent to sign in.
    expect((await t.call("/s/infra/tunnel")).headers.get("location")).toMatch(/^\/login/);
  });

  it("opens to people an owner adds, and closes again when they're removed", async () => {
    const grace = await userId("grace@example.com");
    expect((await t.call(`/api/spaces/infra/members/${grace}`, { method: "PUT", token: t.ownerToken })).status).toBe(204);

    const { members } = await (await t.call("/api/spaces/infra/members", { token: t.ownerToken })).json();
    expect(members.map((m: { email: string; always: boolean }) => [m.email, m.always])).toEqual([
      ["owner@example.com", true],
      ["grace@example.com", false],
    ]);
    expect((await t.call(`/api/pages/${pageId}`, { token: editor })).status).toBe(200);
    expect((await (await t.call("/api/search?q=wireguard", { token: editor })).json()).length).toBe(1);
    expect((await tool(editor, "get_page", { space: "infra", path: "tunnel" })).text).toContain("wireguard");
    expect((await t.call("/api/spaces/infra/pages", { method: "POST", token: editor, json: { path: "dns", source: "---\ntitle: DNS\n---\nResolvers." } })).status).toBe(201);

    expect((await t.call(`/api/spaces/infra/members/${grace}`, { method: "DELETE", token: t.ownerToken })).status).toBe(204);
    expect((await t.call(`/api/pages/${pageId}`, { token: editor })).status).toBe(404);
  });

  it("drops someone from every private space when they leave the workspace", async () => {
    const grace = await userId("grace@example.com");
    await t.call(`/api/spaces/infra/members/${grace}`, { method: "PUT", token: t.ownerToken });
    expect((await t.call(`/api/members/${grace}`, { method: "DELETE", token: t.ownerToken })).status).toBe(204);
    expect(await t.db.select().from(schema.spaceMembers)).toEqual([]);
    expect((await t.call(`/api/pages/${pageId}`, { token: editor })).status).toBe(403);
  });

  it("only lets owners manage members, and only of private spaces and people in the workspace", async () => {
    const admin = await t.addMember("linus@example.com", "admin");
    const grace = await userId("grace@example.com");
    expect((await t.call("/api/spaces/infra/members", { token: admin })).status).toBe(403);
    expect((await t.call(`/api/spaces/infra/members/${grace}`, { method: "PUT", token: admin })).status).toBe(403);
    expect((await t.call(`/api/spaces/eng/members/${grace}`, { method: "PUT", token: t.ownerToken })).status).toBe(400);
    expect((await t.call("/api/spaces/infra/members/usr_nobody", { method: "PUT", token: t.ownerToken })).status).toBe(404);
    expect((await t.call(`/api/spaces/infra/members/${await userId("owner@example.com")}`, { method: "DELETE", token: t.ownerToken })).status).toBe(409);

    // An admin who makes a private space can read it; other members can't.
    expect((await t.call("/api/spaces", { method: "POST", token: admin, json: { slug: "ops", name: "Ops", visibility: "private" } })).status).toBe(201);
    expect((await t.call("/api/spaces/ops/tree", { token: admin })).status).toBe(200);
    expect((await t.call("/api/spaces/ops/tree", { token: editor })).status).toBe(404);
    expect((await t.call("/api/spaces/ops/tree", { token: t.ownerToken })).status).toBe(200);
  });

  it("can't feed a public website", async () => {
    const res = await t.call("/api/sites", { method: "POST", token: t.ownerToken, json: { slug: "tunnel", name: "Tunnel", space: "infra" } });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("private space");
  });
});
