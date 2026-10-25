import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PUBLIC_URL, setup } from "./helpers.js";

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function fakeLinkedIn(calls: Call[], options: { postStatus?: number } = {}): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "https://www.linkedin.com/oauth/v2/accessToken") return Response.json({ access_token: "li-access-token", expires_in: 5_184_000 });
    if (url === "https://api.linkedin.com/v2/userinfo") return Response.json({ sub: "abc123", name: "Adi R" });
    if (url === "https://api.linkedin.com/rest/posts") {
      return options.postStatus
        ? new Response('{"message":"Not enough permissions"}', { status: options.postStatus })
        : new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:7000" } });
    }
    return new Response("unexpected", { status: 500 });
  };
}

let calls: Call[];
let t: Awaited<ReturnType<typeof setup>>;

async function connect() {
  const start = await t.call("/integrations/linkedin/connect", { token: t.ownerToken });
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.get("location")!);
  expect(authorize.origin + authorize.pathname).toBe("https://www.linkedin.com/oauth/v2/authorization");
  expect(authorize.searchParams.get("scope")).toBe("openid profile w_member_social");
  expect(authorize.searchParams.get("redirect_uri")).toBe(`${PUBLIC_URL}/integrations/linkedin/callback`);
  const state = authorize.searchParams.get("state")!;
  const stateCookie = start.headers.get("set-cookie")!.split(";")[0]!;
  return t.call(`/integrations/linkedin/callback?code=the-code&state=${state}`, { token: t.ownerToken, headers: { Cookie: stateCookie } });
}

async function publicPage() {
  await t.call("/api/spaces", { method: "POST", token: t.ownerToken, json: { slug: "pub", name: "Public", visibility: "public" } });
  const res = await t.call("/api/spaces/pub/pages", { method: "POST", token: t.ownerToken, json: { path: "billing", source: "---\ntitle: Billing\nsummary: How it works.\n---\nHello" } });
  return ((await res.json()) as { pageId: string }).pageId;
}

describe("LinkedIn", () => {
  beforeEach(async () => {
    calls = [];
    t = await setup({ linkedin: true, fetch: fakeLinkedIn(calls) });
  });
  afterEach(() => t.close());

  it("puts a tracked share link on public pages", async () => {
    await publicPage();
    const html = await (await t.call("/s/pub/billing")).text();
    const tracked = encodeURIComponent(`${PUBLIC_URL}/s/pub/billing?utm_source=linkedin&utm_medium=social&utm_campaign=pub%2Fbilling`);
    expect(html).toContain(`https://www.linkedin.com/sharing/share-offsite/?url=${tracked}`);
    expect(html).not.toContain('id="post-li"'); // anonymous readers can't post
    expect(await (await t.call("/s/pub/billing", { token: t.ownerToken })).text()).toContain('id="post-li"');
  });

  it("connects an account and stores the token encrypted", async () => {
    const res = await connect();
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Posting as Adi R");
    const token = calls.find((c) => c.url.endsWith("/accessToken"))!;
    expect(String(token.init?.body)).toContain("code=the-code");

    const [row] = await t.db.query.linkedinAccounts.findMany();
    expect(row!.memberId).toBe("abc123");
    expect(row!.accessTokenCiphertext).not.toContain("li-access-token");
    expect(row!.accessTokenCiphertext.startsWith("v1.")).toBe(true);
    const me = await (await t.call("/api/me", { token: t.ownerToken })).json();
    expect(me.linkedin).toMatchObject({ connected: true, name: "Adi R" });
  });

  it("rejects a callback with the wrong state", async () => {
    const res = await t.call("/integrations/linkedin/callback?code=x&state=forged", { token: t.ownerToken, headers: { Cookie: "elemnt_li_state=real" } });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("posts a public page with a tracked link through the Posts API", async () => {
    const pageId = await publicPage();
    await connect();
    const res = await t.call(`/api/pages/${pageId}/linkedin`, { method: "POST", token: t.ownerToken, json: { commentary: "New write-up on billing" } });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      postUrn: "urn:li:share:7000",
      postUrl: "https://www.linkedin.com/feed/update/urn:li:share:7000/",
      sharedUrl: `${PUBLIC_URL}/s/pub/billing?utm_source=linkedin&utm_medium=social&utm_campaign=pub%2Fbilling`,
    });

    const post = calls.find((c) => c.url === "https://api.linkedin.com/rest/posts")!;
    const headers = new Headers(post.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer li-access-token");
    expect(headers.get("linkedin-version")).toBe("202509");
    expect(headers.get("x-restli-protocol-version")).toBe("2.0.0");
    expect(JSON.parse(String(post.init?.body))).toMatchObject({
      author: "urn:li:person:abc123",
      commentary: "New write-up on billing",
      visibility: "PUBLIC",
      lifecycleState: "PUBLISHED",
      content: { article: { title: "Billing", description: "How it works." } },
    });
    expect(await t.db.query.linkedinPosts.findMany()).toHaveLength(1);
  });

  it("refuses to post non-public pages or without a connection", async () => {
    const pageId = await publicPage();
    const noAccount = await t.call(`/api/pages/${pageId}/linkedin`, { method: "POST", token: t.ownerToken, json: { commentary: "x" } });
    expect(noAccount.status).toBe(400);
    expect((await noAccount.json()).error).toBe("Connect your LinkedIn account first.");

    await t.call("/api/spaces", { method: "POST", token: t.ownerToken, json: { slug: "eng", name: "Eng", visibility: "workspace" } });
    const created = await t.call("/api/spaces/eng/pages", { method: "POST", token: t.ownerToken, json: { path: "x", source: "x" } });
    const privatePage = ((await created.json()) as { pageId: string }).pageId;
    const res = await t.call(`/api/pages/${privatePage}/linkedin`, { method: "POST", token: t.ownerToken, json: { commentary: "x" } });
    expect((await res.json()).error).toBe("Only pages in public spaces can be posted to LinkedIn.");
  });

  it("passes LinkedIn's error back when a post fails", async () => {
    t.close();
    calls = [];
    t = await setup({ linkedin: true, fetch: fakeLinkedIn(calls, { postStatus: 403 }) });
    const pageId = await publicPage();
    await connect();
    const res = await t.call(`/api/pages/${pageId}/linkedin`, { method: "POST", token: t.ownerToken, json: { commentary: "x" } });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/^LinkedIn post failed \(403\)\. .*Not enough permissions/);
  });
});
