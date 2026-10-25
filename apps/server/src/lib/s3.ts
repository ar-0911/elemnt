import { AwsClient } from "aws4fetch";
import type { BlobStore } from "./blobs.js";

/**
 * Revision bodies in any S3-compatible bucket: Amazon S3, Cloudflare R2,
 * MinIO. Keys are `blobs/ab/<sha256>`; bodies never change, so a write that
 * races another write of the same hash is harmless.
 *
 * Credentials come from the options (static keys, as R2 and MinIO use), or,
 * on AWS, from the container role (App Runner, ECS, Fargate) when no keys are set.
 */
export interface S3Options {
  bucket: string;
  /** e.g. https://ACCOUNT.r2.cloudflarestorage.com; defaults to AWS S3 in `region`. */
  endpoint?: string;
  /** "auto" for R2. Default us-east-1. */
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  fetch?: typeof fetch;
  /** Container credential endpoint env, for tests. */
  env?: NodeJS.ProcessEnv;
}

interface Creds {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** ms since epoch; undefined for static keys. */
  expires?: number;
}

export class S3BlobStore implements BlobStore {
  readonly #o: S3Options;
  readonly #fetch: typeof fetch;
  readonly #base: string;
  #client?: { aws: AwsClient; expires?: number };

  constructor(options: S3Options) {
    this.#o = options;
    this.#fetch = options.fetch ?? fetch;
    const region = options.region ?? "us-east-1";
    const endpoint = (options.endpoint ?? `https://s3.${region}.amazonaws.com`).replace(/\/$/, "");
    // Path-style addressing works on S3, R2 and MinIO alike.
    this.#base = `${endpoint}/${encodeURIComponent(options.bucket)}`;
  }

  #url(hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Not a sha256 hash: ${hash}`);
    return `${this.#base}/blobs/${hash.slice(0, 2)}/${hash}`;
  }

  async #aws(): Promise<AwsClient> {
    const c = this.#client;
    if (c && (!c.expires || c.expires - Date.now() > 5 * 60_000)) return c.aws;
    const creds = await this.#credentials();
    const aws = new AwsClient({
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      ...(creds.sessionToken ? { sessionToken: creds.sessionToken } : {}),
      service: "s3",
      region: this.#o.region ?? "us-east-1",
      retries: 3,
    });
    this.#client = { aws, ...(creds.expires ? { expires: creds.expires } : {}) };
    return aws;
  }

  async #credentials(): Promise<Creds> {
    const o = this.#o;
    if (o.accessKeyId && o.secretAccessKey) return { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey, ...(o.sessionToken ? { sessionToken: o.sessionToken } : {}) };
    const env = o.env ?? process.env;
    const url = env.AWS_CONTAINER_CREDENTIALS_FULL_URI ?? (env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ? `http://169.254.170.2${env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI}` : undefined);
    let res: Response;
    if (url) {
      const token = env.AWS_CONTAINER_AUTHORIZATION_TOKEN;
      res = await this.#fetch(url, token ? { headers: { Authorization: token } } : {});
    } else res = await this.#instanceRole();
    if (!res.ok) throw new Error(`S3 blob store: role credentials request failed (${res.status}).`);
    const j = (await res.json()) as { AccessKeyId: string; SecretAccessKey: string; Token?: string; Expiration?: string };
    return { accessKeyId: j.AccessKeyId, secretAccessKey: j.SecretAccessKey, ...(j.Token ? { sessionToken: j.Token } : {}), ...(j.Expiration ? { expires: Date.parse(j.Expiration) } : {}) };
  }

  /** EC2 instance role through IMDSv2, for hosts with no container credentials. */
  async #instanceRole(): Promise<Response> {
    const imds = "http://169.254.169.254/latest";
    const fail = () => {
      throw new Error("S3 blob store: set ELEMNT_S3_ACCESS_KEY_ID and ELEMNT_S3_SECRET_ACCESS_KEY, or run with an AWS role.");
    };
    const session = await this.#fetch(`${imds}/api/token`, { method: "PUT", headers: { "X-aws-ec2-metadata-token-ttl-seconds": "21600" }, signal: AbortSignal.timeout(1000) }).catch(fail);
    if (!session.ok) fail();
    const headers = { "X-aws-ec2-metadata-token": await session.text() };
    const roles = await this.#fetch(`${imds}/meta-data/iam/security-credentials/`, { headers });
    const role = roles.ok ? (await roles.text()).split("\n")[0]?.trim() : undefined;
    if (!role) fail();
    return this.#fetch(`${imds}/meta-data/iam/security-credentials/${role}`, { headers });
  }

  async #send(url: string, init: RequestInit): Promise<Response> {
    const aws = await this.#aws();
    const req = await aws.sign(url, init);
    return this.#fetch(req);
  }

  async put(hash: string, body: string) {
    const res = await this.#send(this.#url(hash), { method: "PUT", body, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    if (!res.ok) throw new Error(`S3 blob store: PUT ${hash} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  async get(hash: string) {
    const res = await this.#send(this.#url(hash), { method: "GET" });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`S3 blob store: GET ${hash} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    return res.text();
  }
}
