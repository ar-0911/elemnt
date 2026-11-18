import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema.js";
import { purgeExpired } from "../src/services/spaces.js";
import { setup } from "./helpers.js";

let t: Awaited<ReturnType<typeof setup>>;
afterEach(() => t.close());

const page = (title: string) => `---\ntitle: ${title}\n---\n${title} body.`;

async function space(slug: string, visibility: "public" | "workspace" | "private" = "workspace") {
  expect((await t.call("/api/spaces", { method: "POST", token: t.ownerToken, json: { slug, name: slug.toUpperCase(), visibility } })).status).toBe(201);
}
async function create(spaceSlug: string, path: string) {
  const res = await t.call(`/api/spaces/${spaceSlug}/pages`, { method: "POST", token: t.ownerToken, json: { path, source: page(path) } });
  expect(res.status).toBe(201);
  return ((await res.json()) as { pageId: string }).pageId;
}
async function tree(spaceSlug: string, token = t.ownerToken) {
  const res = await t.call(`/api/spaces/${spaceSlug}/tree`, { token });
  return res.status === 200 ? ((await res.json()) as { pages: { path: string; parentId: string | null }[] }).pages.map((p) => p.path) : res.status;
}

describe("moving pages between spaces", () => {
  let ares: string;
  let flags: string;
  beforeEach(async () => {
    t = await setup();
    await space("pocs", "public");
    await space("infra");
    ares = await create("pocs", "ares");
    flags = await create("pocs", "ares/flags");
    await create("pocs", "ares/flags/deep");
    await create("pocs", "other");
    const comment = await t.call(`/api/pages/${flags}/comments`, { method: "POST", token: t.ownerToken, json: { body: "keep me" } });
    expect(comment.status).toBe(201);
  });

  it("moves a page with its sub-pages, history and comments, and redirects old links", async () => {
    const dry = await (await t.call(`/api/pages/${ares}/move?space=infra`, { token: t.ownerToken })).json();
    expect(dry.moves.map((m: { to: string }) => m.to)).toEqual(["ares", "ares/flags", "ares/flags/deep"]);
    expect(dry.conflicts).toEqual([]);
    expect(dry.to.visibility).toBe("workspace");

    const res = await t.call(`/api/pages/${ares}/move`, { method: "POST", token: t.ownerToken, json: { space: "infra" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ space: "infra", path: "ares", moved: 3, url: "https://docs.example.com/s/infra/ares" });

    expect(await tree("pocs")).toEqual(["other"]);
    expect(await tree("infra")).toEqual(["ares", "ares/flags", "ares/flags/deep"]);
    // Comments and revisions follow the page id.
    expect(((await (await t.call(`/api/pages/${flags}/comments`, { token: t.ownerToken })).json()) as unknown[]).length).toBe(1);
    expect(((await (await t.call(`/api/pages/${flags}/revisions`, { token: t.ownerToken })).json()) as unknown[]).length).toBe(1);

    // Old links land on the new address, keeping the query string and .md.
    const old = await t.call("/s/pocs/ares/flags?view=markdown", { token: t.ownerToken });
    expect(old.status).toBe(302);
    expect(old.headers.get("location")).toBe("/s/infra/ares/flags?view=markdown");
    expect((await t.call("/s/pocs/ares.md", { token: t.ownerToken })).headers.get("location")).toBe("/s/infra/ares.md");
    // Readers who can't see the new space don't learn where it went.
    expect((await t.call("/s/pocs/ares")).status).toBe(404);
  });

  it("nests under a parent, renames, and refuses clashes and moving into itself", async () => {
    await create("infra", "tools");
    await create("infra", "tools/ares");
    const clash = await t.call(`/api/pages/${ares}/move`, { method: "POST", token: t.ownerToken, json: { space: "infra", parent: "tools" } });
    expect(clash.status).toBe(409);
    expect((await clash.json()).error).toContain("tools/ares");

    const renamed = await t.call(`/api/pages/${ares}/move`, { method: "POST", token: t.ownerToken, json: { space: "infra", parent: "tools", slug: "ares-v2" } });
    expect(renamed.status).toBe(200);
    expect(await tree("infra")).toEqual(["tools", "tools/ares", "tools/ares-v2", "tools/ares-v2/flags", "tools/ares-v2/flags/deep"]);
    const [moved] = await t.db.select().from(schema.pages).where(eq(schema.pages.id, ares));
    const [tools] = await t.db.select().from(schema.pages).where(eq(schema.pages.path, "tools"));
    expect(moved!.parentId).toBe(tools!.id);

    expect((await t.call(`/api/pages/${ares}/move`, { method: "POST", token: t.ownerToken, json: { space: "infra", parent: "tools/ares-v2/flags" } })).status).toBe(400);
    expect((await t.call(`/api/pages/${ares}/move`, { method: "POST", token: t.ownerToken, json: { space: "infra", parent: "nope" } })).status).toBe(400);

    // Moving back clears the redirect at the old address: the live page wins.
    expect((await t.call(`/api/pages/${ares}/move`, { method: "POST", token: t.ownerToken, json: { space: "pocs", slug: "ares" } })).status).toBe(200);
    expect((await t.call("/s/pocs/ares")).status).toBe(200);
    expect((await t.call("/s/infra/tools/ares-v2/flags", { token: t.ownerToken })).headers.get("location")).toBe("/s/pocs/ares/flags");
  });

  it("needs editor rights and read access to both spaces", async () => {
    await space("secret", "private");
    const viewer = await t.addMember("v@example.com", "viewer");
    const editor = await t.addMember("e@example.com", "editor");
    expect((await t.call(`/api/pages/${ares}/move`, { method: "POST", token: viewer, json: { space: "infra" } })).status).toBe(403);
    expect((await t.call(`/api/pages/${ares}/move`, { method: "POST", token: editor, json: { space: "secret" } })).status).toBe(404);
    expect((await t.call(`/api/pages/${ares}/move`, { method: "POST", token: editor, json: { space: "infra" } })).status).toBe(200);
  });

  it("warns about websites that show the moved pages", async () => {
    expect((await t.call("/api/sites", { method: "POST", token: t.ownerToken, json: { slug: "aresweb", name: "Ares site", space: "pocs" } })).status).toBe(201);
    const dry = await (await t.call(`/api/pages/${ares}/move?space=infra`, { token: t.ownerToken })).json();
    expect(dry.sites).toEqual([{ slug: "aresweb", name: "Ares site", root: null }]);
  });
});

describe("deleting spaces", () => {
  beforeEach(async () => {
    t = await setup();
    await space("old", "public");
    await space("new");
    await create("old", "guide");
    await create("old", "guide/setup");
    await create("old", "faq");
  });

  it("is owner-only and needs the space's name typed", async () => {
    const admin = await t.addMember("a@example.com", "admin");
    expect((await t.call("/api/spaces/old", { method: "DELETE", token: admin, json: { confirm: "OLD" } })).status).toBe(403);
    expect((await t.call("/api/spaces/old", { method: "DELETE", token: t.ownerToken, json: { confirm: "old" } })).status).toBe(400);
    const check = await (await t.call("/api/spaces/old/delete-check", { token: t.ownerToken })).json();
    expect(check).toEqual({ pages: 3, sites: [] });
  });

  it("goes to the trash with its pages, hidden everywhere, and can be restored", async () => {
    expect((await t.call("/api/spaces/old", { method: "DELETE", token: t.ownerToken, json: { confirm: "OLD" } })).status).toBe(200);
    const spaces = (await (await t.call("/api/spaces", { token: t.ownerToken })).json()) as { slug: string }[];
    expect(spaces.map((s) => s.slug)).toEqual(["new"]);
    expect(await tree("old")).toBe(404);
    expect((await t.call("/s/old/guide")).status).not.toBe(200);
    expect((await (await t.call("/api/search?q=guide", { token: t.ownerToken })).json()).length).toBe(0);
    // The slug stays taken while it's in the trash.
    expect((await t.call("/api/spaces", { method: "POST", token: t.ownerToken, json: { slug: "old", name: "Again" } })).status).toBe(409);

    const trash = await (await t.call("/api/trash", { token: t.ownerToken })).json();
    expect(trash.days).toBe(30);
    expect(trash.spaces).toMatchObject([{ slug: "old", pages: 3 }]);
    expect((await t.call(`/api/trash/${trash.spaces[0].id}/restore`, { method: "POST", token: t.ownerToken })).status).toBe(200);
    expect(await tree("old")).toEqual(["faq", "guide", "guide/setup"]);
    expect((await t.call("/s/old/guide")).status).toBe(200);
  });

  it("can move every page to another space first, keeping old links alive", async () => {
    await create("new", "faq");
    const clash = await t.call("/api/spaces/old", { method: "DELETE", token: t.ownerToken, json: { confirm: "OLD", pages: "move", moveTo: "new" } });
    expect(clash.status).toBe(409);
    expect(await tree("old")).toEqual(["faq", "guide", "guide/setup"]);

    await create("new", "archive");
    const res = await t.call("/api/spaces/old", { method: "DELETE", token: t.ownerToken, json: { confirm: "OLD", pages: "move", moveTo: "new", parent: "archive" } });
    expect(res.status).toBe(200);
    expect((await res.json()).moved).toBe(3);
    expect(await tree("new")).toEqual(["archive", "archive/faq", "archive/guide", "archive/guide/setup", "faq"]);
    expect((await t.call("/s/old/guide/setup", { token: t.ownerToken })).headers.get("location")).toBe("/s/new/archive/guide/setup");
    const trash = await (await t.call("/api/trash", { token: t.ownerToken })).json();
    expect(trash.spaces).toMatchObject([{ slug: "old", pages: 0 }]);
  });

  it("is blocked while a website shows the space", async () => {
    expect((await t.call("/api/sites", { method: "POST", token: t.ownerToken, json: { slug: "oldweb", name: "Old web", space: "old" } })).status).toBe(201);
    const res = await t.call("/api/spaces/old", { method: "DELETE", token: t.ownerToken, json: { confirm: "OLD" } });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Old web");
  });

  it("purges for good after 30 days, or on demand", async () => {
    await t.call("/api/spaces/old", { method: "DELETE", token: t.ownerToken, json: { confirm: "OLD" } });
    const [ws] = await t.db.select().from(schema.workspaces);
    await purgeExpired(t.db, ws!.id, Date.now() + 29 * 86_400_000);
    expect((await t.db.select().from(schema.spaces)).length).toBe(2);
    await purgeExpired(t.db, ws!.id, Date.now() + 31 * 86_400_000);
    expect((await t.db.select().from(schema.spaces)).map((s) => s.slug)).toEqual(["new"]);
    expect((await t.db.select().from(schema.pages)).length).toBe(0);

    await t.call("/api/spaces/new", { method: "DELETE", token: t.ownerToken, json: { confirm: "NEW" } });
    const trash = await (await t.call("/api/trash", { token: t.ownerToken })).json();
    expect((await t.call(`/api/trash/${trash.spaces[0].id}`, { method: "DELETE", token: t.ownerToken })).status).toBe(204);
    expect((await t.db.select().from(schema.spaces)).length).toBe(0);
  });
});
