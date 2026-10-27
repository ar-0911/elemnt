import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** owner/name from a git remote (https or ssh), or undefined when it isn't GitHub. */
export function repoFromRemote(remote: string): string | undefined {
  const m = remote.trim().match(/github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : undefined;
}

export interface Config {
  server?: string;
  token?: string;
}

export const configPath = () => join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "elemnt", "config.json");

export async function loadConfig(path = configPath()): Promise<Config> {
  const file = await readFile(path, "utf8").then((s) => JSON.parse(s) as Config).catch(() => ({}) as Config);
  return {
    ...file,
    ...(process.env.ELEMNT_SERVER ? { server: process.env.ELEMNT_SERVER } : {}),
    ...(process.env.ELEMNT_TOKEN ? { token: process.env.ELEMNT_TOKEN } : {}),
  };
}

/** Saved readable only by you: it holds an API token. */
export async function saveConfig(config: Config, path = configPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function client(server: string, token: string, doFetch: typeof fetch = fetch) {
  const base = server.replace(/\/+$/, "");
  async function call<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
    const res = await doFetch(`${base}${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new ApiError(res.status, body.error ?? `${base} answered ${res.status}.`);
    return body as T;
  }
  return {
    me: () => call<{ email: string; name?: string | null; role: string | null }>("/api/me"),
    spaces: () => call<{ slug: string; name: string; visibility: string }[]>("/api/spaces"),
    explain: (input: { repo: string; space: string; path?: string }) => call<{ id: string }>("/api/explain", { method: "POST", json: input }),
    job: (id: string) => call<ExplainJob>(`/api/explain/${encodeURIComponent(id)}`),
    sync: (repo: string, branch?: string) => call<{ checking: number; pages: string[] }>(`/api/repos/${repo}/sync`, { method: "POST", json: branch ? { branch } : {} }),
  };
}

export interface ExplainJob {
  status: "running" | "done" | "failed";
  repo: string;
  error?: string;
  result?: { pageId: string; path: string; space: string; commit: string; citedPaths: string[]; editUrl: string; shortUrl: string; badge: string; card: string };
}

/** Polls until the job finishes. `tick` runs between polls, for a spinner. */
export async function waitForJob(get: () => Promise<ExplainJob>, opts: { intervalMs?: number; timeoutMs?: number; tick?: (elapsedMs: number) => void } = {}): Promise<ExplainJob> {
  const start = Date.now();
  for (;;) {
    const job = await get();
    if (job.status !== "running") return job;
    if (Date.now() - start > (opts.timeoutMs ?? 10 * 60_000)) throw new Error("Gave up waiting after 10 minutes. The draft may still appear in Elemnt.");
    opts.tick?.(Date.now() - start);
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 2500));
  }
}

const CARD_MARK = "<!-- elemnt -->";

/** Puts the card under the README's first heading (or at the top), once. */
export function addCardToReadme(readme: string, card: string): string {
  if (readme.includes(CARD_MARK)) return readme;
  const block = `${CARD_MARK}\n${card}\n${CARD_MARK}\n`;
  const lines = readme.split("\n");
  const heading = lines.findIndex((l) => /^#\s/.test(l));
  if (heading === -1) return `${block}\n${readme}`;
  lines.splice(heading + 1, 0, "", block.trimEnd());
  return lines.join("\n");
}
