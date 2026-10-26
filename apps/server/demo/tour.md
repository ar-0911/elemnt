---
title: Elemnt in five minutes
summary: One source, two readers. How a page becomes an interactive explainer for people and clean Markdown for agents.
style:
  preset: aurora
---

:::hero[Docs people read. Docs agents trust.]{eyebrow="Elemnt · five-minute tour" art=orbit}
You write one Markdown page. Elemnt turns it into this: a designed, interactive page for people, and a plain Markdown file for Claude. Same source, same facts, two readers.

[Take the tour](#one-source-two-outputs) [See what Claude reads](?view=markdown)
:::

:::stats
::stat[1]{label="Source file per page"}
::stat[2]{label="Outputs from every save" note="HTML for people, Markdown for agents"}
::stat[0]{label="Pages Claude publishes on its own"}
:::

## One source, two outputs

:::graphic{alt="A Markdown source file on the left splits into two outputs: an interactive web page at the top right and a plain Markdown file at the bottom right. A pulse travels from the source to each output." caption="Every save compiles both, so they never drift apart."}
```svg
<svg viewBox="0 0 640 240" fill="none">
  <defs>
    <linearGradient id="beam" x1="0" x2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/></linearGradient>
  </defs>
  <rect x="24" y="70" width="150" height="100" rx="14" stroke="currentColor" stroke-opacity=".35"/>
  <text x="99" y="112" fill="currentColor" font-size="15" text-anchor="middle" font-weight="600">page.md</text>
  <text x="99" y="136" fill="currentColor" fill-opacity=".6" font-size="12" text-anchor="middle">Markdown + components</text>
  <path d="M174 120 C 260 120 260 60 360 60" stroke="url(#beam)" stroke-width="2.5"/>
  <path d="M174 120 C 260 120 260 180 360 180" stroke="url(#beam)" stroke-width="2.5"/>
  <rect x="360" y="20" width="250" height="80" rx="14" fill="var(--accent)" fill-opacity=".12" stroke="var(--accent)"/>
  <text x="485" y="55" fill="currentColor" font-size="15" text-anchor="middle" font-weight="600">Interactive page</text>
  <text x="485" y="78" fill="currentColor" fill-opacity=".6" font-size="12" text-anchor="middle">charts · sliders · quizzes · widgets</text>
  <rect x="360" y="140" width="250" height="80" rx="14" fill="var(--accent-2)" fill-opacity=".12" stroke="var(--accent-2)"/>
  <text x="485" y="175" fill="currentColor" font-size="15" text-anchor="middle" font-weight="600">Agent Markdown</text>
  <text x="485" y="198" fill="currentColor" fill-opacity=".6" font-size="12" text-anchor="middle">every component as plain text</text>
  <circle r="6" fill="var(--accent)"><animateMotion dur="2.4s" repeatCount="indefinite" path="M174 120 C 260 120 260 60 360 60"/></circle>
  <circle r="6" fill="var(--accent-2)"><animateMotion dur="2.4s" begin="1.2s" repeatCount="indefinite" path="M174 120 C 260 120 260 180 360 180"/></circle>
</svg>
```
:::

Each component knows how to draw itself for people and how to describe itself for agents. A chart becomes a table, a quiz becomes a question with its answer, and this graphic becomes its alt text.

::::cards{cols=3}
:::card[Rich for people]{icon="✨"}
Heroes, cards, charts, sliders, quizzes, runnable code and sandboxed widgets.
:::
:::card[Plain for agents]{icon="🤖"}
Served as `page.md`, through `llms.txt`, and over MCP.
:::
:::card[Reviewed by people]{icon="🛡️"}
Claude writes drafts and suggestions. A person publishes.
:::
::::

## Play with a number

:::explore
Your team writes :var[12]{name=pages min=1 max=60 unit=pages} a month and each one is read :var[40]{name=reads min=5 max=500 step=5 unit=times}. That's :calc{expr="pages*reads" digits=0 unit=reads} reads a month that either answer the question or send someone to Slack.
:::

:::band{tone=glow}
## Your style, your organization's style

Every page can pick a look in its frontmatter: a preset like this one (`aurora`), or your own colours and Google Fonts. Admins can set an organization theme and lock it, and Claude reads it before it writes a single line.
:::

## How a page gets written

::::timeline
:::event[You ask Claude]{date="Step 1"}
"Document the billing service." Claude reads the code and the style guide.
:::
:::event[Claude asks about style]{date="Step 2"}
Which preset, which fonts, or your saved style. A locked organization theme skips the question.
:::
:::event[A draft lands in Elemnt]{date="Step 3"}
You review it in the split editor, hunk by hunk.
:::
:::event[You publish]{date="Step 4" tone=ok}
People get the page; agents get the Markdown.
:::
::::

:::quiz[Who can publish a page Claude wrote?]
- [ ] Claude, once validation passes
- [x] A person who reviews the draft
- [ ] Nobody; agent pages stay drafts forever

Claude's writes are always drafts or suggestions. A person with edit rights publishes them.
:::
