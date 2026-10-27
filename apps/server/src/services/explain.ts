import type { AiClient } from "./ai.js";
import { editorSystemPrompt } from "./ai.js";
import { HttpError } from "./errors.js";
import type { GitHubClient, RepoInfo, TreeEntry } from "./github.js";
import { createPage, findPage, normalizePath, type PageDeps } from "./pages.js";
import { linkRepo } from "./repos.js";

/**
 * "Explain this repo": read a GitHub repository through the API and have
 * Claude draft one rich explainer page for it, pinned to the commit it read.
 * The page lands as a draft linked to the repo, so drift checks keep it
 * current and a person publishes it.
 */

const MAX_FILES = 40;
const MAX_FILE = 12_000;
const MAX_TOTAL = 150_000;
const MAX_TREE = 1_500;

const SKIP = /(^|\/)(node_modules|vendor|dist|build|out|target|\.git|\.next|coverage|__pycache__|\.venv|venv|third_party|fixtures?|testdata|snapshots?)(\/|$)/i;
const BINARY = /\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|tgz|jar|wasm|woff2?|ttf|eot|mp4|mov|mp3|lock|min\.js|map)$/i;
const LOCKFILE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|poetry\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/i;
const MANIFEST = /^(package\.json|pyproject\.toml|setup\.py|requirements\.txt|go\.mod|Cargo\.toml|Gemfile|composer\.json|pom\.xml|build\.gradle(\.kts)?|Makefile|Dockerfile|docker-compose\.ya?ml|compose\.ya?ml|deno\.json|mix\.exs|CMakeLists\.txt)$/i;
const ENTRY = /(^|\/)(index|main|app|server|cli|cmd|lib|mod|__init__|__main__)\.[a-z]+$|^cmd\/[^/]+\/main\.go$|^src\/[^/]+\.[a-z]+$/i;
const CODE = /\.(ts|tsx|js|jsx|mjs|py|go|rs|rb|java|kt|swift|c|cc|cpp|h|hpp|cs|php|ex|exs|scala|clj|lua|sh|sql|proto|graphql|vue|svelte)$/i;

/** Ranks paths by how much they tell a newcomer: README first, then manifests, entry points, shallow code, docs. */
export function pickFiles(entries: TreeEntry[]): string[] {
  const blobs = entries.filter((e) => e.type === "blob" && !SKIP.test(e.path) && !BINARY.test(e.path) && !LOCKFILE.test(e.path) && (e.size ?? 0) < 200_000);
  const score = (p: string) => {
    const depth = p.split("/").length - 1;
    const name = p.split("/").pop()!;
    if (/^readme(\.[a-z]+)?$/i.test(p)) return 1000;
    if (MANIFEST.test(p)) return 900;
    if (/^(architecture|design|overview)\.md$/i.test(name) || /^docs\/(index|readme|architecture|overview)\.md$/i.test(p)) return 800;
    if (/^(contributing)\.md$/i.test(p)) return 500;
    if (MANIFEST.test(name) && depth <= 2) return 600 - depth * 50;
    if (ENTRY.test(p)) return 700 - depth * 40;
    if (/(^|\/)(test|tests|spec|__tests__)\//i.test(p) || /\.(test|spec)\.[a-z]+$/i.test(p)) return 100 - depth;
    if (CODE.test(p)) return 400 - depth * 40;
    if (/\.(md|ya?ml|toml|json)$/i.test(p)) return 200 - depth * 30;
    return 0;
  };
  return blobs
    .map((e) => ({ p: e.path, s: score(e.path) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.p.length - b.p.length)
    .slice(0, MAX_FILES)
    .map((x) => x.p);
}

/** The tree as indented text, skipping vendored and generated folders. */
export function outline(entries: TreeEntry[]): string {
  const kept = entries.filter((e) => !SKIP.test(e.path)).slice(0, MAX_TREE);
  const lines = kept.map((e) => `${"  ".repeat(e.path.split("/").length - 1)}${e.path.split("/").pop()}${e.type === "tree" ? "/" : ""}`);
  return lines.join("\n") + (entries.length > kept.length ? `\n… ${entries.length - kept.length} more paths` : "");
}

export const EXPLAIN_SCHEMA = {
  type: "object",
  properties: {
    source: { type: "string", description: "The complete Elemnt page source, frontmatter included." },
    citedPaths: { type: "array", items: { type: "string" }, description: "Repo paths (files or folders) the page explains; Elemnt watches them for drift." },
  },
  required: ["source", "citedPaths"],
  additionalProperties: false,
} as const;

export function explainPrompt(input: { info: RepoInfo; sha: string; tree: string; files: { path: string; text: string }[]; extra?: string }): string {
  const { info, sha } = input;
  const facts = [
    `Repository: ${info.repo} (${info.url})`,
    info.description && `Description: ${info.description}`,
    info.homepage && `Homepage: ${info.homepage}`,
    info.language && `Main language: ${info.language}`,
    info.license && `License: ${info.license}`,
    info.topics.length ? `Topics: ${info.topics.join(", ")}` : undefined,
    `Stars: ${info.stars}`,
    info.latestRelease && `Latest release: ${info.latestRelease.tag}`,
    `Commit read: ${sha}`,
  ].filter(Boolean);
  return `Write the Elemnt explainer page for this repository. It replaces a plain README as the front door: someone lands on it from GitHub or a shared link and should understand what the project is, why it exists and how it works, and want to try it.

<facts>
${facts.join("\n")}
</facts>

<tree>
${input.tree}
</tree>

${input.files.map((f) => `<file path="${f.path}">\n${f.text}\n</file>`).join("\n\n")}

How to write it:
- Frontmatter: title (the project's name and what it is, e.g. "Acme: a tiny HTTP router for Go") and a one-line summary.
- Open with a :::hero: what it is and the problem it solves, in two or three sentences for someone who has never seen it, with buttons to the quickstart (#quickstart) and the repo.
- Then ::repo{repo="${info.repo}"} for the live repo card.
- "How it works": a :::diagram (Mermaid flowchart) of the main parts and how data flows, then a sentence per part.
- "Quickstart" as :::steps with exact commands taken from the files. Use :::tabs or :::codegroup for real alternatives.
- "A tour of the code": a ::filetree{repo="${info.repo}" ref="${sha}" highlight="…"} of the important paths, then for the four to eight files that matter, a heading, why it exists, and one ::snippet{repo="${info.repo}" ref="${sha}" path="…" lines="a-b"} of the key lines where it helps. Line numbers must match the file as given.
- "Where to go next": contributing, docs, issues, as links.
- Every fact, command, name and number must come from the files above. If something isn't there, leave it out rather than guess.
- Link files as https://github.com/${info.repo}/blob/${sha}/PATH so the links stay correct.
- Make it engaging but scannable: short paragraphs, real structure, components only where they carry information. No :::widget.

Return the page as "source" and the paths it explains as "citedPaths".${input.extra ?? ""}`;
}

export async function explainRepo(
  deps: PageDeps,
  gh: GitHubClient,
  ai: AiClient,
  input: { repo: string; spaceId: string; path?: string; userId: string },
): Promise<{ pageId: string; path: string; commit: string; citedPaths: string[] }> {
  const info = await gh.info(input.repo);
  const commit = await gh.head(input.repo, info.defaultBranch);
  const tree = await gh.tree(input.repo, commit);
  const picked = pickFiles(tree.entries);
  if (picked.length === 0) throw new HttpError(422, "This repo has no files Elemnt can read (only binaries or vendored code).");

  let total = 0;
  const files: { path: string; text: string }[] = [];
  for (const path of picked) {
    if (total >= MAX_TOTAL) break;
    const text = await gh.file(input.repo, commit, path).catch(() => undefined);
    if (!text || text.includes("\u0000")) continue;
    const cut = text.length > MAX_FILE ? `${text.slice(0, MAX_FILE)}\n… (truncated, ${text.length} chars in total)` : text;
    files.push({ path, text: cut });
    total += cut.length;
  }

  const system = editorSystemPrompt(deps.elemnt.authoringGuide());
  const ask = (extra?: string) =>
    ai.json<{ source: string; citedPaths: string[] }>({
      system,
      prompt: explainPrompt({ info, sha: commit, tree: outline(tree.entries), files, ...(extra ? { extra } : {}) }),
      schema: EXPLAIN_SCHEMA,
      effort: "high",
    });
  let out = await ask();
  const check = deps.elemnt.compile(out.source);
  if (!check.ok) {
    const errs = check.diagnostics.filter((d) => d.severity === "error").map((d) => `line ${d.line ?? "?"}: ${d.message}`).join("\n");
    out = await ask(`\n\nA previous attempt had these errors; avoid them:\n${errs}`);
  }

  const known = new Set(tree.entries.map((e) => e.path));
  const cited = [...new Set(out.citedPaths.map((p) => p.replace(/^\/+|\/+$/g, "")))].filter((p) => known.has(p)).slice(0, 200);

  let path = normalizePath(input.path ?? input.repo.split("/")[1]!);
  for (let n = 2; await findPage(deps.db, input.spaceId, path); n++) path = normalizePath(`${input.path ?? input.repo.split("/")[1]!}-${n}`);
  const created = await createPage(deps, { spaceId: input.spaceId, path, source: out.source, authorId: input.userId, message: `Explainer for ${input.repo} at ${commit.slice(0, 7)}, drafted by Claude`, draft: true });
  await linkRepo(deps, gh, { pageId: created.pageId, repo: input.repo, branch: info.defaultBranch, commit, citedPaths: cited, userId: input.userId });
  return { pageId: created.pageId, path, commit, citedPaths: cited };
}
