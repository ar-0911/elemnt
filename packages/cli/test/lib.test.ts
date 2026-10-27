import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addCardToReadme, client, loadConfig, repoFromRemote, saveConfig, waitForJob } from "../src/lib.js";

describe("repoFromRemote", () => {
  it("reads https and ssh GitHub remotes", () => {
    expect(repoFromRemote("https://github.com/Acme/Router.git\n")).toBe("acme/router");
    expect(repoFromRemote("git@github.com:acme/router.git")).toBe("acme/router");
    expect(repoFromRemote("ssh://git@github.com/acme/router")).toBe("acme/router");
    expect(repoFromRemote("https://gitlab.com/acme/router.git")).toBeUndefined();
  });
});

describe("config", () => {
  it("saves the token readable only by you, and env vars win", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "elemnt-")), "nested", "config.json");
    await saveConfig({ server: "https://docs.example.com", token: "elm_x" }, path);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await loadConfig(path)).toEqual({ server: "https://docs.example.com", token: "elm_x" });
    process.env.ELEMNT_TOKEN = "elm_env";
    try {
      expect((await loadConfig(path)).token).toBe("elm_env");
    } finally {
      delete process.env.ELEMNT_TOKEN;
    }
    expect(JSON.parse(await readFile(path, "utf8")).token).toBe("elm_x");
  });
});

describe("client", () => {
  it("sends the token and surfaces the server's error message", async () => {
    const seen: { url: string; auth: string | null; body?: string }[] = [];
    const fake: typeof fetch = async (url, init) => {
      seen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), ...(init?.body ? { body: String(init.body) } : {}) });
      return String(url).endsWith("/api/explain") ? Response.json({ error: "Explaining a repo needs Claude." }, { status: 400 }) : Response.json({ id: "j1" });
    };
    const api = client("https://docs.example.com/", "elm_x", fake);
    await expect(api.explain({ repo: "acme/router", space: "oss" })).rejects.toThrow("needs Claude");
    expect(seen[0]).toEqual({ url: "https://docs.example.com/api/explain", auth: "Bearer elm_x", body: '{"repo":"acme/router","space":"oss"}' });
  });

  it("polls a job until it finishes", async () => {
    let n = 0;
    const job = await waitForJob(async () => (++n < 3 ? { status: "running", repo: "a/b" } : { status: "done", repo: "a/b" }), { intervalMs: 1 });
    expect(job.status).toBe("done");
    expect(n).toBe(3);
  });
});

describe("addCardToReadme", () => {
  it("puts the card under the first heading, once", () => {
    const out = addCardToReadme("# Router\n\nA tiny router.\n", "<a>card</a>");
    expect(out).toBe("# Router\n\n<!-- elemnt -->\n<a>card</a>\n<!-- elemnt -->\n\nA tiny router.\n");
    expect(addCardToReadme(out, "<a>card</a>")).toBe(out);
    expect(addCardToReadme("No heading here.\n", "<a>c</a>").startsWith("<!-- elemnt -->")).toBe(true);
  });
});
