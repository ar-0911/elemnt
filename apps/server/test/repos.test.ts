import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AiProvider, AiRequest } from "../src/services/ai.js";
import { citedInSource, relevant } from "../src/services/repos.js";
import { normalizeRepo } from "../src/services/github.js";
import { setup } from "./helpers.js";

const PINNED = "a".repeat(40);
const HEAD = "b".repeat(40);
const SOURCE = `---\ntitle: Acme API explained\n---\nThe server starts in [src/server.ts](https://github.com/acme/api/blob/${PINNED}/src/server.ts).\n\nRun \`npm start\` on port 3000.\n`;

let t: Awaited<ReturnType<typeof setup>>;
let pageId: string;
let files: { filename: string; status: string; patch?: string }[];
let aiRequest: AiRequest | undefined;
let ghCalls: string[];

const github: typeof fetch = async (input) => {
  const url = String(input);
  ghCalls.push(url.replace("https://api.github.com", ""));
  if (url.endsWith("/repos/acme/api")) return Response.json({ default_branch: "main" });
  if (url.includes("/branches/main")) return Response.json({ commit: { sha: PINNED } });
  if (url.includes("/compare/")) return Response.json({ ahead_by: 3, commits: [{ sha: "c".repeat(40) }, { sha: HEAD }], files });
  return new Response("nope", { status: 404 });
};

const fakeAi: AiProvider = () => ({
  async json<T>(req: AiRequest) {
    aiRequest = req;
    return { replacement: SOURCE.replace("port 3000", "port 8080").replaceAll(PINNED, HEAD), summary: "Port moved to 8080" } as T;
  },
});

beforeEach(async () => {
  files = [];
  ghCalls = [];
  aiRequest = undefined;
  t = await setup({ fetch: github, ai: fakeAi, github: { webhookSecret: "whsec" } });
  await t.call("/api/spaces", { method: "POST", token: t.ownerToken, json: { slug: "oss", name: "OSS", visibility: "public" } });
  const res = await t.call("/api/spaces/oss/pages", { method: "POST", token: t.ownerToken, json: { path: "acme-api", source: SOURCE } });
  ({ pageId } = (await res.json()) as { pageId: string });
});
afterEach(() => t.close());

const link = () => t.call(`/api/pages/${pageId}/repo`, { method: "PUT", token: t.ownerToken, json: { repo: "https://github.com/Acme/API.git" } });
const setKey = () => t.call("/api/ai/key", { method: "PUT", token: t.ownerToken, json: { apiKey: "sk-ant-api03-test-key-0000000000wxyz" } });

describe("helpers", () => {
  it("normalizes repos and finds cited paths", () => {
    expect(normalizeRepo("https://github.com/Acme/API/tree/main/src")).toBe("acme/api");
    expect(citedInSource(SOURCE, "acme/api")).toEqual(["src/server.ts"]);
    expect(relevant("src/server.ts", ["src/server.ts"])).toBe(true);
    expect(relevant("src/lib/x.ts", ["src/lib"])).toBe(true);
    expect(relevant("src/library.ts", ["src/lib"])).toBe(false);
    expect(relevant("README.md", [])).toBe(true);
  });
});

describe("linking", () => {
  it("pins the branch head and gives a README badge and short URL", async () => {
    const res = await link();
    const body = (await res.json()) as { link: { repo: string; pinnedCommit: string; branch: string }; badge: string; shortUrl: string };
    expect(body.link).toMatchObject({ repo: "acme/api", pinnedCommit: PINNED, branch: "main" });
    expect(body.shortUrl).toBe("https://docs.example.com/r/acme/api");
    expect(body.badge).toContain("/r/acme/api/badge.svg");

    const redirect = await t.call("/r/acme/api");
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("/s/oss/acme-api?utm_source=readme");
    const badge = await t.call("/r/acme/api/badge.svg");
    expect(badge.headers.get("content-type")).toBe("image/svg+xml");
    // An SVG opened directly is a document that could run script, so it gets a CSP that forbids it.
    expect(badge.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(badge.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await t.call("/r/other/repo")).status).toBe(404);

    const page = await (await t.call("/s/oss/acme-api")).text();
    expect(page).toContain("written against");
    expect(page).toContain("up to date");
  });
});

describe("drift check", () => {
  it("is current when no cited file changed", async () => {
    await link();
    files = [{ filename: "docs/other.md", status: "modified", patch: "@@" }];
    const out = await (await t.call(`/api/pages/${pageId}/repo/check`, { method: "POST", token: t.ownerToken })).json();
    expect(out).toEqual({ status: "current", behindBy: 3 });
  });

  it("opens one suggestion from Claude when cited files change, and accepting it re-pins the page", async () => {
    await setKey();
    await link();
    files = [{ filename: "src/server.ts", status: "modified", patch: "-listen(3000)\n+listen(8080)" }];
    const out = (await (await t.call(`/api/pages/${pageId}/repo/check`, { method: "POST", token: t.ownerToken })).json()) as { status: string; suggestionId: string; changedPaths: string[] };
    expect(out).toMatchObject({ status: "suggested", changedPaths: ["src/server.ts"] });
    expect(aiRequest?.prompt).toContain("+listen(8080)");
    expect(aiRequest?.prompt).toContain("acme/api");

    // A second check doesn't pile up suggestions.
    expect(((await (await t.call(`/api/pages/${pageId}/repo/check`, { method: "POST", token: t.ownerToken })).json()) as { status: string }).status).toBe("unchanged");

    const banner = await (await t.call("/s/oss/acme-api")).text();
    expect(banner).toContain("3 commits behind");

    const { suggestion: sug } = (await (await t.call(`/api/suggestions/${out.suggestionId}`, { token: t.ownerToken })).json()) as { suggestion: { summary: string } };
    expect(sug.summary).toContain("aaaaaaa→bbbbbbb");
    expect((await t.call(`/api/suggestions/${out.suggestionId}/accept`, { method: "POST", token: t.ownerToken, json: {} })).status).toBe(200);
    const { link: after } = (await (await t.call(`/api/pages/${pageId}/repo`, { token: t.ownerToken })).json()) as { link: { pinnedCommit: string; behindBy: number } };
    expect(after).toMatchObject({ pinnedCommit: HEAD, behindBy: 0 });
  });

  it("leaves a comment instead when the workspace has no Claude key", async () => {
    await link();
    files = [{ filename: "src/server.ts", status: "modified", patch: "x" }];
    const out = (await (await t.call(`/api/pages/${pageId}/repo/check`, { method: "POST", token: t.ownerToken })).json()) as { status: string };
    expect(out.status).toBe("commented");
    const comments = (await (await t.call(`/api/pages/${pageId}/comments`, { token: t.ownerToken })).json()) as { body: string }[];
    expect(comments[0]!.body).toContain("src/server.ts");
  });

  it("runs from a signed GitHub push webhook, and only for the linked branch", async () => {
    await setKey();
    await link();
    files = [{ filename: "src/server.ts", status: "modified", patch: "x" }];
    const send = (body: object, secret = "whsec") => {
      const raw = JSON.stringify(body);
      return t.call("/integrations/github/webhook", {
        method: "POST",
        headers: { "x-github-event": "push", "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`, "content-type": "application/json" },
        body: raw,
      });
    };
    expect((await send({ ref: "refs/heads/main", repository: { full_name: "Acme/api" } }, "wrong")).status).toBe(401);
    expect(await (await send({ ref: "refs/heads/dev", repository: { full_name: "acme/api" } })).json()).toEqual({ checking: 0 });
    const res = await send({ ref: "refs/heads/main", repository: { full_name: "Acme/api" } });
    expect(res.status).toBe(202);
    await t.settle();
    const list = (await (await t.call(`/api/pages/${pageId}/suggestions`, { token: t.ownerToken })).json()) as { origin: string }[];
    expect(list.map((s) => s.origin)).toEqual(["drift"]);
  });
});
