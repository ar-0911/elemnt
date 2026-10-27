import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AiProvider, AiRequest } from "../src/services/ai.js";
import { outline, pickFiles } from "../src/services/explain.js";
import { citedInSource } from "../src/services/repos.js";
import { readmeCard, wrap } from "../src/render/card.js";
import { setup } from "./helpers.js";

const SHA = "c0ffee".padEnd(40, "0");

const TREE = [
  { path: "README.md", type: "blob", size: 900 },
  { path: "package.json", type: "blob", size: 300 },
  { path: "pnpm-lock.yaml", type: "blob", size: 90_000 },
  { path: "src", type: "tree" },
  { path: "src/index.ts", type: "blob", size: 400 },
  { path: "src/router.ts", type: "blob", size: 2000 },
  { path: "src/router.test.ts", type: "blob", size: 2000 },
  { path: "node_modules/x/index.js", type: "blob", size: 10 },
  { path: "logo.png", type: "blob", size: 5000 },
];

const FILES: Record<string, string> = {
  "README.md": "# Router\nA tiny router.\n",
  "package.json": '{"name":"router","scripts":{"start":"node dist/index.js"}}',
  "src/index.ts": "export * from './router';\n",
  "src/router.ts": "export function route() {}\n",
  "src/router.test.ts": "test('x', () => {})\n",
};

let t: Awaited<ReturnType<typeof setup>>;
let requests: AiRequest[];
let privateRepo: boolean;
let ghCalls: string[];

const github: typeof fetch = async (input) => {
  const url = new URL(String(input));
  ghCalls.push(url.pathname + url.search);
  const p = url.pathname;
  if (p === "/repos/acme/router") return Response.json({ full_name: "acme/router", html_url: "https://github.com/acme/router", description: "A tiny router", default_branch: "main", stargazers_count: 1234, forks_count: 56, language: "TypeScript", license: { spdx_id: "MIT" }, topics: ["http"], private: privateRepo });
  if (p === "/repos/acme/router/releases/latest") return Response.json({ tag_name: "v1.2.0", html_url: "https://github.com/acme/router/releases/v1.2.0" });
  if (p === "/repos/acme/router/branches/main") return Response.json({ commit: { sha: SHA } });
  if (p === `/repos/acme/router/git/trees/${SHA}` || p === "/repos/acme/router/git/trees/main") return Response.json({ sha: "tree123", tree: TREE, truncated: false });
  const file = p.match(/^\/repos\/acme\/router\/contents\/(.+)$/);
  if (file && FILES[decodeURIComponent(file[1]!)] !== undefined) return new Response(FILES[decodeURIComponent(file[1]!)]);
  return new Response("nope", { status: 404 });
};

const PAGE = `---
title: "Router: a tiny HTTP router"
summary: Match paths to handlers in 40 lines.
---

::repo{repo="acme/router"}

## A tour of the code

::snippet{repo="acme/router" ref="${SHA}" path="src/router.ts" lines="1-1"}
`;

const fakeAi: AiProvider = () => ({
  async json<T>(req: AiRequest) {
    requests.push(req);
    return { source: PAGE, citedPaths: ["src/router.ts", "src/", "made/up.ts"] } as T;
  },
});

beforeEach(async () => {
  requests = [];
  ghCalls = [];
  privateRepo = false;
  t = await setup({ fetch: github, ai: fakeAi });
  await t.call("/api/spaces", { method: "POST", token: t.ownerToken, json: { slug: "oss", name: "OSS", visibility: "public" } });
});
afterEach(() => t.close());

const setKey = () => t.call("/api/ai/key", { method: "PUT", token: t.ownerToken, json: { apiKey: "sk-ant-api03-test-key-0000000000wxyz" } });

describe("choosing what to read", () => {
  it("reads the README, manifests and entry points first, and skips locks, vendored code and binaries", () => {
    const picked = pickFiles(TREE as never);
    expect(picked.slice(0, 3)).toEqual(["README.md", "package.json", "src/index.ts"]);
    expect(picked).not.toContain("pnpm-lock.yaml");
    expect(picked).not.toContain("node_modules/x/index.js");
    expect(picked).not.toContain("logo.png");
    expect(picked.indexOf("src/router.ts")).toBeLessThan(picked.indexOf("src/router.test.ts"));
    expect(outline(TREE as never)).toContain("  router.ts");
    expect(outline(TREE as never)).not.toContain("node_modules");
  });
});

describe("explain a repo", () => {
  it("needs a Claude key", async () => {
    const res = await t.call("/api/explain", { method: "POST", token: t.ownerToken, json: { repo: "acme/router", space: "oss" } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("Claude Code");
  });

  it("drafts a page from the repo, pinned to the commit it read, linked for drift checks", async () => {
    await setKey();
    const start = await t.call("/api/explain", { method: "POST", token: t.ownerToken, json: { repo: "https://github.com/Acme/Router", space: "oss" } });
    expect(start.status).toBe(202);
    const { id } = (await start.json()) as { id: string };
    await t.settle();
    const job = (await (await t.call(`/api/explain/${id}`, { token: t.ownerToken })).json()) as { status: string; result: { pageId: string; path: string; commit: string; citedPaths: string[]; editUrl: string; card: string } };
    expect(job.status).toBe("done");
    expect(job.result).toMatchObject({ path: "router", commit: SHA, citedPaths: ["src/router.ts", "src"], editUrl: "https://docs.example.com/app/oss/router" });
    expect(job.result.card).toContain("/r/acme/router/card.svg?theme=dark");

    const prompt = requests[0]!.prompt;
    expect(prompt).toContain('<file path="README.md">');
    expect(prompt).toContain(`Commit read: ${SHA}`);
    expect(prompt).not.toContain('<file path="pnpm-lock.yaml">');
    expect(ghCalls.some((c) => c.includes(`ref=${SHA}`))).toBe(true);

    const { link } = (await (await t.call(`/api/pages/${job.result.pageId}/repo`, { token: t.ownerToken })).json()) as { link: { repo: string; pinnedCommit: string } };
    expect(link).toMatchObject({ repo: "acme/router", pinnedCommit: SHA });

    // A second explainer for the same repo gets its own path, and only the person who started a job can read it.
    const again = (await (await t.call("/api/explain", { method: "POST", token: t.ownerToken, json: { repo: "acme/router", space: "oss" } })).json()) as { id: string };
    await t.settle();
    const second = (await (await t.call(`/api/explain/${again.id}`, { token: t.ownerToken })).json()) as { result: { path: string } };
    expect(second.result.path).toBe("router-2");
    const editor = await t.addMember("ed@example.com", "editor");
    expect((await t.call(`/api/explain/${id}`, { token: editor })).status).toBe(404);
  });

  it("is for editors only", async () => {
    const viewer = await t.addMember("v@example.com", "viewer");
    expect((await t.call("/api/explain", { method: "POST", token: viewer, json: { repo: "acme/router", space: "oss" } })).status).toBe(403);
  });
});

describe("GitHub data for readers", () => {
  it("serves repo facts, the tree and files of public repos to anyone", async () => {
    const info = (await (await t.call("/api/github/acme/router")).json()) as { stars: number; license: string; latestRelease: { tag: string } };
    expect(info).toMatchObject({ stars: 1234, license: "MIT", latestRelease: { tag: "v1.2.0" } });
    const tree = (await (await t.call(`/api/github/acme/router/tree?ref=${SHA}`)).json()) as { entries: { path: string }[] };
    expect(tree.entries.map((e) => e.path)).toContain("src/router.ts");
    const file = (await (await t.call(`/api/github/acme/router/file?ref=${SHA}&path=src/router.ts`)).json()) as { text: string };
    expect(file.text).toContain("route()");
    expect((await t.call(`/api/github/acme/router/file?ref=${SHA}&path=../secrets`)).status).toBe(400);

    // Cached: a second read of the same commit doesn't go back to GitHub.
    const before = ghCalls.length;
    await t.call(`/api/github/acme/router/file?ref=${SHA}&path=src/router.ts`);
    expect(ghCalls.length).toBe(before);
  });

  it("never serves a private repo to the public, nor to members unless a page here explains it", async () => {
    privateRepo = true;
    expect((await t.call("/api/github/acme/router")).status).toBe(404);
    expect((await t.call("/api/github/acme/router", { token: t.ownerToken })).status).toBe(404);
    const res = await t.call("/api/spaces/oss/pages", { method: "POST", token: t.ownerToken, json: { path: "router", source: PAGE } });
    const { pageId } = (await res.json()) as { pageId: string };
    await t.call(`/api/pages/${pageId}/repo`, { method: "PUT", token: t.ownerToken, json: { repo: "acme/router" } });
    expect((await t.call("/api/github/acme/router", { token: t.ownerToken })).status).toBe(200);
    expect((await t.call("/api/github/acme/router")).status).toBe(404);
  });
});

describe("README card and sync", () => {
  it("shows the published explainer's title and summary, in light or dark", async () => {
    const res = await t.call("/api/spaces/oss/pages", { method: "POST", token: t.ownerToken, json: { path: "router", source: PAGE } });
    const { pageId } = (await res.json()) as { pageId: string };
    await t.call(`/api/pages/${pageId}/repo`, { method: "PUT", token: t.ownerToken, json: { repo: "acme/router" } });
    const card = await t.call("/r/acme/router/card.svg?theme=dark");
    expect(card.headers.get("content-type")).toBe("image/svg+xml");
    const svg = await card.text();
    expect(svg).toContain("Router: a tiny HTTP router");
    expect(svg).toContain("Match paths to handlers");
    expect(svg).toContain("#0d1117");
    // Unknown repos still get a card, so a README never shows a broken image.
    expect(await (await t.call("/r/nobody/nothing/card.svg")).text()).toContain("nobody/nothing");
  });

  it("re-checks linked pages when the GitHub Action calls sync", async () => {
    const res = await t.call("/api/spaces/oss/pages", { method: "POST", token: t.ownerToken, json: { path: "router", source: PAGE } });
    const { pageId } = (await res.json()) as { pageId: string };
    await t.call(`/api/pages/${pageId}/repo`, { method: "PUT", token: t.ownerToken, json: { repo: "acme/router" } });
    expect((await t.call("/api/repos/acme/router/sync", { method: "POST", json: { branch: "main" } })).status).toBe(401);
    const sync = await t.call("/api/repos/Acme/Router/sync", { method: "POST", token: t.ownerToken, json: { branch: "main" } });
    expect(sync.status).toBe(202);
    expect(((await sync.json()) as { checking: number }).checking).toBe(1);
    expect(((await (await t.call("/api/repos/acme/router/sync", { method: "POST", token: t.ownerToken, json: { branch: "dev" } })).json()) as { checking: number }).checking).toBe(0);
    await t.settle();
  });
});

describe("helpers", () => {
  it("counts ::snippet and ::filetree paths as cited", () => {
    expect(citedInSource(PAGE, "acme/router")).toEqual(["src/router.ts"]);
    expect(citedInSource(PAGE, "other/repo")).toEqual([]);
  });
  it("wraps and escapes card text", () => {
    expect(wrap("one two three four five", 9, 2)).toEqual(["one two", "three…"]);
    expect(readmeCard({ repo: "a/b", title: "<script>" })).toContain("&lt;script&gt;");
  });
});
