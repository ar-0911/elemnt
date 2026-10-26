import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { MemoryBlobStore } from "../src/lib/blobs.js";
import { firstRun } from "../src/services/workspace.js";
import { setup } from "./helpers.js";

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});
afterEach(() => t.close());

describe("running on a host", () => {
  it("answers health checks", async () => {
    const res = await t.call("/healthz");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("answers health checks before the workspace exists", async () => {
    const fresh = createApp({ db: t.db, blobs: new MemoryBlobStore(), config: { ...t.config, workspaceSlug: "not-yet" } });
    const res = await fresh.request("/healthz");
    expect(res.status).toBe(200);
  });

  it("bootstraps a new workspace from ELEMNT_OWNER_EMAIL once, and leaves an existing one alone", async () => {
    expect(await firstRun(t.db, { workspaceSlug: "acme", email: "someone@example.com" })).toBeUndefined();
    const made = await firstRun(t.db, { workspaceSlug: "fresh", email: "new@example.com" });
    expect(made?.workspace.slug).toBe("fresh");
    expect(made?.token).toMatch(/^elm_/);
    expect(await firstRun(t.db, { workspaceSlug: "fresh", email: "new@example.com" })).toBeUndefined();
  });
});
