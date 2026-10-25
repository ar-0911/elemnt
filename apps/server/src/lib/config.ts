import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  ELEMNT_PUBLIC_URL: z.string().url().default("http://localhost:8787"),
  ELEMNT_BLOB_DIR: z.string().default("./data/blobs"),
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
  ELEMNT_WORKSPACE: z.string().default("default"),
  PORT: z.coerce.number().int().default(8787),
  /** Optional server-wide Anthropic key; a workspace's own key (Settings) takes precedence. */
  ANTHROPIC_API_KEY: z.string().optional(),
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
  anthropicApiKey?: string;
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
    workspaceSlug: env.ELEMNT_WORKSPACE,
    secretKey: env.ELEMNT_SECRET_KEY,
    ...(env.ANTHROPIC_API_KEY ? { anthropicApiKey: env.ANTHROPIC_API_KEY } : {}),
    ...(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET
      ? { linkedin: { clientId: env.LINKEDIN_CLIENT_ID, clientSecret: env.LINKEDIN_CLIENT_SECRET, apiVersion: env.LINKEDIN_API_VERSION } }
      : {}),
  };
}
