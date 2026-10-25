import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  ELEMNT_PUBLIC_URL: z.string().url().default("http://localhost:8787"),
  ELEMNT_BLOB_DIR: z.string().default("./data/blobs"),
  /** The built editor, served at /app. */
  ELEMNT_WEB_DIR: z.string().default("../web/dist"),
  ELEMNT_SECRET_KEY: z.string().min(1, "generate one with: openssl rand -base64 32"),
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
  anthropicApiKey?: string;
  linkedin?: { clientId: string; clientSecret: string; apiVersion: string };
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  return schema.parse(env);
}

export function configFromEnv(env: Env): Config {
  return {
    publicUrl: env.ELEMNT_PUBLIC_URL.replace(/\/$/, ""),
    workspaceSlug: env.ELEMNT_WORKSPACE,
    secretKey: env.ELEMNT_SECRET_KEY,
    ...(env.ANTHROPIC_API_KEY ? { anthropicApiKey: env.ANTHROPIC_API_KEY } : {}),
    ...(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET
      ? { linkedin: { clientId: env.LINKEDIN_CLIENT_ID, clientSecret: env.LINKEDIN_CLIENT_SECRET, apiVersion: env.LINKEDIN_API_VERSION } }
      : {}),
  };
}
