import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AiProvider, AiRequest } from "../src/services/ai.js";
import { SITES_DOMAIN, setup } from "./helpers.js";

const SHA = "beef".padEnd(40, "0");
const TREE = [
  { path: "README.md", type: "blob", size: 100 },
  { path: "src/index.ts", type: "blob", size: 100 },
];
const FILES: Record<string, string> = { "README.md": "# Rocket\nLaunch services.\n", "src/index.ts": "export const launch = () => 1;\n" };

const github: typeof fetch = async (input) => {
  const p = new URL(String(input)).pathname;
  if (p === "/repos/acme/rocket") return Response.json({ full_name: "acme/rocket", html_url: "https://github.com/acme/rocket", description: "Launch services", default_branch: "main", stargazers_count: 9, forks_count: 1, language: "TypeScript", license: null, topics: [], private: false });
  if (p === "/repos/acme/rocket/releases/latest") return new Response("none", { status: 404 });
  if (p === "/repos/acme/rocket/branches/main") return Response.json({ commit: { sha: SHA } });
  if (p.startsWith("/repos/acme/rocket/git/trees/")) return Response.json({ sha: "t", tree: TREE, truncated: false });
  const file = p.match(/^\/repos\/acme\/rocket\/contents\/(.+)$/);
  if (file && FILES[decodeURIComponent(file[1]!)] !== undefined) return new Response(FILES[decodeURIComponent(file[1]!)]);
  return new Response("nope", { status: 404 });
};

let requests: AiRequest[];
const fakeAi: AiProvider = () => ({
  async json<T>(req: AiRequest) {
    requests.push(req);
    return {
      summary: "Orbiting rocket design",
      files: [
        { path: "pages/index.html", content: "---\ntitle: Rocket\n---\n<h1 class=\"big\">Rocket launches services</h1>" },
        { path: "scripts/rocket.js", content: 'import * as THREE from "three";' },
      ],
      docs: [
        { path: "getting-started", source: "---\ntitle: Getting started\nsummary: Launch one.\n---\n\nRun `launch()`.\n" },
        { path: "../bad", source: "x" },
      ],
    } as T;
  },
});

let t: Awaited<ReturnType<typeof setup>>;
let id = 0;

beforeEach(async () => {
  requests = [];
  t = await setup({ fetch: github, ai: fakeAi });
  await t.call("/api/spaces", { method: "POST", token: t.ownerToken, json: { slug: "rocket-docs", name: "Rocket docs", visibility: "public" } });
});
afterEach(() => t.close());

async function rpc(method: string, params: unknown = {}) {
  const res = await t.call("/mcp", { method: "POST", token: t.ownerToken, headers: { Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" }, json: { jsonrpc: "2.0", id: ++id, method, params } });
  return (await res.json()) as { result: { content: { text: string }[]; isError?: boolean; tools?: { name: string }[]; prompts?: { name: string }[] } };
}
const tool = async (name: string, args: Record<string, unknown>) => {
  const r = await rpc("tools/call", { name, arguments: args });
  return { text: r.result.content[0]!.text, isError: Boolean(r.result.isError) };
};

describe("designing sites over MCP", () => {
  it("lists the site tools and the design_site prompt", async () => {
    const tools = (await rpc("tools/list")).result.tools!.map((x) => x.name);
    expect(tools).toEqual(expect.arrayContaining(["list_sites", "get_site_design_guide", "get_site", "read_site_file", "create_site", "propose_site_changes", "preview_site"]));
    expect(tools).not.toContain("publish_site");
    expect((await rpc("prompts/list")).result.prompts!.map((p) => p.name)).toContain("design_site");
    expect((await tool("get_site_design_guide", {})).text).toContain("three/addons/controls/OrbitControls.js");
  });

  it("creates a site, proposes a redesign with a preview, and leaves publishing to a person", async () => {
    const created = JSON.parse((await tool("create_site", { site: "rocket", name: "Rocket", space: "rocket-docs", repo: "acme/rocket" })).text) as { preview: string; studio: string };
    expect(created.preview).toMatch(new RegExp(`^https://rocket--[0-9a-f]{16}\\.${SITES_DOMAIN.replace(/\./g, "\\.")}$`));
    expect(created.studio).toBe("https://docs.example.com/app/sites/rocket");

    const read = await tool("read_site_file", { site: "rocket", path: "styles/site.css" });
    expect(read.text).toContain("--accent");

    const proposed = JSON.parse(
      (await tool("propose_site_changes", { site: "rocket", summary: "Orange rocket theme", files: [{ path: "styles/site.css", content: ":root{--accent:#f97316}" }, { path: "pages/broken.html", content: "{% for %}" }] })).text,
    ) as { changeSet: string; review: string; preview: string; diagnostics: { file?: string; message: string }[] };
    expect(proposed.review).toContain(`?changeset=${proposed.changeSet}`);
    expect(proposed.diagnostics.some((d) => d.file === "pages/broken.html")).toBe(true);
    // The preview shows the change; the draft doesn't have it until someone applies it.
    expect(await (await t.app.request(`${proposed.preview}/styles/site.css`)).text()).toBe(":root{--accent:#f97316}");
    expect((await tool("read_site_file", { site: "rocket", path: "styles/site.css" })).text).not.toContain("#f97316");

    const site = JSON.parse((await tool("get_site", { site: "rocket" })).text) as { openChangeSets: { id: string }[]; docsSpace: string; published: boolean };
    expect(site.openChangeSets.map((c) => c.id)).toEqual([proposed.changeSet]);
    expect(site.docsSpace).toBe("rocket-docs");
    expect(site.published).toBe(false);
  });

  it("refuses paths outside the site folders", async () => {
    await tool("create_site", { site: "rocket", name: "Rocket" });
    const bad = await tool("propose_site_changes", { site: "rocket", summary: "x", files: [{ path: "secrets/.env", content: "x" }] });
    expect(bad.isError).toBe(true);
  });
});

describe("Claude builds the site from the repo", () => {
  it("needs a Claude key", async () => {
    await t.call("/api/sites", { method: "POST", token: t.ownerToken, json: { slug: "rocket", name: "Rocket", space: "rocket-docs", repo: "acme/rocket" } });
    const res = await t.call("/api/sites/rocket/generate", { method: "POST", token: t.ownerToken, json: {} });
    expect(res.status).toBe(400);
  });

  it("reads the repo, proposes the design as a change set and drafts the docs", async () => {
    await t.call("/api/ai/key", { method: "PUT", token: t.ownerToken, json: { apiKey: "sk-ant-api03-test-key-0000000000wxyz" } });
    await t.call("/api/sites", { method: "POST", token: t.ownerToken, json: { slug: "rocket", name: "Rocket", space: "rocket-docs", repo: "acme/rocket" } });
    const start = await t.call("/api/sites/rocket/generate", { method: "POST", token: t.ownerToken, json: { brief: "Space-age, orange." } });
    expect(start.status).toBe(202);
    const { id: job } = (await start.json()) as { id: string };
    await t.settle();
    const done = (await (await t.call(`/api/sites/rocket/generate/${job}`, { token: t.ownerToken })).json()) as { status: string; result: { changeset: string; docs: string[]; preview: string } };
    expect(done.status).toBe("done");
    expect(done.result.docs).toEqual(["getting-started"]);
    expect(requests[0]!.prompt).toContain("Space-age, orange.");
    expect(requests[0]!.prompt).toContain('<file path="README.md">');
    expect(requests[0]!.prompt).toContain('<site-file path="scripts/scene.js">');
    expect(requests[0]!.system).toContain("Designing an Elemnt project website");
    const review = (await (await t.call(`/api/sites/rocket/changesets/${done.result.changeset}`, { token: t.ownerToken })).json()) as { source: string; files: { path: string }[] };
    expect(review.source).toBe("generate");
    expect(review.files.map((f) => f.path)).toEqual(["pages/index.html", "scripts/rocket.js"]);
    expect(await (await t.app.request(done.result.preview + "/")).text()).toContain("Rocket launches services");
  });
});
