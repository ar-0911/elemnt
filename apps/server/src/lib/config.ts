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
  /**
   * Project websites answer at <site>.<this domain>, e.g. "adityapoc.xyz" gives
   * elemnt.adityapoc.xyz. Point a wildcard DNS record (*.<domain>) at this
   * server. Sites run their own JavaScript on their own origins; the app's
   * cookies are host-only, so they never reach a site. Defaults to "localhost" in
   * local development, so http://<site>.localhost:8787 works.
   */
  ELEMNT_SITES_DOMAIN: z.string().regex(/^[a-z0-9.-]+$/i).optional(),
  /** Lets workspace admins mark their own workspace verified (self-hosting). SaaS operators set false. */
  ELEMNT_WIDGET_SELF_VERIFY: z.enum(["true", "false"]).default("true"),
  /** Page styles load their fonts from Google Fonts; "off" keeps every font local (system font stacks). */
  ELEMNT_FONTS: z.enum(["google", "off"]).default("google"),
  ELEMNT_WORKSPACE: z.string().default("default"),
  /** Who can create an account once the workspace exists: "invite" (with an invite link) or "open" (anyone, as a viewer). */
  ELEMNT_SIGNUP: z.enum(["invite", "open"]).default("invite"),
  /**
   * For hosts where you can't run the bootstrap script (App Runner, Cloudflare
   * Containers): on the first start, when the workspace doesn't exist yet,
   * the server creates it with this owner and prints their API token once.
   */
  ELEMNT_OWNER_EMAIL: z.string().email().optional(),
  /**
   * Guards the very first sign-up on a server that's reachable from the
   * internet: until the workspace exists, /signup only works with
   * ?setup=<this code>. The installer generates one and prints the link.
   */
  ELEMNT_SETUP_CODE: z.string().min(16).optional(),
  /**
   * Hosted mode: this server hosts many workspaces, each at <slug>.<this domain>.
   * ELEMNT_PUBLIC_URL is then the domain itself (https://<domain>), where people
   * make an account and request a workspace. See docs/hosted.md.
   */
  ELEMNT_HOSTED_DOMAIN: z.string().regex(/^[a-z0-9.-]+$/i).optional(),
  /** Hosted mode: emails of the people who run the server (the /admin page), comma-separated. */
  ELEMNT_OPERATORS: z.string().optional(),
  /** Hosted mode: "on" makes new workspaces wait for an operator's approval. Off by default: they go live at once. */
  ELEMNT_HOSTED_APPROVAL: z.enum(["on", "off"]).default("off"),
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
  /** Anyone may sign up (as a viewer), not only people with an invite link. */
  signupOpen?: boolean;
  /** Needed to create the first account; see ELEMNT_SETUP_CODE. */
  setupCode?: string;
  /**
   * Hosted mode (ELEMNT_HOSTED_DOMAIN). On the main server config, `domain`
   * is set; on a workspace's own app, `home` is the main address to link back to.
   */
  hosted?: { domain: string; operators: string[]; home: string; approval: boolean };
  secretKey: string;
  /** Origin for sandboxed frames; see ELEMNT_SANDBOX_URL. */
  sandboxUrl?: string;
  /** Project websites live at <slug>.<sitesDomain>; see ELEMNT_SITES_DOMAIN. */
  sitesDomain?: string;
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
  const appHost = new URL(publicUrl).hostname;
  const sitesDomain = env.ELEMNT_SITES_DOMAIN?.toLowerCase().replace(/^\*?\./, "") ?? (appHost === "localhost" || appHost === "127.0.0.1" ? "localhost" : undefined);
  return {
    publicUrl,
    ...(sandboxUrl ? { sandboxUrl } : {}),
    ...(sitesDomain ? { sitesDomain } : {}),
    widgetSelfVerify: env.ELEMNT_WIDGET_SELF_VERIFY === "true",
    fonts: env.ELEMNT_FONTS === "google",
    workspaceSlug: env.ELEMNT_WORKSPACE,
    signupOpen: env.ELEMNT_SIGNUP === "open",
    ...(env.ELEMNT_SETUP_CODE ? { setupCode: env.ELEMNT_SETUP_CODE } : {}),
    ...(env.ELEMNT_HOSTED_DOMAIN
      ? {
          hosted: {
            domain: env.ELEMNT_HOSTED_DOMAIN.toLowerCase(),
            operators: (env.ELEMNT_OPERATORS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
            home: publicUrl,
            approval: env.ELEMNT_HOSTED_APPROVAL === "on",
          },
        }
      : {}),
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
