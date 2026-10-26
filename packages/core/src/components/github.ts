import { h } from "hastscript";
import { z } from "zod";
import type { ElemntComponent } from "../types.js";

/**
 * Live pieces of a GitHub repo for explainer pages. The server renders a
 * plain link (so the page works without JavaScript and agents get a real
 * URL); the reader runtime fills in the card, tree or code from the Elemnt
 * server, which reads GitHub on the page's behalf.
 */

const repoName = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "repo must be owner/name");
const ref = z.string().regex(/^[A-Za-z0-9_./-]{1,200}$/, "ref must be a branch, tag or commit SHA");
const repoPath = z
  .string()
  .max(500)
  .regex(/^[^\s]+$/, "path can't contain spaces")
  .refine((p) => !p.split("/").includes(".."), "path can't contain ..");

const gh = (repo: string, kind: "blob" | "tree", at: string, path?: string) => `https://github.com/${repo}/${kind}/${at}${path ? `/${path}` : ""}`;

const repoProps = z.object({ repo: repoName });

export const repo: ElemntComponent<z.infer<typeof repoProps>> = {
  name: "repo",
  kinds: ["leafDirective"],
  props: repoProps,
  render(_node, { repo }) {
    return h("div", { className: ["elemnt-repo"], dataRepo: repo }, [h("a", { href: `https://github.com/${repo}` }, `${repo} on GitHub`)]);
  },
  toMarkdown(_node, { repo }) {
    return [{ type: "paragraph", children: [{ type: "link", url: `https://github.com/${repo}`, children: [{ type: "text", value: `${repo} on GitHub` }] }] }];
  },
  authoring: {
    doc: "A live card for a GitHub repo: description, stars, language, license and latest release. Use once near the top of an explainer.",
    snippet: '::repo{repo="acme/router"}',
  },
};

const treeProps = z.object({
  repo: repoName,
  ref: ref.optional(),
  path: repoPath.optional(),
  depth: z.coerce.number().int().min(1).max(6).optional(),
  highlight: z.string().max(2000).optional(),
});

export const filetree: ElemntComponent<z.infer<typeof treeProps>> = {
  name: "filetree",
  kinds: ["leafDirective"],
  props: treeProps,
  render(_node, p) {
    const at = p.ref ?? "HEAD";
    return h(
      "div",
      {
        className: ["elemnt-filetree"],
        dataRepo: p.repo,
        dataRef: at,
        ...(p.path ? { dataPath: p.path } : {}),
        dataDepth: String(p.depth ?? 2),
        ...(p.highlight ? { dataHighlight: p.highlight } : {}),
      },
      [h("a", { href: gh(p.repo, "tree", at, p.path) }, `Browse ${p.path ? `${p.path} in ` : ""}${p.repo}`)],
    );
  },
  toMarkdown(_node, p) {
    const marked = (p.highlight ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const at = p.ref ?? "HEAD";
    return [
      { type: "paragraph", children: [{ type: "link", url: gh(p.repo, "tree", at, p.path), children: [{ type: "text", value: `Files in ${p.repo}${p.path ? `/${p.path}` : ""}` }] }] },
      ...(marked.length
        ? [{ type: "list" as const, ordered: false, spread: false, children: marked.map((m) => ({ type: "listItem" as const, spread: false, children: [{ type: "paragraph" as const, children: [{ type: "inlineCode" as const, value: m }] }] })) }]
        : []),
    ];
  },
  authoring: {
    doc: "A live, collapsible file tree of a repo at a ref (pin a commit SHA). depth is how many folder levels start open (default 2); highlight is a comma-separated list of paths to mark as important.",
    snippet: '::filetree{repo="acme/router" ref="3f2a9c1" path="src" highlight="src/router.go,src/middleware"}',
  },
};

const snippetProps = z.object({
  repo: repoName,
  path: repoPath,
  ref: ref,
  lines: z
    .string()
    .regex(/^\d+(-\d+)?$/, 'lines must look like "12" or "12-40"')
    .refine((l) => {
      const [a, b] = l.split("-").map(Number);
      return a! >= 1 && (b === undefined || (b >= a! && b - a! <= 200));
    }, "lines must start at 1 or later and cover at most 200 lines")
    .optional(),
});

export const snippet: ElemntComponent<z.infer<typeof snippetProps>> = {
  name: "snippet",
  kinds: ["leafDirective"],
  props: snippetProps,
  render(node, p, ctx) {
    const range = p.lines ? `#L${p.lines.replace("-", "-L")}` : "";
    const caption = ctx.labelText(node) ?? `${p.path}${p.lines ? `:${p.lines}` : ""}`;
    return h("figure", { className: ["elemnt-snippet"], dataRepo: p.repo, dataRef: p.ref, dataPath: p.path, ...(p.lines ? { dataLines: p.lines } : {}) }, [
      h("figcaption", [h("a", { href: `${gh(p.repo, "blob", p.ref, p.path)}${range}` }, caption)]),
    ]);
  },
  toMarkdown(node, p, ctx) {
    const range = p.lines ? `#L${p.lines.replace("-", "-L")}` : "";
    const caption = ctx.labelText(node) ?? `${p.path}${p.lines ? ` lines ${p.lines}` : ""}`;
    return [{ type: "paragraph", children: [{ type: "text", value: "Code: " }, { type: "link", url: `${gh(p.repo, "blob", p.ref, p.path)}${range}`, children: [{ type: "text", value: caption }] }] }];
  },
  authoring: {
    doc: "Shows lines of a file from a GitHub repo at a pinned commit, with line numbers and a link to GitHub. ref must be a commit SHA so the lines never shift; the optional [label] replaces the caption. Elemnt watches the file and suggests an update when it changes.",
    snippet: '::snippet[The route matcher]{repo="acme/router" ref="3f2a9c1" path="src/router.go" lines="40-72"}',
  },
};
