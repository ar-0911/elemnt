#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { addCardToReadme, ApiError, client, configPath, loadConfig, repoFromRemote, saveConfig, waitForJob } from "./lib.js";

const HELP = `elemnt: explain a GitHub repo with an interactive Elemnt page

Usage
  npx elemnt login                 Connect to your Elemnt server
  npx elemnt explain [repo]        Have Claude draft an explainer for this repo
  npx elemnt readme [repo]         Print the README card that links to it
  npx elemnt sync [repo]           Check linked pages against the latest commit

Options
  --space <slug>    Space to put the page in (explain)
  --path <path>     Page path (explain; defaults to the repo name)
  --branch <name>   Branch to check (sync)
  --yes             Add the card to README.md without asking (explain)

[repo] is owner/name or a GitHub URL; it defaults to this folder's origin remote.
ELEMNT_SERVER and ELEMNT_TOKEN override the saved login.`;

const bold = (s: string) => (stdout.isTTY ? `\x1b[1m${s}\x1b[22m` : s);
const dim = (s: string) => (stdout.isTTY ? `\x1b[2m${s}\x1b[22m` : s);

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function currentRepo(arg: string | undefined): string {
  if (arg) {
    const r = repoFromRemote(arg.includes("github.com") ? arg : `github.com/${arg}`);
    if (r) return r;
    throw new Error(`"${arg}" isn't a GitHub repo. Use owner/name or a github.com URL.`);
  }
  let remote = "";
  try {
    remote = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    throw new Error("This folder isn't a git repo with an origin remote. Pass the repo, e.g. npx elemnt explain owner/name");
  }
  const repo = repoFromRemote(remote);
  if (!repo) throw new Error(`The origin remote (${remote.trim()}) isn't on GitHub. Elemnt explainers read GitHub repos.`);
  return repo;
}

async function api() {
  const cfg = await loadConfig();
  if (!cfg.server || !cfg.token) throw new Error("Not logged in. Run: npx elemnt login");
  return { cfg, elemnt: client(cfg.server, cfg.token) };
}

async function login() {
  const saved = await loadConfig();
  const server = (await ask(`Elemnt server${saved.server ? ` (${saved.server})` : ""}: `)) || saved.server;
  if (!server) throw new Error("An Elemnt server URL is required, e.g. https://docs.example.com");
  console.log(dim(`Create a token at ${server.replace(/\/+$/, "")}/app/ → Settings → Account → API tokens.`));
  const token = await ask("API token: ");
  const me = await client(server, token).me();
  await saveConfig({ server: server.replace(/\/+$/, ""), token });
  console.log(`Signed in as ${bold(me.name || me.email)} (${me.role ?? "no role"}). Saved to ${configPath()}`);
}

async function explain(repoArg: string | undefined, opts: { space?: string; path?: string; yes?: boolean }) {
  const repo = currentRepo(repoArg);
  const { elemnt } = await api();
  let space = opts.space;
  if (!space) {
    const spaces = await elemnt.spaces();
    if (!spaces.length) throw new Error("Your workspace has no spaces yet. Create one in the editor first.");
    space = (spaces.find((s) => s.visibility === "public") ?? spaces[0]!).slug;
  }
  console.log(`Explaining ${bold(repo)} into the ${bold(space)} space. Claude reads the repo and drafts the page; this takes a minute or two.`);
  const { id } = await elemnt.explain({ repo, space, ...(opts.path ? { path: opts.path } : {}) });
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const job = await waitForJob(() => elemnt.job(id), {
    tick: (ms) => stdout.isTTY && stdout.write(`\r${frames[i++ % frames.length]} Reading and writing… ${Math.round(ms / 1000)}s `),
  });
  if (stdout.isTTY) stdout.write("\r\x1b[K");
  if (job.status === "failed" || !job.result) throw new Error(job.error ?? "Explaining failed.");
  const r = job.result;
  console.log(`\n${bold("Draft ready:")} ${r.editUrl}`);
  console.log(dim(`Pinned to ${r.commit.slice(0, 7)}. Elemnt watches ${r.citedPaths.length} path${r.citedPaths.length === 1 ? "" : "s"} and suggests updates when they change.`));
  console.log(`Review it, then press Publish. Readers will find it at ${r.shortUrl}\n`);
  await offerReadme(r.card, opts.yes);
}

async function offerReadme(card: string, yes?: boolean) {
  console.log(`${bold("README card")} (shows the page's title and summary, links to the explainer):\n\n${card}\n`);
  if (!existsSync("README.md")) return;
  const answer = yes ? "y" : await ask("Add it to README.md under the title? [y/N] ");
  if (!/^y(es)?$/i.test(answer)) return;
  const before = readFileSync("README.md", "utf8");
  const after = addCardToReadme(before, card);
  if (after === before) return console.log("README.md already has the Elemnt card.");
  writeFileSync("README.md", after);
  console.log("Added. Commit README.md when you're happy with it; the page itself stays in Elemnt.");
}

async function readme(repoArg: string | undefined) {
  const repo = currentRepo(repoArg);
  const { cfg } = await api();
  const short = `${cfg.server}/r/${repo}`;
  console.log(`<a href="${short}">\n  <picture>\n    <source media="(prefers-color-scheme: dark)" srcset="${short}/card.svg?theme=dark">\n    <img alt="${repo}, explained on Elemnt" src="${short}/card.svg">\n  </picture>\n</a>\n\nOr a small badge:\n\n[![Explained on Elemnt](${short}/badge.svg)](${short})`);
}

async function sync(repoArg: string | undefined, branch: string | undefined) {
  const repo = currentRepo(repoArg);
  const { elemnt } = await api();
  const out = await elemnt.sync(repo, branch);
  console.log(out.checking ? `Checking ${out.checking} page${out.checking === 1 ? "" : "s"}. Changes arrive as suggestions:\n${out.pages.map((p) => `  ${p}`).join("\n")}` : `No Elemnt page is linked to ${repo}${branch ? ` on ${branch}` : ""}.`);
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { space: { type: "string" }, path: { type: "string" }, branch: { type: "string" }, yes: { type: "boolean", short: "y" }, help: { type: "boolean", short: "h" } },
  });
  const [command, repo] = positionals;
  if (values.help || !command || command === "help") return console.log(HELP);
  if (command === "login") return login();
  if (command === "explain") return explain(repo, values);
  if (command === "readme") return readme(repo);
  if (command === "sync") return sync(repo, values.branch);
  console.error(`Unknown command "${command}".\n\n${HELP}`);
  process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof ApiError && err.status === 401 ? "Your Elemnt token was rejected. Run: npx elemnt login" : err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
