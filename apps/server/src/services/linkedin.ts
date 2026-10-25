import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { linkedinAccounts, linkedinPosts } from "../db/schema.js";
import type { SecretBox } from "../lib/crypto.js";
import { newId } from "../lib/ids.js";
import { HttpError } from "./errors.js";

export interface LinkedInConfig {
  clientId: string;
  clientSecret: string;
  apiVersion: string;
}

type Fetch = typeof fetch;

/** Sign in with OpenID Connect (who you are) plus Share on LinkedIn (post as you). */
const SCOPES = ["openid", "profile", "w_member_social"];

/** The page URL with UTM tags, so views from the post show up as LinkedIn in page stats. */
export function trackedUrl(pageUrl: string, campaign: string): string {
  const url = new URL(pageUrl);
  url.searchParams.set("utm_source", "linkedin");
  url.searchParams.set("utm_medium", "social");
  url.searchParams.set("utm_campaign", campaign);
  return url.toString();
}

/** LinkedIn's share dialog. Needs no app, no login on our side. */
export function shareDialogUrl(pageUrl: string): string {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}`;
}

export function authorizeUrl(cfg: LinkedInConfig, redirectUri: string, state: string): string {
  const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", SCOPES.join(" "));
  return url.toString();
}

async function expectOk(res: Response, what: string) {
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  throw new HttpError(502, `LinkedIn ${what} failed (${res.status}). ${body.slice(0, 300)}`.trim());
}

export async function connectAccount(
  deps: { db: Db; box: SecretBox; fetch: Fetch },
  cfg: LinkedInConfig,
  input: { userId: string; code: string; redirectUri: string },
) {
  const tokenRes = await deps.fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
  });
  await expectOk(tokenRes, "sign-in");
  const { access_token, expires_in } = (await tokenRes.json()) as { access_token: string; expires_in: number };

  const meRes = await deps.fetch("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${access_token}` } });
  await expectOk(meRes, "profile lookup");
  const me = (await meRes.json()) as { sub: string; name?: string };

  const row = {
    userId: input.userId,
    memberId: me.sub,
    name: me.name ?? null,
    accessTokenCiphertext: deps.box.seal(access_token),
    expiresAt: new Date(Date.now() + expires_in * 1000),
  };
  await deps.db.insert(linkedinAccounts).values(row).onConflictDoUpdate({ target: linkedinAccounts.userId, set: row });
  return { name: row.name, expiresAt: row.expiresAt };
}

export async function getAccount(db: Db, userId: string) {
  const [account] = await db.select().from(linkedinAccounts).where(eq(linkedinAccounts.userId, userId));
  return account;
}

/** Publishes a link post on the member's own feed through the versioned Posts API. */
export async function postToLinkedIn(
  deps: { db: Db; box: SecretBox; fetch: Fetch },
  cfg: LinkedInConfig,
  input: { userId: string; pageId: string; pageUrl: string; campaign: string; title: string; description?: string; commentary: string },
) {
  const account = await getAccount(deps.db, input.userId);
  if (!account) throw new HttpError(400, "Connect your LinkedIn account first.");
  if (account.expiresAt.getTime() <= Date.now()) throw new HttpError(400, "Your LinkedIn connection has expired. Connect it again.");

  const sharedUrl = trackedUrl(input.pageUrl, input.campaign);
  const res = await deps.fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${deps.box.open(account.accessTokenCiphertext)}`,
      "Content-Type": "application/json",
      "LinkedIn-Version": cfg.apiVersion,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author: `urn:li:person:${account.memberId}`,
      commentary: input.commentary,
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { article: { source: sharedUrl, title: input.title, ...(input.description ? { description: input.description } : {}) } },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });
  await expectOk(res, "post");
  const postUrn = res.headers.get("x-restli-id") ?? "";
  await deps.db.insert(linkedinPosts).values({ id: newId("lip"), pageId: input.pageId, userId: input.userId, postUrn, sharedUrl });
  return { postUrn, sharedUrl, postUrl: postUrn ? `https://www.linkedin.com/feed/update/${postUrn}/` : undefined };
}
