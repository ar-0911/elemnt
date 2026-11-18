import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { previewFrameSource } from "../src/services/sites.js";
import { editorApp, editorCsp } from "../src/web.js";

describe("editor static serving", () => {
  let app: Hono;
  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), "elemnt-web-"));
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "index.html"), "<!doctype html><div id=root></div>");
    await writeFile(join(dir, "assets", "index-abc.js"), "console.log(1)");
    await writeFile(join(dir, "secret.txt"), "nope");
    app = new Hono().route("/app", editorApp(dir));
  });

  it("serves hashed assets with long caching", async () => {
    const res = await app.request("/app/assets/index-abc.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    expect(res.headers.get("cache-control")).toMatch(/immutable/);
  });

  it("falls back to index.html for client routes, with the editor CSP", async () => {
    const res = await app.request("/app/docs/getting-started");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("id=root");
    expect(res.headers.get("content-security-policy")).toContain("worker-src 'self' blob:");
  });

  it("does not serve files outside assets or escape the directory", async () => {
    expect(await (await app.request("/app/secret.txt")).text()).toContain("id=root");
    expect((await app.request("/app/assets/../../etc/passwd")).status).not.toBe(500);
    expect((await app.request("/app/assets/missing.js")).status).toBe(404);
  });

  it("lets the editor frame the sandbox and site previews, nothing else", () => {
    const preview = previewFrameSource({ sitesDomain: "sites.example.com", publicUrl: "https://docs.example.com" });
    expect(preview).toBe("https://*.sites.example.com");
    expect(editorCsp("https://sandbox.example.com/w", [preview!])).toContain("frame-src https://sandbox.example.com https://*.sites.example.com;");
    expect(previewFrameSource({ sitesDomain: "localhost", publicUrl: "http://localhost:3000" })).toBe("http://*.localhost:3000");
    expect(previewFrameSource({ publicUrl: "https://docs.example.com" })).toBeUndefined();
    expect(editorCsp()).toContain("frame-src 'none'");
  });
});
