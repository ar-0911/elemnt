import { describe, expect, it } from "vitest";
import { S3BlobStore } from "../src/lib/s3.js";

const HASH = "a".repeat(62) + "bc";

/** A tiny S3: keeps objects by path and checks every request is SigV4-signed. */
function fakeS3() {
  const objects = new Map<string, string>();
  const seen: { method: string; url: string; auth: string; token: string | null }[] = [];
  const f: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    if (url.hostname === "169.254.170.2" || url.pathname === "/creds") {
      return Response.json({ AccessKeyId: "ASIAROLE", SecretAccessKey: "rolesecret", Token: "session-token", Expiration: new Date(Date.now() + 3600_000).toISOString() });
    }
    seen.push({ method: req.method, url: req.url, auth: req.headers.get("authorization") ?? "", token: req.headers.get("x-amz-security-token") });
    if (!req.headers.get("authorization")?.startsWith("AWS4-HMAC-SHA256 ")) return new Response("unsigned", { status: 403 });
    if (req.method === "PUT") {
      objects.set(url.pathname, await req.text());
      return new Response(null, { status: 200 });
    }
    const body = objects.get(url.pathname);
    return body === undefined ? new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 }) : new Response(body);
  };
  return { f, objects, seen };
}

describe("S3-compatible blob store", () => {
  it("writes and reads signed, path-style objects (R2 shape)", async () => {
    const s3 = fakeS3();
    const store = new S3BlobStore({ bucket: "elemnt", endpoint: "https://acct.r2.cloudflarestorage.com", region: "auto", accessKeyId: "k", secretAccessKey: "s", fetch: s3.f });
    await store.put(HASH, "# Hello ✓");
    expect(await store.get(HASH)).toBe("# Hello ✓");
    expect(await store.get("f".repeat(64))).toBeUndefined();
    expect(s3.seen[0]!.url).toBe(`https://acct.r2.cloudflarestorage.com/elemnt/blobs/aa/${HASH}`);
    expect(s3.seen[0]!.auth).toContain("/auto/s3/aws4_request");
  });

  it("uses AWS S3 by region and the container role when there are no keys", async () => {
    const s3 = fakeS3();
    const store = new S3BlobStore({ bucket: "docs", region: "eu-west-1", fetch: s3.f, env: { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/abc" } });
    await store.put(HASH, "x");
    expect(s3.seen[0]!.url).toBe(`https://s3.eu-west-1.amazonaws.com/docs/blobs/aa/${HASH}`);
    expect(s3.seen[0]!.auth).toContain("Credential=ASIAROLE/");
    expect(s3.seen[0]!.token).toBe("session-token");
  });

  it("says what to configure when it has no credentials, and rejects non-hash keys", async () => {
    const offline: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const store = new S3BlobStore({ bucket: "docs", env: {}, fetch: offline });
    await expect(store.get(HASH)).rejects.toThrow(/ELEMNT_S3_ACCESS_KEY_ID/);
    await expect(store.get("../etc/passwd")).rejects.toThrow(/sha256/);
  });

  it("falls back to the EC2 instance role through IMDSv2", async () => {
    const s3 = fakeS3();
    const f: typeof fetch = async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.hostname !== "169.254.169.254") return s3.f(req);
      if (url.pathname === "/latest/api/token") return req.method === "PUT" ? new Response("imds-token") : new Response(null, { status: 405 });
      if (req.headers.get("x-aws-ec2-metadata-token") !== "imds-token") return new Response(null, { status: 401 });
      if (url.pathname.endsWith("/security-credentials/")) return new Response("elemnt-role\n");
      return Response.json({ AccessKeyId: "ASIAEC2", SecretAccessKey: "s", Token: "t", Expiration: new Date(Date.now() + 3600_000).toISOString() });
    };
    const store = new S3BlobStore({ bucket: "docs", fetch: f, env: {} });
    await store.put(HASH, "x");
    expect(s3.seen[0]!.auth).toContain("Credential=ASIAEC2/");
  });
});
