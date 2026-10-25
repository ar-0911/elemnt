import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { apiTokens, oauthClients, oauthCodes } from "../db/schema.js";
import { randomToken, safeEqual, sha256 } from "../lib/crypto.js";
import { newId } from "../lib/ids.js";

/**
 * The OAuth 2.1 authorization server MCP clients (Claude, Claude Code) use to
 * connect: dynamic client registration, authorization code with PKCE S256,
 * and bearer tokens that are ordinary Elemnt API tokens with an expiry.
 */

export const TOKEN_TTL_S = 60 * 60 * 24 * 30;
const CODE_TTL_MS = 5 * 60 * 1000;

export class OAuthError extends Error {
  constructor(
    readonly code: "invalid_request" | "invalid_client" | "invalid_grant" | "unsupported_grant_type" | "invalid_redirect_uri" | "invalid_client_metadata",
    message: string,
  ) {
    super(message);
  }
}

export function metadata(publicUrl: string) {
  return {
    authorizationServer: {
      issuer: publicUrl,
      authorization_endpoint: `${publicUrl}/oauth/authorize`,
      token_endpoint: `${publicUrl}/oauth/token`,
      registration_endpoint: `${publicUrl}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["docs"],
    },
    protectedResource: {
      resource: `${publicUrl}/mcp`,
      authorization_servers: [publicUrl],
      bearer_methods_supported: ["header"],
      scopes_supported: ["docs"],
      resource_name: "Elemnt",
    },
  };
}

/** https anywhere, or http only to loopback (native and CLI clients). */
function allowedRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

export async function registerClient(db: Db, body: { client_name?: unknown; redirect_uris?: unknown }) {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (uris.length === 0 || uris.length > 10) throw new OAuthError("invalid_redirect_uri", "Send between 1 and 10 redirect_uris.");
  const bad = uris.find((u) => !allowedRedirect(u));
  if (bad) throw new OAuthError("invalid_redirect_uri", `Redirect URI not allowed: ${bad}`);
  const name = typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 100) : "MCP client";
  const id = newId("oac");
  await db.insert(oauthClients).values({ id, name, redirectUris: uris });
  return {
    client_id: id,
    client_name: name,
    redirect_uris: uris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    client_id_issued_at: Math.floor(Date.now() / 1000),
  };
}

export async function findClient(db: Db, clientId: string) {
  const [client] = await db.select().from(oauthClients).where(eq(oauthClients.id, clientId));
  return client;
}

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
}

/** Validates an authorization request before showing the consent screen. */
export async function checkAuthorize(db: Db, q: Record<string, string | undefined>): Promise<{ params: AuthorizeParams; clientName: string }> {
  if (q.response_type !== "code") throw new OAuthError("invalid_request", "response_type must be code.");
  const client = q.client_id ? await findClient(db, q.client_id) : undefined;
  if (!client) throw new OAuthError("invalid_client", "Unknown client_id. Register the client first.");
  if (!q.redirect_uri || !client.redirectUris.includes(q.redirect_uri)) throw new OAuthError("invalid_redirect_uri", "redirect_uri doesn't match the registered ones.");
  if (q.code_challenge_method !== "S256" || !q.code_challenge || !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge)) {
    throw new OAuthError("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  }
  return { params: { clientId: client.id, redirectUri: q.redirect_uri, codeChallenge: q.code_challenge, ...(q.state ? { state: q.state } : {}) }, clientName: client.name };
}

export async function issueCode(db: Db, params: AuthorizeParams, userId: string): Promise<string> {
  const code = randomToken("code");
  await db.insert(oauthCodes).values({
    codeHash: sha256(code),
    clientId: params.clientId,
    userId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  return code;
}

export async function exchangeCode(db: Db, form: Record<string, string | undefined>) {
  if (form.grant_type !== "authorization_code") throw new OAuthError("unsupported_grant_type", "Only authorization_code is supported.");
  if (!form.code || !form.code_verifier || !form.client_id) throw new OAuthError("invalid_request", "code, code_verifier and client_id are required.");
  // Delete-and-return makes the code single use even under concurrent requests.
  const [row] = await db
    .delete(oauthCodes)
    .where(and(eq(oauthCodes.codeHash, sha256(form.code)), gt(oauthCodes.expiresAt, new Date())))
    .returning();
  if (!row || row.clientId !== form.client_id) throw new OAuthError("invalid_grant", "The code is invalid or expired.");
  if (form.redirect_uri && form.redirect_uri !== row.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri doesn't match.");
  const challenge = createHash("sha256").update(form.code_verifier).digest("base64url");
  if (!safeEqual(challenge, row.codeChallenge)) throw new OAuthError("invalid_grant", "PKCE verification failed.");

  const client = await findClient(db, row.clientId);
  const token = randomToken("elm");
  await db.insert(apiTokens).values({
    id: newId("tok"),
    userId: row.userId,
    tokenHash: sha256(token),
    name: `MCP: ${client?.name ?? "client"}`,
    clientId: row.clientId,
    expiresAt: new Date(Date.now() + TOKEN_TTL_S * 1000),
  });
  return { access_token: token, token_type: "Bearer", expires_in: TOKEN_TTL_S, scope: "docs" };
}
