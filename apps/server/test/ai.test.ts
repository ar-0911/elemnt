import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AiProvider, AiRequest } from "../src/services/ai.js";
import { setup } from "./helpers.js";

const SOURCE = "---\ntitle: Guide\n---\n## Install\n\nRun the installer.\n\n## Deploy\n\nDeploy with the canary pipeline.\n\n## Rollback\n\nRevert the tag.\n";

let t: Awaited<ReturnType<typeof setup>>;
let pageId: string;
let rev1: string;
let lastRequest: AiRequest | undefined;
let lastKey: string | undefined;
let reply: { replacement: string; summary: string };

const fakeAi: AiProvider = (key) => ({
  async json<T>(req: AiRequest) {
    lastKey = key;
    lastRequest = req;
    return reply as T;
  },
});

beforeEach(async () => {
  t = await setup({ ai: fakeAi });
  await t.call("/api/spaces", { method: "POST", token: t.ownerToken, json: { slug: "pub", name: "Pub", visibility: "public" } });
  const res = await t.call("/api/spaces/pub/pages", { method: "POST", token: t.ownerToken, json: { path: "guide", source: SOURCE } });
  ({ pageId, revisionId: rev1 } = (await res.json()) as { pageId: string; revisionId: string });
});
afterEach(() => t.close());

const KEY = "sk-ant-api03-test-key-0000000000wxyz";
const setKey = () => t.call("/api/ai/key", { method: "PUT", token: t.ownerToken, json: { apiKey: KEY } });

describe("bring your own key", () => {
  it("stores the key sealed, shows only a hint, and lets admins only set it", async () => {
    expect(await (await t.call("/api/ai", { token: t.ownerToken })).json()).toMatchObject({ configured: false });
    const editor = await t.addMember("ed@example.com", "editor");
    expect((await t.call("/api/ai/key", { method: "PUT", token: editor, json: { apiKey: KEY } })).status).toBe(403);
    expect((await setKey()).status).toBe(200);
    const status = await (await t.call("/api/ai", { token: editor })).json();
    expect(status).toEqual({ configured: true, source: "workspace", hint: "…wxyz" });
    const [ws] = await t.db.query.workspaces.findMany();
    expect(ws!.aiKeyCiphertext).not.toContain("sk-ant");
  });

  it("explains how to set up Claude when no key exists", async () => {
    const res = await t.call(`/api/pages/${pageId}/assist`, { method: "POST", token: t.ownerToken, json: { instruction: "Tighten", baseRevisionId: rev1 } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Anthropic API key/);
  });
});

describe("assist and suggestions", () => {
  beforeEach(async () => {
    await setKey();
  });

  it("rewrites a selection into a reviewable suggestion, using the workspace key and the authoring guide", async () => {
    const from = SOURCE.indexOf("Deploy with");
    const to = from + "Deploy with the canary pipeline.".length;
    reply = { replacement: "Deploy with the canary pipeline. It takes 5% of traffic for 10 minutes.", summary: "Explain the canary" };
    const res = await t.call(`/api/pages/${pageId}/assist`, { method: "POST", token: t.ownerToken, json: { instruction: "Explain more", baseRevisionId: rev1, selection: { from, to } } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(lastKey).toBe(KEY);
    expect(lastRequest!.system).toContain(":::callout");
    expect(lastRequest!.prompt).toContain("<<<SELECTION>>>Deploy with the canary pipeline.<<<END SELECTION>>>");
    expect(body.hunks).toHaveLength(1);
    expect(body.stale).toBe(false);

    // Nothing changed yet: suggestions are never applied on their own.
    expect(await (await t.call("/s/pub/guide.md")).text()).not.toContain("5% of traffic");

    const accepted = await (await t.call(`/api/suggestions/${body.id}/accept`, { method: "POST", token: t.ownerToken, json: {} })).json();
    expect(accepted.published).toBe(false);
    const opened = await (await t.call(`/api/pages/${pageId}`, { token: t.ownerToken })).json();
    expect(opened.source).toContain("5% of traffic");
    expect((await t.call(`/api/suggestions/${body.id}/accept`, { method: "POST", token: t.ownerToken, json: {} })).status).toBe(409);
  });

  it("requires a saved base so offsets line up", async () => {
    reply = { replacement: "x", summary: "x" };
    const res = await t.call(`/api/pages/${pageId}/assist`, { method: "POST", token: t.ownerToken, json: { instruction: "x", baseRevisionId: "rev_old" } });
    expect(res.status).toBe(409);
  });

  async function suggestWhole(proposed: string) {
    reply = { replacement: proposed, summary: "Several fixes" };
    const res = await t.call(`/api/pages/${pageId}/assist`, { method: "POST", token: t.ownerToken, json: { instruction: "Fix", baseRevisionId: rev1 } });
    return (await res.json()) as { id: string; hunks: unknown[] };
  }

  it("applies only the hunks a reviewer picks", async () => {
    const lines = SOURCE.split("\n");
    lines[5] = "Run the installer as root.";
    lines[13] = "Revert the tag and redeploy.";
    const s = await suggestWhole(lines.join("\n"));
    // Far-apart edits with 3 lines of context land in separate hunks.
    expect(s.hunks.length).toBe(2);
    const res = await t.call(`/api/suggestions/${s.id}/accept`, { method: "POST", token: t.ownerToken, json: { hunks: [1] } });
    const body = await res.json();
    expect(body.partial).toBe(true);
    expect(body.source).toContain("Revert the tag and redeploy.");
    expect(body.source).not.toContain("as root");
  });

  it("rebases onto newer edits and refuses overlapping ones", async () => {
    const s1 = await suggestWhole(SOURCE.replace("Revert the tag.", "Revert the tag and redeploy."));
    const s2 = await suggestWhole(SOURCE.replace("Run the installer.", "Run the new installer."));
    // Someone edits the install section after both suggestions were written.
    const edited = SOURCE.replace("Run the installer.", "Run the installer twice.");
    await t.call(`/api/pages/${pageId}`, { method: "PUT", token: t.ownerToken, json: { source: edited, baseRevisionId: rev1, publish: false } });

    expect((await (await t.call(`/api/suggestions/${s1.id}`, { token: t.ownerToken })).json()).stale).toBe(true);
    const merged = await (await t.call(`/api/suggestions/${s1.id}/accept`, { method: "POST", token: t.ownerToken, json: {} })).json();
    expect(merged.source).toContain("Run the installer twice.");
    expect(merged.source).toContain("Revert the tag and redeploy.");

    expect((await t.call(`/api/suggestions/${s2.id}/accept`, { method: "POST", token: t.ownerToken, json: {} })).status).toBe(409);
  });

  it("rejects and lists", async () => {
    const s = await suggestWhole(SOURCE.replace("Revert", "Roll back"));
    expect(await (await t.call(`/api/pages/${pageId}/suggestions`, { token: t.ownerToken })).json()).toHaveLength(1);
    expect((await t.call(`/api/suggestions/${s.id}/reject`, { method: "POST", token: t.ownerToken })).status).toBe(204);
    expect(await (await t.call(`/api/pages/${pageId}/suggestions`, { token: t.ownerToken })).json()).toHaveLength(0);
    const viewer = await t.addMember("v@example.com", "viewer");
    expect((await t.call(`/api/suggestions/${s.id}/accept`, { method: "POST", token: viewer, json: {} })).status).toBe(403);
  });
});
