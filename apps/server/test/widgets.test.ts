import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inlineScript, widgetCsp } from "../src/sandbox.js";
import { scanWidget } from "../src/services/widgets.js";
import { SANDBOX_URL, setup } from "./helpers.js";

const widget = (js: string, summary = "A counter that counts your clicks") =>
  `:::widget{summary="${summary}" height=200}\n\`\`\`html\n<button id=b>0</button>\n\`\`\`\n\`\`\`js\n${js}\n\`\`\`\n:::\n`;
const SOURCE = `---\ntitle: Counter\n---\n${widget("b.onclick = () => b.textContent++")}`;

let t: Awaited<ReturnType<typeof setup>>;

async function publishedHash() {
  const res = await t.call("/s/pub/counter");
  const html = await res.text();
  return { html, res, hash: html.match(/data-hash="([0-9a-f]{64})"/)?.[1] ?? "" };
}

beforeEach(async () => {
  t = await setup();
  await t.call("/api/spaces", { method: "POST", token: t.ownerToken, json: { slug: "pub", name: "Pub", visibility: "public" } });
  const res = await t.call("/api/spaces/pub/pages", { method: "POST", token: t.ownerToken, json: { path: "counter", source: SOURCE } });
  expect(res.status).toBe(201);
});
afterEach(() => t.close());

describe("scan on save", () => {
  it("refuses miners, WebAssembly, password fields and obfuscated code", () => {
    const scan = (js: string, html = "") => scanWidget({ html, css: "", js }).filter((f) => f.severity === "error").map((f) => f.message);
    expect(scan("new CoinHive.Anonymous('key').start()")).toEqual(["widget contains known crypto-mining code"]);
    expect(scan("WebAssembly.instantiate(bytes)")).toEqual(["widgets can't use WebAssembly"]);
    expect(scan("", '<input type="password">')).toEqual(["widgets can't ask for passwords"]);
    expect(scan(`var a="${"\\x41".repeat(300)}"`)).toEqual(["widget code looks obfuscated or minified; publish the readable source"]);
    expect(scan("b.onclick = () => b.textContent++")).toEqual([]);
  });

  it("blocks saving a page whose widget fails the scan", async () => {
    const bad = `---\ntitle: Bad\n---\n${widget("WebAssembly.instantiate(new Uint8Array([0]))")}`;
    const res = await t.call("/api/spaces/pub/pages", { method: "POST", token: t.ownerToken, json: { path: "bad", source: bad } });
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain("WebAssembly");
  });
});

describe("reader", () => {
  it("labels the widget with its author, loads the runtime and allows only the sandbox to be framed", async () => {
    const { html, res, hash } = await publishedHash();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(html).toContain('data-author="Owner"');
    expect(html).toContain('from "/assets/elements.js"');
    expect(html).toContain('"sandboxUrl":"https://sandbox.example.com"');
    // Public page, unverified workspace, anonymous reader: click to run.
    expect(html).toContain('"autorun":false');
    expect(res.headers.get("content-security-policy")).toContain(`frame-src ${SANDBOX_URL}`);
  });

  it("runs widgets without a click for members", async () => {
    const res = await t.call("/s/pub/counter", { token: t.ownerToken });
    expect(await res.text()).toContain('"autorun":true');
  });

  it("serves the browser runtime", async () => {
    const res = await t.call("/assets/elements.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toContain("enhance");
  });
});

describe("sandbox origin", () => {
  it("serves widget code with a CSP that takes away network, eval and WebAssembly", async () => {
    const { hash } = await publishedHash();
    const res = await t.call(`${SANDBOX_URL}/w/${hash}?theme=dark`);
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("worker-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("frame-ancestors https://docs.example.com");
    expect(csp).not.toContain("unsafe-eval");
    const body = await res.text();
    expect(body).toContain('data-theme="dark"');
    expect(body).toContain("b.onclick = () => b.textContent++");
    expect(body).toContain('type: "beat"');
  });

  it("answers only /w/* and never the app, even with a valid session", async () => {
    expect((await t.call(`${SANDBOX_URL}/api/me`, { token: t.ownerToken })).status).toBe(404);
    expect((await t.call(`${SANDBOX_URL}/s/pub/counter`)).status).toBe(404);
    expect((await t.call(`${SANDBOX_URL}/w/${"0".repeat(64)}`)).status).toBe(404);
  });

  it("does not serve widget frames from the app origin", async () => {
    const { hash } = await publishedHash();
    expect((await t.call(`/w/${hash}`)).status).toBe(404);
  });

  it("serves code runners, with eval only there", async () => {
    const js = await t.call(`${SANDBOX_URL}/w/run/javascript`);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-security-policy")).toContain("'unsafe-eval'");
    expect(js.headers.get("content-security-policy")).toContain("connect-src 'none'");
    const py = await t.call(`${SANDBOX_URL}/w/run/python`);
    expect(await py.text()).toContain("pyodide.mjs");
  });

  it("keeps user code inside its script element", () => {
    expect(inlineScript('x = "</script><script>alert(1)</script>"')).not.toMatch(/<\/script/i);
  });

  it("lets verified workspaces reach their allowed hosts", () => {
    expect(widgetCsp("n", "https://docs.example.com", ["api.acme.dev"])).toContain("connect-src https://api.acme.dev");
  });
});

describe("abuse handling", () => {
  it("lets anyone report, admins list reports and block, and a block applies at once", async () => {
    const { hash } = await publishedHash();
    const report = await t.call(`/api/widgets/${hash}/report`, { method: "POST", json: { reason: "phishing", page: "/s/pub/counter" } });
    expect(report.status).toBe(200);

    const editor = await t.addMember("ed@example.com", "editor");
    expect((await t.call("/api/widgets/reports", { token: editor })).status).toBe(403);
    const { reports } = (await (await t.call("/api/widgets/reports", { token: t.ownerToken })).json()) as { reports: { hash: string; reason: string }[] };
    expect(reports).toMatchObject([{ hash, reason: "phishing" }]);

    expect((await t.call(`/api/widgets/${hash}/block`, { method: "POST", token: t.ownerToken, json: { reason: "phishing" } })).status).toBe(200);
    expect((await t.call(`${SANDBOX_URL}/w/${hash}`)).status).toBe(410);
    expect((await publishedHash()).html).toContain('data-blocked="phishing"');

    expect((await t.call(`/api/widgets/${hash}/block`, { method: "DELETE", token: t.ownerToken })).status).toBe(204);
    expect((await t.call(`${SANDBOX_URL}/w/${hash}`)).status).toBe(200);
  });

  it("rate limits reports", async () => {
    const { hash } = await publishedHash();
    const send = () => t.call(`/api/widgets/${hash}/report`, { method: "POST", headers: { "x-forwarded-for": "203.0.113.9" }, json: { reason: "spam" } });
    for (let i = 0; i < 10; i++) expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
  });

  it("registers editor previews by recomputed hash and refuses to serve ones that fail the scan", async () => {
    const res = await t.call("/api/widgets/preview", {
      method: "POST",
      token: t.ownerToken,
      json: { widgets: [{ html: "<p>hi</p>", css: "", js: "" }, { html: "", css: "", js: "WebAssembly.compile(x)" }] },
    });
    const { widgets } = (await res.json()) as { widgets: { hash: string; findings: unknown[] }[] };
    expect((await t.call(`${SANDBOX_URL}/w/${widgets[0]!.hash}`)).status).toBe(200);
    expect(widgets[1]!.findings).not.toEqual([]);
    expect((await t.call(`${SANDBOX_URL}/w/${widgets[1]!.hash}`)).status).toBe(410);
  });
});

describe("verification", () => {
  it("lets admins verify a self-hosted workspace, which turns on autorun and allowed hosts", async () => {
    const res = await t.call("/api/settings/widgets", { method: "PUT", token: t.ownerToken, json: { verified: true, hosts: ["api.acme.dev"] } });
    expect(await res.json()).toEqual({ verified: true, hosts: ["api.acme.dev"] });
    const { html, hash } = await publishedHash();
    expect(html).toContain('"autorun":true');
    expect(html).toContain('data-hosts="api.acme.dev"');
    expect((await t.call(`${SANDBOX_URL}/w/${hash}`)).headers.get("content-security-policy")).toContain("connect-src https://api.acme.dev");
  });

  it("leaves verification to the operator when self-verify is off", async () => {
    const t2 = await setup({ selfVerify: false });
    expect((await t2.call("/api/settings/widgets", { method: "PUT", token: t2.ownerToken, json: { verified: true } })).status).toBe(403);
    await t2.close();
  });
});

describe("live data", () => {
  it("reads a value from an admin-configured source with sealed headers, members only unless public", async () => {
    let seen: Headers | undefined;
    const fake: typeof fetch = async (_url, init) => {
      seen = new Headers(init?.headers);
      return new Response(JSON.stringify({ api: { latency: { p99: 118 } }, regions: ["eu", "us"] }));
    };
    const t2 = await setup({ fetch: fake });
    const put = await t2.call("/api/settings/query-sources/metrics", { method: "PUT", token: t2.ownerToken, json: { url: "https://metrics.example.com/summary", headers: { Authorization: "Bearer s3cret" } } });
    expect(JSON.stringify(await put.json())).not.toContain("s3cret");

    const q = (token?: string, key = "api.latency.p99") => t2.call(`/api/query?source=metrics&key=${key}`, token ? { token } : {});
    expect((await q()).status).toBe(404);
    const ok = await q(t2.ownerToken);
    expect(await ok.json()).toMatchObject({ value: 118 });
    expect(seen?.get("authorization")).toBe("Bearer s3cret");
    expect(await (await q(t2.ownerToken, "regions.1")).json()).toMatchObject({ value: "us" });
    expect((await q(t2.ownerToken, "api")).status).toBe(400);

    await t2.call("/api/settings/query-sources/metrics", { method: "PUT", token: t2.ownerToken, json: { url: "https://metrics.example.com/summary", public: true } });
    expect((await q()).status).toBe(200);
    expect(seen?.get("authorization")).toBe("Bearer s3cret");
    await t2.close();
  });
});

