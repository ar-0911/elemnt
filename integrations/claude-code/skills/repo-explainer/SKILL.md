---
name: repo-explainer
description: Write the Elemnt explainer page for this repository and link it from the README. Use when the user says "generate an explainer for this repo", "make a docs page for this project", or wants a rich page to link from the README.
---

# Repo explainer in Elemnt

An explainer is one rich page that tells a newcomer what this repository is, why it exists and how it works, so the README can stay short and link to it. It lives in Elemnt, never in the repo. Elemnt watches the files it cites and suggests edits when they change.

## Steps

1. **Check for an existing explainer.** Call `search` with the repo's GitHub URL (from `git remote get-url origin`). If a page comes back, update it with `suggest_edit` instead of creating another.
2. **Pin what you read.** Run `git rev-parse HEAD`. Use this SHA in every github.com link you write, as `https://github.com/OWNER/REPO/blob/SHA/path#L10-L30`. Those links tell Elemnt which files the page depends on.
3. **Read the repo.** README, package manifests, entry points, config, the main modules, tests and scripts. Every fact on the page must come from these files.
4. **Pick the style, then learn the syntax.** Follow the `elemnt-docs-style` skill (`get_style_guide`; follow the organization theme, or ask the user for a style and fonts). Explainers are the front door to a project, so lean into it: a hero, the architecture as a `:::graphic` or diagram, big numbers. Then call `get_authoring_guide` once.
5. **Write the page** with frontmatter `title` (the project's name and what it is) and a one-line `summary`. Use this outline, skipping any section the repo doesn't support:
   - **A `:::hero`** with what it is and the problem it solves, in two or three sentences, for someone who has never seen it, and buttons to the quickstart and the repo.
   - **The 30-second architecture**: a `:::diagram` (Mermaid flowchart) of the main parts and how data flows, with a sentence per box.
   - **Quickstart** as `:::steps`, with exact commands. Use `:::tabs` or `:::codegroup` for alternatives (npm / pnpm, Docker / local).
   - **A tour of the code**: for the four to eight files that matter, a heading, why it exists and a linked path. Use `:::annotate` for one short key excerpt.
   - **Try it**: an `:::explore` with `:var`/`:calc` when the project has a formula or tunable worth playing with, a ```` ```js run ```` block for a pure function, or a `:::widget` for a small visual demo. Only when it genuinely helps.
   - **Where to go next**: contributing, deeper docs, issues.
6. **Validate** with `validate` and fix every error.
7. **Save** with `create_draft` (for example path `explainer` or the repo's name).
8. **Link the repo** with `link_repo`: the page, the repo URL, the SHA from step 2 and `cited_paths` for the folders the tour covers.
9. **Offer the README change.** `link_repo` returns a badge and a short URL. Show the user the one or two lines to add near the top of README.md and ask before editing it. That link is the only docs content that goes into the repo.
10. **Report** the review link and remind the user the page goes live only after they publish it.
