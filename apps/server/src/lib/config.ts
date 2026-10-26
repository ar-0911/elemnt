import { z } from "zod";
import type { GitHubConfig } from "../services/github.js";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  ELEMNT_PUBLIC_URL: z.string().url().default("http://localhost:8787"),
  ELEMNT_BLOB_DIR: z.string().default("./data/blobs"),
  /**
   * Store revision bodies in an S3-compatible bucket (Amazon S3, Cloudflare R2,
   * MinIO) instead of ELEMNT_BLOB_DIR. Needed wherever the disk isn't durable.
   */
  ELEMNT_S3_BUCKET: z.string().optional(),
  /** R2: https://ACCOUNT_ID.r2.cloudflarestorage.com. Leave unset for AWS S3. */
  ELEMNT_S3_ENDPOINT: z.string().url().optional(),
  /** "auto" for R2. */
  ELEMNT_S3_REGION: z.string().default("us-east-1"),
  /** Static keys (R2, MinIO). On AWS, leave unset and give the container a role. */
  ELEMNT_S3_ACCESS_KEY_ID: z.string().optional(),
  ELEMNT_S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** The built editor, served at /app. */
  ELEMNT_WEB_DIR: z.string().default("../web/dist"),
  ELEMNT_SECRET_KEY: z.string().min(1, "generate one with: openssl rand -base64 32"),
  /**
   * Origin that serves widget and runnable-code frames. It must differ from
   * ELEMNT_PUBLIC_URL so sandboxed code never shares the app's origin, e.g.
   * https://acme.elemntusercontent.com pointing at this same server.
   */
  ELEMNT_SANDBOX_URL: z.string().url().optional(),
  /** Lets workspace admins mark their own workspace verified (self-hosting). SaaS operators set false. */
  ELEMNT_WIDGET_SELF_VERIFY: z.enum(["true", "false"]).default("true"),
  /** Page styles load their fonts from Google Fonts; "off" keeps every font local (system font stacks). */
  ELEMNT_FONTS: z.enum(["google", "off"]).default("google"),
  ELEMNT_WORKSPACE: z.string().default("default"),
  /**
   * For hosts where you can't run the bootstrap script (App Runner, Cloudflare
   * Containers): on the first start, when the workspace doesn't exist yet,
   * the server creates it with this owner and prints their API token once.
   */
  ELEMNT_OWNER_EMAIL: z.string().email().optional(),
  PORT: z.coerce.number().int().default(8787),
  /** Optional server-wide Anthropic key; a workspace's own key (Settings) takes precedence. */
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Read-only GitHub access for explainer pages: a GitHub App (preferred) or a token. Public repos work without either. */
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  /** LinkedIn's versioned REST API wants a YYYYMM header; versions retire after about a year. */
  LINKEDIN_API_VERSION: z.string().regex(/^\d{6}$/).default("202509"),
});

export type Env = z.infer<typeof schema>;

export interface Config {
  publicUrl: string;
  workspaceSlug: string;
  secretKey: string;
  /** Origin for sandboxed frames; see ELEMNT_SANDBOX_URL. */
  sandboxUrl?: string;
  widgetSelfVerify?: boolean;
  /** Load page-style fonts from Google Fonts. Default true. */
  fonts?: boolean;
  anthropicApiKey?: string;
  github?: GitHubConfig;
  linkedin?: { clientId: string; clientSecret: string; apiVersion: string };
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  return schema.parse(env);
}

/**
 * Local development gets a separate sandbox origin for free: localhost and
 * 127.0.0.1 are different origins served by the same process.
 */
export function defaultSandboxUrl(publicUrl: string): string | undefined {
  const u = new URL(publicUrl);
  if (u.hostname === "localhost") u.hostname = "127.0.0.1";
  else if (u.hostname === "127.0.0.1") u.hostname = "localhost";
  else return undefined;
  return u.origin;
}

export function configFromEnv(env: Env): Config {
  const publicUrl = env.ELEMNT_PUBLIC_URL.replace(/\/$/, "");
  const sandboxUrl = env.ELEMNT_SANDBOX_URL?.replace(/\/$/, "") ?? defaultSandboxUrl(publicUrl);
  if (!sandboxUrl) console.warn("ELEMNT_SANDBOX_URL is not set: widgets and runnable code are off. Point a second hostname at this server and set it.");
  else if (new URL(sandboxUrl).origin === new URL(publicUrl).origin) throw new Error("ELEMNT_SANDBOX_URL must be a different origin from ELEMNT_PUBLIC_URL.");
  return {
    publicUrl,
    ...(sandboxUrl ? { sandboxUrl } : {}),
    widgetSelfVerify: env.ELEMNT_WIDGET_SELF_VERIFY === "true",
    fonts: env.ELEMNT_FONTS === "google",
    workspaceSlug: env.ELEMNT_WORKSPACE,
    secretKey: env.ELEMNT_SECRET_KEY,
    github: {
      ...(env.GITHUB_APP_ID ? { appId: env.GITHUB_APP_ID } : {}),
      ...(env.GITHUB_APP_PRIVATE_KEY ? { privateKey: env.GITHUB_APP_PRIVATE_KEY } : {}),
      ...(env.GITHUB_WEBHOOK_SECRET ? { webhookSecret: env.GITHUB_WEBHOOK_SECRET } : {}),
      ...(env.GITHUB_TOKEN ? { token: env.GITHUB_TOKEN } : {}),
    },
    ...(env.ANTHROPIC_API_KEY ? { anthropicApiKey: env.ANTHROPIC_API_KEY } : {}),
    ...(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET
      ? { linkedin: { clientId: env.LINKEDIN_CLIENT_ID, clientSecret: env.LINKEDIN_CLIENT_SECRET, apiVersion: env.LINKEDIN_API_VERSION } }
      : {}),
  };
}

/** The blob store the environment asks for: an S3-compatible bucket, or the local disk. */
export async function blobStoreFromEnv(env: Env) {
  if (env.ELEMNT_S3_BUCKET) {
    const { S3BlobStore } = await import("./s3.js");
    return new S3BlobStore({
      bucket: env.ELEMNT_S3_BUCKET,
      region: env.ELEMNT_S3_REGION,
      ...(env.ELEMNT_S3_ENDPOINT ? { endpoint: env.ELEMNT_S3_ENDPOINT } : {}),
      ...(env.ELEMNT_S3_ACCESS_KEY_ID && env.ELEMNT_S3_SECRET_ACCESS_KEY ? { accessKeyId: env.ELEMNT_S3_ACCESS_KEY_ID, secretAccessKey: env.ELEMNT_S3_SECRET_ACCESS_KEY } : {}),
    });
  }
  const { FsBlobStore } = await import("./blobs.js");
  return new FsBlobStore(env.ELEMNT_BLOB_DIR);
}
