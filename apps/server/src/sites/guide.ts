/**
 * What Claude (or a person) needs to design a project website. Served by MCP
 * `get_site_design_guide` and shown in the studio's help panel.
 */
export const SITE_DESIGN_GUIDE = `# Designing an Elemnt project website

A site is a real multi-page website for one project: its own layout, nav, home page, styling, scripts and 3D, around the project's docs. The docs stay Markdown pages in the site's linked space (people edit them in Elemnt as usual); the site's files hold the design. You have full HTML, CSS and JavaScript: make it look like a polished product site or a personal portfolio for the project, not a wiki.

## Files

| Path | What it is |
|---|---|
| \`site.json\` | name, tagline, description, nav, docs settings, default theme, \`data\` for templates |
| \`layouts/<name>.liquid\` | Page frames. Frontmatter \`layout: base\` nests one layout in another. Output the page with \`{{ content }}\`. |
| \`partials/<name>.liquid\` | Reusable pieces: \`{% render 'header', site: site %}\`. Also the target of \`:::section{use="<name>"}\` in Markdown. |
| \`pages/**.html\` / \`.liquid\` | Designed pages in Liquid + HTML. \`pages/index.html\` is \`/\`, \`pages/showcase.html\` is \`/showcase\`, \`pages/404.html\` is the not-found page. |
| \`pages/**.md\` | Designed pages in Elemnt Markdown (all components work), wrapped in the default layout. |
| \`styles/*\`, \`scripts/*\`, \`assets/*\` | Served as is at the same path (\`/scripts/scene.js\`). Binary assets (png, glb, woff2…) are base64. |
| \`data/*.json\` | Extra data, available as \`site.data.<name>\`. |

Every published page of the linked space becomes \`<docs.prefix>/<path>\` (default \`/docs/...\`), rendered inside \`layouts/<docs.layout>.liquid\` (default \`docs\`). A space page called \`index\` is the docs home; otherwise Elemnt generates a card index. Set \`docs.root\` (e.g. \`"ares"\`) to use only that page and its children from a shared space: the root page becomes the docs home and \`ares/flags\` becomes \`/docs/flags\`. Docs update the moment a page is published; the design changes only when the site is published.

### site.json

\`\`\`json
{
  "name": "Rocket",
  "tagline": "Launch services in one command.",
  "description": "Used for search engines and link previews.",
  "nav": [{ "label": "Docs", "href": "/docs" }, { "label": "Showcase", "href": "/showcase" }],
  "docs": { "prefix": "/docs", "layout": "docs", "title": "Documentation" },
  "layout": "page",
  "theme": "dark",
  "image": "assets/og.png",
  "data": { "features": [{ "title": "Fast", "text": "…" }] }
}
\`\`\`

## Template variables (Liquid)

- \`site\`: everything in site.json plus \`url\`, \`slug\`, \`repo\` ("owner/name"), \`repo_url\`, \`nav\` (each item has \`active\`), \`pages\` (designed routes), \`data\` (site.json data + data/*.json).
- \`page\`: \`title\`, \`summary\`, \`route\`, \`kind\` ("page", "doc" or "docs-index"), \`content\` (rendered HTML), frontmatter keys. Doc pages also have \`toc\` (\`{id, text, depth}\` for h2/h3), \`prev\`, \`next\`, \`markdown_url\`, \`updated_at\`.
- \`docs\`: \`tree\` (nested \`{title, url, summary, active, open, children}\`), \`list\` (flat, reading order), \`count\`, \`prefix\`.
- \`elemnt.sites\`: every published site in the workspace (\`name, url, tagline, repo\`), for a hub/portfolio page. \`elemnt.year\`, \`elemnt.preview\`.
- In a partial used by \`:::section\`: \`props\` (the directive's attributes) and \`content\` (its Markdown, rendered).
- Filters: all standard Liquid filters, plus \`markdown\` (Elemnt Markdown to HTML) and \`json\`.

Liquid output is not escaped; it's your own site. Don't put visitor input into templates.

## Design inside Markdown

Docs writers can drop designed sections into any page:

\`\`\`md
:::section{use="feature-grid" columns="3"}
## Why Rocket
- **Fast**: boots in 40 ms
- **Small**: one binary
:::
\`\`\`

renders \`partials/feature-grid.liquid\` with \`props.columns = "3"\` and \`content\` = the rendered Markdown. Outside the site (the editor, agents), only the content shows, so the words always make sense on their own. Leaf form \`::section{use="scene-orbit"}\` drops in a partial with no content (a 3D canvas, a demo).

## What Elemnt adds to every page

Elemnt injects into \`<head>\`: its component styles (\`/_elemnt/content.css\`), an import map for three.js, and \`/_elemnt/site.js\`. It also adds \`<title>\`, description, canonical and Open Graph tags unless your layout writes its own. Wrap Markdown output in your layout however you like; it arrives as \`<div class="elemnt-page">…</div>\` so callouts, tabs, charts, diagrams, quizzes, runnable code and sandboxed widgets work and pick up your CSS tokens.

Helpers, no code needed:

- \`<elemnt-search></elemnt-search>\`: ⌘K / "/" search over every page and doc.
- \`<button data-elemnt-theme-toggle>\`: light/dark switch (sets \`<html data-theme>\`).
- \`data-reveal\` (\`="left" | "right" | "scale"\`, \`data-reveal-delay="120"\`): animate in on scroll.
- \`data-tilt="10"\`: tilt toward the pointer in 3D.
- \`data-parallax="0.2"\`: scroll at a fraction of the page speed.
- \`data-count-to="1200"\` (\`data-count-suffix="+"\`): count up when visible.
- \`data-elemnt-toc\` on a nav of \`#id\` links: highlights the heading being read.
- Nav links to the current page get \`aria-current\`.

Colour tokens Elemnt's components read (set them in your CSS, also under \`:root[data-theme=light]\`): \`--bg --surface --soft --fg --muted --line --accent --accent-2 --font-body --font-mono --radius\`.

## 3D and motion

\`import * as THREE from "three"\` and \`import { OrbitControls } from "three/addons/controls/OrbitControls.js"\` work in any \`<script type="module">\`, served from the site itself (three r170). Make the 3D *about the project*: a dependency graph you can orbit for a code tool, layers of a pipeline coming apart on scroll, a model of the hardware, data flowing between services. Guidelines:

- Put the canvas behind or beside real content, never instead of it; the page must read fine without WebGL.
- Respect \`prefers-reduced-motion\` (render a still frame), cap \`devicePixelRatio\` at 2, pause when the canvas is off screen (IntersectionObserver), and resize with a ResizeObserver.
- Read colours from CSS tokens (\`getComputedStyle(document.documentElement).getPropertyValue("--accent")\`) so the scene follows the theme.
- Keep scenes light (a few thousand points, a few dozen meshes); load models (\`assets/*.glb\`) with GLTFLoader only when needed.
- Fonts: load from Google Fonts in the layout's \`<head>\`.
- System architecture: draw real infrastructure in 3D (zones as translucent platforms for VPCs, subnets and on-prem; services as recognisable shapes such as racks, gateways, databases and firewalls; links as arcs with packets moving along them; tunnels as glowing tubes), not floating boxes and arrows. In docs pages use \`:::architecture\` (see the authoring guide), which renders a proper 2D architecture diagram.

## Who can open a site

A site is public by default. With visibility \`members\`, visitors sign in with Elemnt and only people who can read the site's docs space get in (owners always can). A private space can only back a members site. Members sites are never cached by shared caches or indexed.

## Working as Claude

1. \`get_site\` (or \`create_site\`), \`read_site_file\` for anything you'll change, and \`list_pages\` / \`get_page\` for the docs.
2. Ask the user about style if their brief doesn't settle it: mood, colours, fonts, how much motion, what the 3D should show.
3. Write whole files with \`propose_site_changes\` (one change set per coherent change, with a one-line summary). It returns a preview URL of the site with your changes and any template errors: open it, fix errors, and propose again if needed.
4. Docs content goes in the space as Markdown pages (\`create_draft\` / \`suggest_edit\`), not into site files, unless it's marketing copy for a designed page.
5. Give the user the review link. People apply change sets and publish. If the site's owner turned on "Let Claude publish" (\`agentPublish\` in \`get_site\`), pass \`publish: true\` to \`propose_site_changes\` (or call \`publish_site\`) to put the change live; it won't publish while there are template errors. Every publish is a release the owner can roll back.
`;
