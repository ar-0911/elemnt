import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setup } from "./helpers.js";

let t: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  t = await setup();
  await t.call("/api/spaces", { method: "POST", token: t.ownerToken, json: { slug: "docs", name: "Docs", visibility: "workspace" } });
  await t.call("/api/spaces/docs/pages", { method: "POST", token: t.ownerToken, json: { path: "deploy", source: "---\ntitle: Deploying\n---\nShip with the canary pipeline.\n\nRoll back by reverting the tag." } });
});
afterEach(() => t.close());

let id = 0;
async function rpc(token: string | undefined, method: string, params: unknown = {}) {
  const res = await t.call("/mcp", {
    method: "POST",
    ...(token ? { token } : {}),
    headers: { Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" },
    json: { jsonrpc: "2.0", id: ++id, method, params },
  });
  return { status: res.status, headers: res.headers, body: res.status === 200 ? await res.json() : await res.text() };
}
const callTool = async (token: string, name: string, args: Record<string, unknown>) => {
  const r = await rpc(token, "tools/call", { name, arguments: args });
  const result = r.body.result as { content: { text: string }[]; isError?: boolean };
  return { text: result.content[0]!.text, isError: Boolean(result.isError) };
};

describe("MCP server", () => {
  it("asks unauthenticated clients to use OAuth", async () => {
    const r = await rpc(undefined, "initialize");
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain("/.well-known/oauth-protected-resource");
  });

  it("initializes and lists the tools for an editor", async () => {
    const init = await rpc(t.ownerToken, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.body.result.serverInfo.name).toBe("elemnt");
    expect(init.body.result.instructions).toMatch(/suggest_edit/);
    const tools = (await rpc(t.ownerToken, "tools/list")).body.result.tools.map((x: { name: string }) => x.name);
    expect(tools).toEqual(expect.arrayContaining(["search", "get_page", "list_pages", "get_authoring_guide", "validate", "create_draft", "suggest_edit", "add_comment"]));
  });

  it("offers a generate_docs prompt", async () => {
    const prompts = (await rpc(t.ownerToken, "prompts/list")).body.result.prompts.map((x: { name: string }) => x.name);
    expect(prompts).toContain("generate_docs");
    const got = await rpc(t.ownerToken, "prompts/get", { name: "generate_docs", arguments: { topic: "deploys" } });
    expect(got.body.result.messages[0].content.text).toContain("Write Elemnt documentation about: deploys.");
  });

  it("hides write tools from viewers", async () => {
    const viewer = await t.addMember("v@example.com", "viewer");
    const tools = (await rpc(viewer, "tools/list")).body.result.tools.map((x: { name: string }) => x.name);
    expect(tools).not.toContain("suggest_edit");
    expect(tools).not.toContain("create_draft");
  });

  it("reads, searches and validates", async () => {
    expect((await callTool(t.ownerToken, "get_page", { space: "docs", path: "deploy" })).text).toContain("canary pipeline");
    expect((await callTool(t.ownerToken, "search", { query: "canary" })).text).toContain('"path": "deploy"');
    const bad = await callTool(t.ownerToken, "validate", { source: ":::callout{type=nope}\nx\n:::" });
    expect(JSON.parse(bad.text).ok).toBe(false);
    expect((await callTool(t.ownerToken, "get_authoring_guide", {})).text).toContain(":::tabs");
    expect((await callTool(t.ownerToken, "get_page", { space: "docs", path: "missing" })).isError).toBe(true);
  });

  it("hands runbooks to agents as structured steps", async () => {
    const source = '---\ntitle: Rotate\n---\n::::runbook{id=rotate}\n:::step[Create key]\n```sh\nacme keys create\n```\n:::\n:::step[Revoke old]{gate=approve expect="revoked"}\n```sh\nacme keys revoke old\n```\n:::\n::::\n';
    await t.call("/api/spaces/docs/pages", { method: "POST", token: t.ownerToken, json: { path: "rotate", source } });
    const book = JSON.parse((await callTool(t.ownerToken, "get_runbook", { space: "docs", path: "rotate", id: "rotate" })).text);
    expect(book.steps.map((s: { title: string; gate: string }) => [s.title, s.gate])).toEqual([["Create key", "none"], ["Revoke old", "approve"]]);
    expect(book.steps[1].commands).toEqual([{ lang: "sh", code: "acme keys revoke old" }]);
    expect((await callTool(t.ownerToken, "get_runbook", { space: "docs", path: "rotate", id: "nope" })).text).toContain("Runbooks on this page: rotate");
  });

  it("writes only drafts and suggestions", async () => {
    const draft = JSON.parse((await callTool(t.ownerToken, "create_draft", { space: "docs", path: "new-guide", source: "---\ntitle: New\n---\nHello." })).text);
    expect(draft.review).toBe("https://docs.example.com/app/docs/new-guide");
    const tree = await (await t.call("/api/spaces/docs/tree", { token: t.ownerToken })).json();
    expect(tree.pages.find((p: { path: string }) => p.path === "new-guide")).toMatchObject({ published: false });

    const sug = JSON.parse((await callTool(t.ownerToken, "suggest_edit", { space: "docs", path: "deploy", summary: "Mention the dashboard", edits: [{ find: "canary pipeline.", replace: "canary pipeline. Watch the dashboard." }] })).text);
    expect(sug.review).toContain("?suggestion=sug_");
    expect((await callTool(t.ownerToken, "get_page", { space: "docs", path: "deploy" })).text).not.toContain("dashboard");
    const detail = await (await t.call(`/api/suggestions/${sug.suggestionId}`, { token: t.ownerToken })).json();
    expect(detail.suggestion.origin).toBe("mcp");

    const ambiguous = await callTool(t.ownerToken, "suggest_edit", { space: "docs", path: "deploy", summary: "x", edits: [{ find: "the", replace: "a" }] });
    expect(ambiguous.isError).toBe(true);
  });
});

describe("OAuth for MCP clients", () => {
  it("registers, authorizes with PKCE, and issues a token that works on /mcp", async () => {
    const meta = await (await t.call("/.well-known/oauth-authorization-server")).json();
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);

    const reg = await (await t.call("/oauth/register", { method: "POST", json: { client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] } })).json();
    expect(reg.client_id).toMatch(/^oac_/);
    expect((await t.call("/oauth/register", { method: "POST", json: { redirect_uris: ["http://evil.example.com/cb"] } })).status).toBe(400);

    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", code_challenge: challenge, code_challenge_method: "S256", state: "xyz" });

    // Not signed in: sent to the login page, which comes back here.
    const anon = await t.call(`/oauth/authorize?${q}`);
    expect(anon.status).toBe(302);
    expect(anon.headers.get("location")).toMatch(/^\/login\?next=%2Foauth%2Fauthorize/);

    const consent = await t.call(`/oauth/authorize?${q}`, { token: t.ownerToken });
    expect(await consent.text()).toContain("Connect Claude to Elemnt?");

    const form = new URLSearchParams({ ...Object.fromEntries(q), decision: "allow" });
    const approved = await t.call("/oauth/authorize", { method: "POST", token: t.ownerToken, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
    const back = new URL(approved.headers.get("location")!);
    expect(back.origin + back.pathname).toBe("https://claude.ai/api/mcp/auth_callback");
    expect(back.searchParams.get("state")).toBe("xyz");
    const code = back.searchParams.get("code")!;

    const tokenReq = (verifierToSend: string) =>
      t.call("/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifierToSend, client_id: reg.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback" }).toString(),
      });
    const tok = await (await tokenReq(verifier)).json();
    expect(tok.token_type).toBe("Bearer");
    // Codes are single use.
    expect((await tokenReq(verifier)).status).toBe(400);

    const listed = await rpc(tok.access_token, "tools/list");
    expect(listed.status).toBe(200);
  });

  it("rejects a wrong PKCE verifier", async () => {
    const reg = await (await t.call("/oauth/register", { method: "POST", json: { redirect_uris: ["http://localhost:3333/cb"] } })).json();
    const challenge = createHash("sha256").update("right-verifier-right-verifier-right-verifier").digest("base64url");
    const form = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: "http://localhost:3333/cb", code_challenge: challenge, code_challenge_method: "S256", decision: "allow" });
    const approved = await t.call("/oauth/authorize", { method: "POST", token: t.ownerToken, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
    const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
    const res = await t.call("/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: "wrong-verifier-wrong-verifier-wrong-verifier", client_id: reg.client_id }).toString() });
    expect((await res.json()).error).toBe("invalid_grant");
  });
});
