---
name: elemnt-docs-style
description: Make an Elemnt page look and read like a designed web page in the user's chosen style. Use before writing or restyling any Elemnt page, and when the user asks to make docs "look good", "more engaging", "on brand", or in a particular style, font or colour.
---

# Write Elemnt docs that pull the reader in

Elemnt pages should feel like a polished web page: a hero that says why the page matters, visuals that explain, numbers that stick, and a clear path into the detail. Agents get a plain Markdown version of the same page automatically, so the rich layer costs them nothing.

## 1. Pull the style guide

Call `get_style_guide` first. It returns, live from this workspace:

- the **organization theme**, if there is one, and whether it's **locked**
- the user's **saved style**, if they saved one
- the **presets** (clean, aurora, editorial, terminal, blueprint, sunset, paper) with what each is for
- the `style:` frontmatter options, the layout components and the organization's own components

## 2. Decide the style with the user

- **Locked organization theme:** follow it. Don't ask about colours or fonts. You can still choose `width` and `background`.
- **Organization theme, not locked:** use it unless the user wants this page to look different. Mention that in one line.
- **Saved style:** use it unless the user asks for something else.
- **Otherwise ask, in one short message, before writing:**
  - who reads the page and what they should be able to do afterwards
  - the feel: offer the presets by name with a few words each, or "something custom"
  - fonts, if they care (a heading and a body font from Google Fonts)
  - a brand or accent colour, if they have one

  If they say "you choose", pick the preset that fits the subject and say which you used. Once they've picked, offer to remember it with `save_my_style`.

## 3. Write the page

Put the style in the frontmatter:

```yaml
---
title: Payments, explained
summary: How money moves, what can fail, and the one setting you must not touch.
style:
  preset: aurora
  headingFont: Space Grotesk
  accent: "#7c3aed"
---
```

Then build the page like a landing page with a manual inside:

1. `:::hero[Title]{eyebrow=… art=orbit|waves|grid}` with a one- or two-sentence promise and a row of links that become buttons. It replaces the `# title`.
2. `:::stats` with the three numbers a reader should remember.
3. For each major section, a visual near the top: `:::graphic` (inline SVG using `var(--accent)`, animated with `<animate>` if motion explains something), `:::diagram` (Mermaid) or `:::chart`.
4. `::::cards` for choices and next steps, `::::timeline` for anything that happens in order, `:::band{tone=glow}` to mark the turn from story to reference.
5. Interactive pieces where they teach: `:::explore` with `:var` sliders, `:::quiz`, ```` ```js run ````, `:::widget` (with only HTML and CSS it can hold any custom layout and loads without a click).

Keep it understandable:

- Headings are promises ("Retries never double-charge"), not labels ("Retries").
- No paragraph over about 120 words. Alternate text, visual, list, callout.
- Every flourish carries information. Cut any graphic that doesn't explain something.
- Give every graphic a real `alt` and every widget a real `summary`: that is what agents and screen readers get.
- Facts come from the code and the conversation only. Write `TODO:` where you don't know.

## 4. Check and save

`validate` the full source and fix every error (warnings about removed SVG parts mean something won't show). Save with `create_draft` or `suggest_edit`, give the user the review link, and tell them which style you used and that they can change it from the **Style** menu in the editor or in **Settings → My style**.
