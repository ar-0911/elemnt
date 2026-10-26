import { Container, getContainer } from "@cloudflare/containers";

/** Plain settings from wrangler.jsonc "vars", and secrets from `wrangler secret put`. */
interface Env {
  ELEMNT: DurableObjectNamespace<Elemnt>;
  [name: string]: unknown;
}

/** Every variable the server reads. Anything unset is left out so the server's defaults apply. */
const PASSED = [
  "DATABASE_URL",
  "ELEMNT_SECRET_KEY",
  "ELEMNT_PUBLIC_URL",
  "ELEMNT_SANDBOX_URL",
  "ELEMNT_WORKSPACE",
  "ELEMNT_OWNER_EMAIL",
  "ELEMNT_WIDGET_SELF_VERIFY",
  "ELEMNT_FONTS",
  "ELEMNT_S3_BUCKET",
  "ELEMNT_S3_ENDPOINT",
  "ELEMNT_S3_REGION",
  "ELEMNT_S3_ACCESS_KEY_ID",
  "ELEMNT_S3_SECRET_ACCESS_KEY",
  "ANTHROPIC_API_KEY",
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_TOKEN",
  "LINKEDIN_CLIENT_ID",
  "LINKEDIN_CLIENT_SECRET",
  "LINKEDIN_API_VERSION",
];

/** The Elemnt server, from apps/server/Dockerfile. It listens on 8787 and sleeps when idle. */
export class Elemnt extends Container<Env> {
  defaultPort = 8787;
  sleepAfter = "30m";

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    const vars: Record<string, string> = {};
    for (const name of PASSED) {
      const value = env[name];
      if (typeof value === "string" && value) vars[name] = value;
    }
    this.envVars = vars;
  }
}

export default {
  /**
   * Both hostnames (the app and the sandbox origin) go to the same container,
   * which tells them apart by Host, exactly as it does behind any other proxy.
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.ELEMNT, "main").fetch(request);
  },
};
