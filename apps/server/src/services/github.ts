import { createHmac, createSign } from "node:crypto";
import { safeEqual } from "../lib/crypto.js";
import { HttpError } from "./errors.js";

/**
 * Read-only GitHub access for explainer pages. With a GitHub App configured,
 * requests use a short-lived installation token for the repo; otherwise a
 * plain token, or no auth at all for public repos (low rate limit).
 * Nothing here writes to a repo.
 */
export interface GitHubConfig {
  apiUrl?: string;
  token?: string;
  appId?: string;
  /** PEM. Newlines may be written as \n in env files. */
  privateKey?: string;
  webhookSecret?: string;
}

export interface CompareResult {
  headSha: string;
  aheadBy: number;
  files: { filename: string; status: string; previousFilename?: string; patch?: string }[];
}

export interface RepoInfo {
  repo: string;
  url: string;
  description: string | null;
  homepage: string | null;
  stars: number;
  forks: number;
  language: string | null;
  license: string | null;
  topics: string[];
  defaultBranch: string;
  pushedAt: string | null;
  private: boolean;
  latestRelease: { tag: string; url: string; publishedAt: string | null } | null;
}

export interface TreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
}

export const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Accepts owner/name or any github.com URL into the repo. */
export function normalizeRepo(input: string): string {
  const m = input.trim().match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+\/[^/\s#?]+)/i);
  // GitHub names are case-insensitive; store one spelling so lookups match.
  const repo = (m ? m[1]! : input.trim()).replace(/\.git$/, "").toLowerCase();
  if (!REPO.test(repo)) throw new HttpError(400, "Use owner/name or a github.com URL for the repo.");
  return repo;
}

export function verifyWebhook(secret: string, body: string, signature: string | undefined): boolean {
  if (!signature) return false;
  return safeEqual(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`, signature);
}

function appJwt(appId: string, pem: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iat: now - 60, exp: now + 540, iss: appId })}`;
  return `${body}.${createSign("RSA-SHA256").update(body).sign(pem.replace(/\\n/g, "\n"), "base64url")}`;
}

export function githubClient(cfg: GitHubConfig, doFetch: typeof fetch) {
  const api = (cfg.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
  const tokens = new Map<string, { token: string; expires: number }>();

  async function call(path: string, auth: string | undefined, init: RequestInit = {}, raw = false) {
    const res = await doFetch(`${api}${path}`, {
      ...init,
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "elemnt", ...(auth ? { Authorization: auth } : {}), ...init.headers },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) throw new HttpError(404, "GitHub couldn't find that repo or commit. For a private repo, install the Elemnt GitHub App on it.");
    if (res.status === 401 || res.status === 403) {
      throw new HttpError(502, `GitHub refused access (${res.status}). For a private repo, install the Elemnt GitHub App on it or set GITHUB_TOKEN; anonymous access is also rate limited.`);
    }
    if (!res.ok) throw new HttpError(502, `GitHub returned ${res.status}.`);
    return (raw ? res.text() : res.json()) as Promise<Record<string, unknown>>;
  }

  async function authFor(repo: string): Promise<string | undefined> {
    if (cfg.appId && cfg.privateKey) {
      const hit = tokens.get(repo);
      if (hit && hit.expires - 60_000 > Date.now()) return `token ${hit.token}`;
      const jwt = `Bearer ${appJwt(cfg.appId, cfg.privateKey)}`;
      const inst = await call(`/repos/${repo}/installation`, jwt);
      const tok = await call(`/app/installations/${inst.id as number}/access_tokens`, jwt, {
        method: "POST",
        body: JSON.stringify({ repositories: [repo.split("/")[1]], permissions: { contents: "read", metadata: "read" } }),
      });
      tokens.set(repo, { token: tok.token as string, expires: Date.parse(tok.expires_at as string) });
      return `token ${tok.token as string}`;
    }
    return cfg.token ? `Bearer ${cfg.token}` : undefined;
  }

  const get = async (repo: string, path: string) => call(path, await authFor(repo));
  const getText = async (repo: string, path: string) => (await call(path, await authFor(repo), { headers: { Accept: "application/vnd.github.raw+json" } }, true)) as unknown as string;

  return {
    async defaultBranch(repo: string): Promise<string> {
      return (await get(repo, `/repos/${repo}`)).default_branch as string;
    },
    async head(repo: string, branch: string): Promise<string> {
      const b = await get(repo, `/repos/${repo}/branches/${encodeURIComponent(branch)}`);
      return (b.commit as { sha: string }).sha;
    },
    /** Public facts for a repo card. The latest release is optional: most repos have none. */
    async info(repo: string): Promise<RepoInfo> {
      const r = await get(repo, `/repos/${repo}`);
      const release = await get(repo, `/repos/${repo}/releases/latest`).catch(() => undefined);
      const license = r.license as { spdx_id?: string; name?: string } | null;
      return {
        repo: (r.full_name as string) ?? repo,
        url: r.html_url as string,
        description: (r.description as string | null) ?? null,
        homepage: (r.homepage as string | null) || null,
        stars: (r.stargazers_count as number) ?? 0,
        forks: (r.forks_count as number) ?? 0,
        language: (r.language as string | null) ?? null,
        license: license ? (license.spdx_id && license.spdx_id !== "NOASSERTION" ? license.spdx_id : (license.name ?? null)) : null,
        topics: (r.topics as string[] | undefined) ?? [],
        defaultBranch: r.default_branch as string,
        pushedAt: (r.pushed_at as string | null) ?? null,
        private: Boolean(r.private),
        latestRelease: release ? { tag: release.tag_name as string, url: release.html_url as string, publishedAt: (release.published_at as string | null) ?? null } : null,
      };
    },
    /** Every path at a commit or branch. GitHub truncates very large trees; we take what it gives. */
    async tree(repo: string, ref: string): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
      const t = await get(repo, `/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
      const entries = ((t.tree as { path: string; type: string; size?: number }[] | undefined) ?? [])
        .filter((e) => e.type === "blob" || e.type === "tree")
        .map((e) => ({ path: e.path, type: e.type as "blob" | "tree", ...(e.size !== undefined ? { size: e.size } : {}) }));
      return { entries, truncated: Boolean(t.truncated) };
    },
    /** One file's text at a ref. */
    async file(repo: string, ref: string, path: string): Promise<string> {
      const enc = path.split("/").map(encodeURIComponent).join("/");
      return getText(repo, `/repos/${repo}/contents/${enc}?ref=${encodeURIComponent(ref)}`);
    },
    async compare(repo: string, base: string, head: string): Promise<CompareResult> {
      const r = await get(repo, `/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
      const commits = (r.commits as { sha: string }[] | undefined) ?? [];
      const files = ((r.files as { filename: string; status: string; previous_filename?: string; patch?: string }[] | undefined) ?? []).map((f) => ({
        filename: f.filename,
        status: f.status,
        ...(f.previous_filename ? { previousFilename: f.previous_filename } : {}),
        ...(f.patch ? { patch: f.patch } : {}),
      }));
      return { headSha: commits.at(-1)?.sha ?? base, aheadBy: (r.ahead_by as number) ?? commits.length, files };
    },
  };
}

export type GitHubClient = ReturnType<typeof githubClient>;
