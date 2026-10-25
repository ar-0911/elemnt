import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setup } from "./helpers.js";

let t: Awaited<ReturnType<typeof setup>>;
let pageId: string;
let rev1: string;

beforeEach(async () => {
  t = await setup();
  await t.call("/api/spaces", { method: "POST", token: t.ownerToken, json: { slug: "pub", name: "Pub", visibility: "public" } });
  const res = await t.call("/api/spaces/pub/pages", { method: "POST", token: t.ownerToken, json: { path: "guide", source: "---\ntitle: Guide\n---\nDeploy with the canary pipeline." } });
  ({ pageId, revisionId: rev1 } = (await res.json()) as { pageId: string; revisionId: string });
});
afterEach(() => t.close());

const put = (json: unknown, token = t.ownerToken) => t.call(`/api/pages/${pageId}`, { method: "PUT", token, json });

describe("drafts", () => {
  it("autosaves a draft without changing the live page, then publishes it", async () => {
    const draft = await put({ source: "---\ntitle: Guide v2\n---\nDraft text.", baseRevisionId: rev1, publish: false });
    expect(draft.status).toBe(200);
    const { revisionId: rev2 } = await draft.json();

    expect(await (await t.call("/s/pub/guide.md")).text()).toContain("canary pipeline");
    const opened = await (await t.call(`/api/pages/${pageId}`, { token: t.ownerToken })).json();
    expect(opened.headRevisionId).toBe(rev2);
    expect(opened.source).toContain("Draft text.");

    expect((await t.call(`/api/pages/${pageId}/publish`, { method: "POST", token: t.ownerToken })).status).toBe(200);
    expect(await (await t.call("/s/pub/guide.md")).text()).toContain("Draft text.");
    const tree = await (await t.call("/api/spaces/pub/tree", { token: t.ownerToken })).json();
    expect(tree.pages[0]).toMatchObject({ title: "Guide v2", published: true, hasDraft: false });
  });

  it("discards a draft", async () => {
    await put({ source: "Throwaway", baseRevisionId: rev1, publish: false });
    expect((await t.call(`/api/pages/${pageId}/draft`, { method: "DELETE", token: t.ownerToken })).status).toBe(204);
    const opened = await (await t.call(`/api/pages/${pageId}`, { token: t.ownerToken })).json();
    expect(opened.headRevisionId).toBe(rev1);
  });

  it("keeps draft-only pages out of public listings", async () => {
    await t.call("/api/spaces/pub/pages", { method: "POST", token: t.ownerToken, json: { path: "wip", source: "WIP", draft: true } });
    expect(await (await t.call("/s/pub/llms.txt")).text()).not.toContain("wip");
    expect((await t.call("/s/pub/wip")).status).toBe(404);
    const anonTree = await (await t.call("/api/spaces/pub/tree")).json();
    expect(anonTree.pages.map((p: { path: string }) => p.path)).toEqual(["guide"]);
  });
});

describe("history", () => {
  it("diffs two revisions and restores an old one as a new revision", async () => {
    const { revisionId: rev2 } = await (await put({ source: "---\ntitle: Guide\n---\nDeploy with blue/green.", baseRevisionId: rev1 })).json();
    const diff = await (await t.call(`/api/pages/${pageId}/diff?from=${rev1}&to=${rev2}`, { token: t.ownerToken })).json();
    expect(diff.unified).toContain("-Deploy with the canary pipeline.");
    expect(diff.unified).toContain("+Deploy with blue/green.");

    const restored = await (await t.call(`/api/pages/${pageId}/restore`, { method: "POST", token: t.ownerToken, json: { revisionId: rev1 } })).json();
    expect(await (await t.call("/s/pub/guide.md")).text()).toContain("canary pipeline");
    const revs = await (await t.call(`/api/pages/${pageId}/revisions`, { token: t.ownerToken })).json();
    expect(revs.map((r: { id: string }) => r.id)).toEqual([restored.revisionId, rev2, rev1]);
    expect(revs[0]).toMatchObject({ message: `Restored ${rev1}`, authorEmail: "owner@example.com" });
  });

  it("refuses to diff revisions from another page", async () => {
    const other = await t.call("/api/spaces/pub/pages", { method: "POST", token: t.ownerToken, json: { path: "other", source: "x" } });
    const { revisionId } = await other.json();
    expect((await t.call(`/api/pages/${pageId}/diff?from=${rev1}&to=${revisionId}`, { token: t.ownerToken })).status).toBe(404);
  });
});

describe("locks", () => {
  it("lets one editor in at a time", async () => {
    const editor2 = await t.addMember("e2@example.com", "editor");
    expect((await t.call(`/api/pages/${pageId}/lock`, { method: "POST", token: t.ownerToken })).status).toBe(200);
    const blocked = await t.call(`/api/pages/${pageId}/lock`, { method: "POST", token: editor2 });
    expect(blocked.status).toBe(423);
    expect((await blocked.json()).error).toBe("Owner is editing this page.");
    expect((await put({ source: "sneaky", baseRevisionId: rev1 }, editor2)).status).toBe(423);

    await t.call(`/api/pages/${pageId}/lock`, { method: "DELETE", token: t.ownerToken });
    expect((await t.call(`/api/pages/${pageId}/lock`, { method: "POST", token: editor2 })).status).toBe(200);
  });
});

describe("comments", () => {
  it("threads, resolves and deletes", async () => {
    const reader = await t.addMember("r@example.com", "viewer");
    const root = await (await t.call(`/api/pages/${pageId}/comments`, { method: "POST", token: reader, json: { body: "Which pipeline?", anchor: { exact: "canary pipeline" } } })).json();
    await t.call(`/api/pages/${pageId}/comments`, { method: "POST", token: t.ownerToken, json: { body: "The prod one.", parentId: root.id } });

    const list = await (await t.call(`/api/pages/${pageId}/comments`, { token: reader })).json();
    expect(list.map((c: { body: string; parentId: string | null }) => [c.body, c.parentId])).toEqual([["Which pipeline?", null], ["The prod one.", root.id]]);
    expect(list[0].anchor).toEqual({ exact: "canary pipeline" });

    const resolved = await (await t.call(`/api/pages/${pageId}/comments/${root.id}/resolve`, { method: "POST", token: t.ownerToken, json: { resolved: true } })).json();
    expect(resolved.resolvedAt).toBeTruthy();

    expect((await t.call(`/api/pages/${pageId}/comments/${root.id}`, { method: "DELETE", token: await t.addMember("x@example.com", "editor") })).status).toBe(403);
    expect((await t.call(`/api/pages/${pageId}/comments/${root.id}`, { method: "DELETE", token: reader })).status).toBe(204);
    expect(await (await t.call(`/api/pages/${pageId}/comments`, { token: reader })).json()).toEqual([]);
  });
});

describe("search", () => {
  it("finds published pages with an escaped, highlighted snippet", async () => {
    await put({ source: "---\ntitle: Guide\n---\nUse the <script> tag carefully when you deploy to canary.", baseRevisionId: rev1 });
    const hits = await (await t.call("/api/search?q=canary")).json();
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ title: "Guide", path: "guide", spaceSlug: "pub" });
    expect(hits[0].snippetHtml).toContain("<mark>canary</mark>");
    expect(hits[0].snippetHtml).not.toContain("<script>");
  });

  it("only searches spaces the reader can see", async () => {
    await t.call("/api/spaces", { method: "POST", token: t.ownerToken, json: { slug: "eng", name: "Eng", visibility: "workspace" } });
    await t.call("/api/spaces/eng/pages", { method: "POST", token: t.ownerToken, json: { path: "secret", source: "Internal canary runbook" } });
    expect((await (await t.call("/api/search?q=canary")).json()).map((h: { path: string }) => h.path)).toEqual(["guide"]);
    expect((await (await t.call("/api/search?q=canary", { token: t.ownerToken })).json())).toHaveLength(2);
  });
});

describe("drafts with errors", () => {
  it("autosaves a broken draft but refuses to publish it", async () => {
    const draft = await put({ source: ":::nope\nhalf typed", baseRevisionId: rev1, publish: false });
    expect(draft.status).toBe(200);
    expect((await draft.json()).ok).toBe(false);
    const pub = await t.call(`/api/pages/${pageId}/publish`, { method: "POST", token: t.ownerToken });
    expect(pub.status).toBe(422);
    expect((await pub.json()).diagnostics[0].message).toBe('Unknown component "nope"');
  });
});
