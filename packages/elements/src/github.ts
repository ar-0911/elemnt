import { claim, make } from "./theme.js";

/**
 * Fills in ::repo, ::filetree and ::snippet from the Elemnt server's GitHub
 * endpoints. Until (or unless) that works, the server-rendered link stays, so
 * a failed lookup degrades to a plain GitHub link rather than an error.
 */

interface RepoInfo {
  repo: string;
  url: string;
  description: string | null;
  homepage: string | null;
  stars: number;
  forks: number;
  language: string | null;
  license: string | null;
  topics: string[];
  latestRelease: { tag: string; url: string } | null;
}

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k` : String(n));
const repoPath = (repo: string) => repo.split("/").map(encodeURIComponent).join("/");

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

export function enhanceGithub(root: ParentNode, base = ""): void {
  for (const el of root.querySelectorAll<HTMLElement>(".elemnt-repo[data-repo]")) if (claim(el)) void repoCard(el, base);
  for (const el of root.querySelectorAll<HTMLElement>(".elemnt-filetree[data-repo]")) if (claim(el)) void fileTree(el, base);
  for (const el of root.querySelectorAll<HTMLElement>(".elemnt-snippet[data-repo]")) if (claim(el)) void codeSnippet(el, base);
}

async function repoCard(el: HTMLElement, base: string) {
  try {
    const r = await getJson<RepoInfo>(`${base}/api/github/${repoPath(el.dataset.repo!)}`);
    const stat = (label: string, value: string) => make("span", { className: "elemnt-repo-stat" }, make("strong", { textContent: value }), ` ${label}`);
    const stats = make("div", { className: "elemnt-repo-stats" }, stat("stars", compact(r.stars)), stat("forks", compact(r.forks)));
    if (r.language) stats.append(stat("", r.language));
    if (r.license) stats.append(stat("license", r.license));
    if (r.latestRelease) stats.append(make("a", { className: "elemnt-repo-release", href: r.latestRelease.url, textContent: r.latestRelease.tag }));
    const head = make("div", { className: "elemnt-repo-head" }, make("span", { className: "elemnt-repo-mark", textContent: "⌥" }), make("a", { className: "elemnt-repo-name", href: r.url, textContent: r.repo }));
    const body = make("div", { className: "elemnt-repo-body" }, head);
    if (r.description) body.append(make("p", { className: "elemnt-repo-desc", textContent: r.description }));
    if (r.topics.length) body.append(make("div", { className: "elemnt-repo-topics" }, ...r.topics.slice(0, 6).map((t) => make("span", { textContent: t }))));
    body.append(stats);
    const actions = make("div", { className: "elemnt-repo-actions" }, make("a", { href: r.url, textContent: "View on GitHub" }));
    if (r.homepage) actions.append(make("a", { href: r.homepage, textContent: "Website" }));
    el.replaceChildren(body, actions);
    el.dataset.ready = "";
  } catch {
    /* keep the plain link */
  }
}

interface Node {
  name: string;
  path: string;
  dir: boolean;
  children: Map<string, Node>;
}

async function fileTree(el: HTMLElement, base: string) {
  try {
    const repo = el.dataset.repo!;
    const ref = el.dataset.ref ?? "HEAD";
    const prefix = (el.dataset.path ?? "").replace(/^\/+|\/+$/g, "");
    const depth = Number(el.dataset.depth ?? 2);
    const marked = new Set((el.dataset.highlight ?? "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean));
    const { entries, truncated } = await getJson<{ entries: { path: string; type: "blob" | "tree" }[]; truncated: boolean }>(`${base}/api/github/${repoPath(repo)}/tree?ref=${encodeURIComponent(ref)}`);

    const top: Node = { name: prefix || repo.split("/")[1]!, path: prefix, dir: true, children: new Map() };
    for (const e of entries) {
      if (prefix && e.path !== prefix && !e.path.startsWith(`${prefix}/`)) continue;
      const rel = prefix ? e.path.slice(prefix.length + 1) : e.path;
      if (!rel) continue;
      let at = top;
      const parts = rel.split("/");
      parts.forEach((part, i) => {
        const path = [prefix, ...parts.slice(0, i + 1)].filter(Boolean).join("/");
        let next = at.children.get(part);
        if (!next) at.children.set(part, (next = { name: part, path, dir: i < parts.length - 1 || e.type === "tree", children: new Map() }));
        at = next;
      });
    }
    // A highlighted file opens every folder on its way.
    const onPath = (n: Node) => [...marked].some((m) => m === n.path || m.startsWith(`${n.path}/`));
    const link = (n: Node) => `https://github.com/${repo}/${n.dir ? "tree" : "blob"}/${ref}/${n.path}`;
    const render = (n: Node, level: number): HTMLLIElement => {
      const label = make("a", { href: link(n), textContent: n.dir ? `${n.name}/` : n.name });
      const li = make("li", { className: n.dir ? "dir" : "file" });
      if (marked.has(n.path)) li.dataset.marked = "";
      if (!n.dir) return li.append(label), li;
      const kids = [...n.children.values()].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
      const details = make("details", { open: level < depth || onPath(n) }, make("summary", {}, label));
      const list = make("ul");
      const shown = kids.slice(0, 200);
      list.append(...shown.map((k) => render(k, level + 1)));
      if (kids.length > shown.length) list.append(make("li", { className: "more", textContent: `… ${kids.length - shown.length} more` }));
      details.append(list);
      li.append(details);
      return li;
    };
    const tree = make("ul", { className: "elemnt-filetree-root" }, render(top, 0));
    const foot = make("div", { className: "elemnt-filetree-foot" }, make("a", { href: link(top), textContent: `${repo}${prefix ? `/${prefix}` : ""} on GitHub` }));
    if (truncated) foot.prepend("Large repo: some files aren't listed. ");
    el.replaceChildren(tree, foot);
    el.dataset.ready = "";
  } catch {
    /* keep the plain link */
  }
}

async function codeSnippet(el: HTMLElement, base: string) {
  try {
    const repo = el.dataset.repo!;
    const { text } = await getJson<{ text: string }>(`${base}/api/github/${repoPath(repo)}/file?ref=${encodeURIComponent(el.dataset.ref!)}&path=${encodeURIComponent(el.dataset.path!)}`);
    const all = text.replace(/\n$/, "").split("\n");
    const [from, to] = (el.dataset.lines ?? `1-${Math.min(all.length, 60)}`).split("-").map(Number) as [number, number | undefined];
    const lines = all.slice(from - 1, to ?? from);
    if (!lines.length) return;
    const code = make("code");
    lines.forEach((line, i) => code.append(make("span", { className: "elemnt-snippet-line" }, make("span", { className: "n", textContent: String(from + i) }), line || " ")));
    const ext = el.dataset.path!.split(".").pop() ?? "";
    code.className = `language-${ext}`;
    el.append(make("pre", {}, code));
    el.dataset.ready = "";
  } catch {
    /* keep the plain link */
  }
}
