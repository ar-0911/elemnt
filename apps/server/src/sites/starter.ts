/**
 * The design every new site starts from: a multi-page site (Home, Docs,
 * Showcase, Changelog) with a top nav, a docs layout with sidebar and table of
 * contents, and a Three.js hero. It's meant to be restyled, by hand in the
 * studio or by Claude over MCP; nothing in it is special to Elemnt beyond the
 * template variables documented in the site design guide.
 */

const SITE_CSS = `/* Tokens: Elemnt's components read these too, so docs pages match the site. */
:root{
  --bg:#07070c;--surface:#10101a;--soft:#171726;--fg:#ecebf5;--muted:#9b9ab3;--line:#26263a;
  --accent:#8b5cf6;--accent-2:#22d3ee;--glow:color-mix(in srgb,var(--accent) 40%,transparent);
  --font-body:"Inter",system-ui,-apple-system,"Segoe UI",sans-serif;
  --font-display:"Space Grotesk","Inter",system-ui,sans-serif;
  --font-mono:"JetBrains Mono",ui-monospace,monospace;
  --radius:14px;--max:1180px;
}
:root[data-theme=light]{--bg:#fbfaff;--surface:#ffffff;--soft:#f1effb;--fg:#15131f;--muted:#5d5a73;--line:#e3e0f0}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--bg);color:var(--fg);font:16px/1.65 var(--font-body);-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{color:var(--accent)}
img{max-width:100%}
.wrap{max-width:var(--max);margin:0 auto;padding:0 clamp(16px,4vw,32px)}

/* Header */
.site-header{position:sticky;top:0;z-index:20;backdrop-filter:saturate(1.4) blur(14px);-webkit-backdrop-filter:saturate(1.4) blur(14px);background:color-mix(in srgb,var(--bg) 70%,transparent);border-bottom:1px solid color-mix(in srgb,var(--line) 70%,transparent)}
.site-header .wrap{display:flex;align-items:center;gap:20px;height:64px}
.brand{display:flex;align-items:center;gap:10px;font:700 18px var(--font-display);color:var(--fg);text-decoration:none;letter-spacing:-.01em}
.brand-mark{width:26px;height:26px;border-radius:8px;background:conic-gradient(from 200deg,var(--accent),var(--accent-2),var(--accent));box-shadow:0 0 24px var(--glow)}
.site-nav{display:flex;gap:4px;margin-left:12px}
.site-nav a{color:var(--muted);text-decoration:none;font-weight:500;font-size:15px;padding:8px 12px;border-radius:999px;transition:color .2s,background .2s}
.site-nav a:hover{color:var(--fg)}
.site-nav a[aria-current]{color:var(--fg);background:var(--soft)}
.header-actions{margin-left:auto;display:flex;align-items:center;gap:10px}
.icon-btn{display:inline-grid;place-items:center;width:36px;height:36px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--fg);cursor:pointer;text-decoration:none;font-size:15px}
.menu-btn{display:none}
@media(max-width:820px){
  .site-nav{display:none;position:absolute;top:64px;left:0;right:0;flex-direction:column;padding:12px;background:var(--bg);border-bottom:1px solid var(--line)}
  .site-nav.open{display:flex}
  .menu-btn{display:inline-grid}
  elemnt-search .es-open span{display:none}
}

/* Buttons */
.btn{display:inline-flex;align-items:center;gap:8px;font:600 15px var(--font-body);padding:12px 20px;border-radius:999px;text-decoration:none;border:1px solid var(--line);color:var(--fg);background:color-mix(in srgb,var(--surface) 70%,transparent);transition:transform .2s,box-shadow .2s,border-color .2s}
.btn:hover{transform:translateY(-2px);border-color:var(--accent)}
.btn.primary{border:0;color:#fff;background:linear-gradient(120deg,var(--accent),var(--accent-2));box-shadow:0 10px 40px -10px var(--glow)}

/* Hero with a 3D scene behind it */
.hero{position:relative;min-height:min(88vh,860px);display:grid;align-items:center;overflow:hidden;isolation:isolate}
.hero canvas.scene{position:absolute;inset:0;width:100%;height:100%;z-index:-1}
.hero::after{content:"";position:absolute;inset:0;z-index:-1;background:radial-gradient(60% 60% at 30% 50%,transparent 0,var(--bg) 85%);pointer-events:none}
.hero-copy{max-width:640px;padding:80px 0}
.eyebrow{display:inline-block;font:600 12px/1 var(--font-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--accent-2);padding:7px 12px;border:1px solid color-mix(in srgb,var(--accent-2) 40%,transparent);border-radius:999px;background:color-mix(in srgb,var(--accent-2) 8%,transparent)}
.hero h1{font:700 clamp(2.8rem,7vw,5.4rem)/1 var(--font-display);letter-spacing:-.035em;margin:22px 0 18px;background:linear-gradient(100deg,var(--fg) 30%,var(--accent) 65%,var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p.lede{font-size:clamp(1.05rem,2vw,1.3rem);color:var(--muted);max-width:540px}
.hero .actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:30px}
.scroll-hint{position:absolute;bottom:28px;left:50%;transform:translateX(-50%);font:500 12px var(--font-mono);color:var(--muted);letter-spacing:.2em;text-transform:uppercase}

/* Sections */
.band{padding:clamp(64px,10vw,120px) 0;position:relative}
.band h2{font:700 clamp(2rem,4.5vw,3.2rem)/1.05 var(--font-display);letter-spacing:-.03em;margin:0 0 14px}
.band .sub{color:var(--muted);font-size:1.1rem;max-width:620px;margin:0 0 40px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px}
.card{position:relative;padding:26px;border:1px solid var(--line);border-radius:var(--radius);background:linear-gradient(160deg,color-mix(in srgb,var(--surface) 92%,transparent),color-mix(in srgb,var(--soft) 80%,transparent));overflow:hidden}
.card::before{content:"";position:absolute;inset:-1px;border-radius:inherit;padding:1px;background:linear-gradient(140deg,color-mix(in srgb,var(--accent) 60%,transparent),transparent 40%,color-mix(in srgb,var(--accent-2) 50%,transparent));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;opacity:.5;pointer-events:none}
.card h3{font:600 1.2rem var(--font-display);margin:14px 0 6px}
.card p{color:var(--muted);margin:0}
.card .icon{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:20px;background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent)}
.stats{display:flex;flex-wrap:wrap;gap:40px;margin-top:20px}
.stat strong{display:block;font:700 clamp(2rem,5vw,3rem) var(--font-display);background:linear-gradient(120deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent}
.stat span{color:var(--muted)}
.cta{text-align:center;border:1px solid var(--line);border-radius:28px;padding:clamp(40px,7vw,80px) 24px;background:radial-gradient(80% 120% at 50% 0%,color-mix(in srgb,var(--accent) 18%,transparent),transparent 70%),var(--surface)}

/* Docs */
.docs{display:grid;grid-template-columns:250px minmax(0,1fr) 210px;gap:40px;padding-top:32px}
.docs-side{position:sticky;top:84px;align-self:start;max-height:calc(100vh - 100px);overflow:auto;padding-bottom:40px}
.docs-side h4{font:600 12px var(--font-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}
.docs-side a{display:block;padding:6px 10px;border-radius:8px;color:var(--muted);text-decoration:none;font-size:15px}
.docs-side a:hover{color:var(--fg)}
.docs-side a[aria-current=page]{color:var(--fg);background:var(--soft);box-shadow:inset 2px 0 0 var(--accent)}
.docs-side .sub{padding-left:14px}
.docs-main{min-width:0;padding-bottom:100px}
.docs-main .elemnt-page{--page-width:none}
.docs-main h1{font:700 clamp(2rem,4vw,2.8rem)/1.1 var(--font-display);letter-spacing:-.02em}
.doc-summary{font-size:1.15rem;color:var(--muted);margin-top:-6px}
.toc{position:sticky;top:84px;align-self:start;font-size:14px}
.toc h4{font:600 12px var(--font-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}
.toc a{display:block;color:var(--muted);text-decoration:none;padding:4px 0 4px 12px;border-left:1px solid var(--line)}
.toc a.d3{padding-left:24px}
.toc a[aria-current]{color:var(--accent);border-color:var(--accent)}
.pager{display:flex;justify-content:space-between;gap:16px;margin-top:56px}
.pager a{flex:1;padding:16px 18px;border:1px solid var(--line);border-radius:12px;text-decoration:none;color:var(--fg)}
.pager a small{display:block;color:var(--muted)}
.pager a.next{text-align:right}
@media(max-width:1100px){.docs{grid-template-columns:220px minmax(0,1fr)}.toc{display:none}}
@media(max-width:760px){.docs{grid-template-columns:1fr}.docs-side{position:static;max-height:none;border-bottom:1px solid var(--line);padding-bottom:16px}}

/* Markdown pages outside the docs */
.page-main > .elemnt-page{max-width:820px;margin:0 auto;padding:64px clamp(16px,4vw,32px) 96px}

/* Footer */
.site-footer{border-top:1px solid var(--line);padding:40px 0;color:var(--muted);font-size:14px}
.site-footer .wrap{display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px}
.site-footer a{color:var(--muted)}
`;

const SCENE_JS = `import * as THREE from "three";

/**
 * The hero scene: a glowing torus knot inside a field of particles. It
 * follows the pointer, drifts as you scroll, and pauses when off screen.
 * Swap this for something about your project.
 */
const canvas = document.querySelector("canvas.scene");
if (canvas) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const css = getComputedStyle(document.documentElement);
  const accent = new THREE.Color(css.getPropertyValue("--accent").trim() || "#8b5cf6");
  const accent2 = new THREE.Color(css.getPropertyValue("--accent-2").trim() || "#22d3ee");

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 9);

  const knot = new THREE.Mesh(
    new THREE.TorusKnotGeometry(1.6, 0.42, 220, 32),
    new THREE.MeshStandardMaterial({ color: accent, metalness: 0.6, roughness: 0.25, emissive: accent2, emissiveIntensity: 0.15 }),
  );
  knot.position.x = 2.6;
  scene.add(knot);
  const wire = new THREE.Mesh(knot.geometry, new THREE.MeshBasicMaterial({ color: accent2, wireframe: true, transparent: true, opacity: 0.08 }));
  wire.scale.setScalar(1.18);
  knot.add(wire);

  const count = 1600;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 6 + Math.random() * 10, t = Math.random() * Math.PI * 2, p = Math.acos(2 * Math.random() - 1);
    pos.set([r * Math.sin(p) * Math.cos(t), r * Math.sin(p) * Math.sin(t), r * Math.cos(p) - 4], i * 3);
  }
  const dots = new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pos, 3)), new THREE.PointsMaterial({ color: accent2, size: 0.035, transparent: true, opacity: 0.8 }));
  scene.add(dots);

  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const l1 = new THREE.PointLight(accent, 60); l1.position.set(5, 4, 6); scene.add(l1);
  const l2 = new THREE.PointLight(accent2, 40); l2.position.set(-6, -3, 4); scene.add(l2);

  const pointer = { x: 0, y: 0 };
  addEventListener("pointermove", (e) => { pointer.x = e.clientX / innerWidth - 0.5; pointer.y = e.clientY / innerHeight - 0.5; }, { passive: true });

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    knot.position.x = w < 760 ? 0 : 2.6;
    knot.position.y = w < 760 ? -1.6 : 0;
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(canvas);
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    if (!visible) return;
    const t = clock.getElapsedTime();
    const s = scrollY / innerHeight;
    if (!reduced) {
      knot.rotation.x = t * 0.15 + pointer.y * 0.6;
      knot.rotation.y = t * 0.22 + pointer.x * 0.8;
      dots.rotation.y = t * 0.02 + pointer.x * 0.1;
    }
    camera.position.z = 9 + s * 3;
    camera.position.y = -s * 1.5;
    renderer.render(scene, camera);
  });
}
`;

const BASE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&family=Space+Grotesk:wght@500;600;700&display=swap">
<link rel="stylesheet" href="/styles/site.css">
</head>
<body class="{{ page.kind }}">
{% render 'header', site: site %}
{{ content }}
{% render 'footer', site: site, elemnt: elemnt %}
<script>document.querySelector(".menu-btn")?.addEventListener("click",()=>document.querySelector(".site-nav").classList.toggle("open"))</script>
</body>
</html>
`;

const HEADER = `<header class="site-header">
  <div class="wrap">
    <a class="brand" href="/"><span class="brand-mark"></span>{{ site.name }}</a>
    <nav class="site-nav" aria-label="Main">
      {% for item in site.nav %}<a href="{{ item.href }}">{{ item.label }}</a>{% endfor %}
    </nav>
    <div class="header-actions">
      <elemnt-search></elemnt-search>
      {% if site.repo_url %}<a class="icon-btn" href="{{ site.repo_url }}" aria-label="GitHub" title="GitHub"><svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg></a>{% endif %}
      <button class="icon-btn" data-elemnt-theme-toggle aria-label="Toggle dark mode">◐</button>
      <button class="icon-btn menu-btn" aria-label="Menu">☰</button>
    </div>
  </div>
</header>
`;

const FOOTER = `<footer class="site-footer">
  <div class="wrap">
    <span>© {{ elemnt.year }} {{ site.name }}</span>
    <span>{% if site.repo_url %}<a href="{{ site.repo_url }}">GitHub</a> · {% endif %}<a href="/llms.txt">llms.txt</a> · Built with Elemnt</span>
  </div>
</footer>
`;

const PAGE_LAYOUT = `---
layout: base
---
<main class="page-main">{{ content }}</main>
`;

const DOCS_LAYOUT = `---
layout: base
---
<div class="wrap docs">
  <aside class="docs-side" data-elemnt-nav>
    <h4>Docs</h4>
    {% for n in docs.tree %}
      <a href="{{ n.url }}">{{ n.title }}</a>
      {% for c in n.children %}<a class="sub" href="{{ c.url }}">{{ c.title }}</a>{% endfor %}
    {% endfor %}
  </aside>
  <main class="docs-main">
    {% if page.kind == "doc" %}<h1>{{ page.title }}</h1>{% if page.summary %}<p class="doc-summary">{{ page.summary }}</p>{% endif %}{% endif %}
    {{ content }}
    {% if page.prev or page.next %}
    <nav class="pager">
      {% if page.prev %}<a class="prev" href="{{ page.prev.url }}"><small>Previous</small>{{ page.prev.title }}</a>{% endif %}
      {% if page.next %}<a class="next" href="{{ page.next.url }}"><small>Next</small>{{ page.next.title }}</a>{% endif %}
    </nav>
    {% endif %}
  </main>
  {% if page.toc.size > 1 %}
  <nav class="toc" data-elemnt-toc aria-label="On this page">
    <h4>On this page</h4>
    {% for h in page.toc %}<a class="d{{ h.depth }}" href="#{{ h.id }}">{{ h.text }}</a>{% endfor %}
  </nav>
  {% endif %}
</div>
`;

const HERO = `<section class="hero">
  <canvas class="scene" aria-hidden="true"></canvas>
  <div class="wrap">
    <div class="hero-copy">
      {% if props.eyebrow %}<span class="eyebrow">{{ props.eyebrow }}</span>{% endif %}
      {{ content }}
      <div class="actions">
        <a class="btn primary" href="{{ props.primary_href | default: '/docs' }}">{{ props.primary | default: 'Read the docs' }} →</a>
        {% if site.repo_url %}<a class="btn" href="{{ site.repo_url }}">View on GitHub</a>{% endif %}
      </div>
    </div>
  </div>
  <span class="scroll-hint">Scroll</span>
</section>
<script type="module" src="/scripts/scene.js"></script>
`;

function home(name: string, tagline: string) {
  return `---
title: ${JSON.stringify(name)}
summary: ${JSON.stringify(tagline)}
---
{% capture intro %}<h1>${escape(name)}</h1><p class="lede">${escape(tagline)}</p>{% endcapture %}
{% render 'hero', props: site.data.hero, content: intro, site: site %}

<section class="band">
  <div class="wrap">
    <span class="eyebrow" data-reveal>Why it exists</span>
    <h2 data-reveal>Everything you need, nothing you don't</h2>
    <p class="sub" data-reveal>Replace these cards with what makes ${escape(name)} worth a look. Each one tilts toward the pointer.</p>
    <div class="grid">
      {% for f in site.data.features %}
      <article class="card" data-reveal data-reveal-delay="{{ forloop.index0 | times: 90 }}" data-tilt="8">
        <div class="icon">{{ f.icon }}</div>
        <h3>{{ f.title }}</h3>
        <p>{{ f.text }}</p>
      </article>
      {% endfor %}
    </div>
  </div>
</section>

{% if docs.count > 0 %}
<section class="band">
  <div class="wrap">
    <h2 data-reveal>Start reading</h2>
    <p class="sub" data-reveal>Guides and reference, written in Markdown and kept current.</p>
    <div class="grid">
      {% for d in docs.list limit: 6 %}
      <a class="card" href="{{ d.url }}" data-reveal style="text-decoration:none;color:inherit"><h3>{{ d.title }}</h3><p>{{ d.summary }}</p></a>
      {% endfor %}
    </div>
  </div>
</section>
{% endif %}

<section class="band">
  <div class="wrap">
    <div class="cta" data-reveal="scale">
      <h2>Ready to dig in?</h2>
      <p class="sub" style="margin:0 auto 28px">Read the docs, or see it in action in the showcase.</p>
      <a class="btn primary" href="/docs">Read the docs →</a> <a class="btn" href="/showcase">See the showcase</a>
    </div>
  </div>
</section>
`;
}

const SHOWCASE = `---
title: Showcase
summary: What people build with it.
---
<section class="band">
  <div class="wrap">
    <span class="eyebrow" data-reveal>Showcase</span>
    <h2 data-reveal>See it in action</h2>
    <p class="sub" data-reveal>Live demos, screenshots and stories. Ask Claude to replace these with real ones.</p>
    <div class="grid">
      {% for item in site.data.showcase %}
      <article class="card" data-reveal data-tilt="10">
        <div class="icon">{{ item.icon }}</div>
        <h3>{{ item.title }}</h3>
        <p>{{ item.text }}</p>
      </article>
      {% endfor %}
    </div>
  </div>
</section>
`;

const CHANGELOG = `---
title: Changelog
summary: What changed, release by release.
---

# Changelog

::::timeline
:::event[First release]{date="Today"}
The project website went live, built with Elemnt.
:::
::::
`;

function escape(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export function starterFiles(input: { name: string; tagline: string; repo: string | null }): Record<string, string> {
  const config = {
    name: input.name,
    tagline: input.tagline,
    description: input.tagline,
    nav: [
      { label: "Docs", href: "/docs" },
      { label: "Showcase", href: "/showcase" },
      { label: "Changelog", href: "/changelog" },
    ],
    docs: { prefix: "/docs", layout: "docs", title: "Documentation" },
    layout: "page",
    theme: "dark",
    data: {
      hero: { eyebrow: input.repo ? `Open source · ${input.repo}` : "Project website", primary: "Read the docs", primary_href: "/docs" },
      features: [
        { icon: "⚡", title: "Fast to start", text: "Install, run one command, and see it work in under a minute." },
        { icon: "🧩", title: "Composable", text: "Small pieces that fit together the way your project already works." },
        { icon: "🔭", title: "Explained", text: "Docs with live demos, diagrams and runnable examples, not walls of text." },
      ],
      showcase: [
        { icon: "🎛️", title: "Interactive demo", text: "Embed a live widget so readers can try it without installing anything." },
        { icon: "🗺️", title: "Architecture tour", text: "A 3D or diagram walkthrough of how the parts connect." },
        { icon: "📈", title: "Real numbers", text: "Benchmarks or stats that count up as you scroll." },
      ],
    },
  };
  return {
    "site.json": JSON.stringify(config, null, 2) + "\n",
    "layouts/base.liquid": BASE,
    "layouts/page.liquid": PAGE_LAYOUT,
    "layouts/docs.liquid": DOCS_LAYOUT,
    "partials/header.liquid": HEADER,
    "partials/footer.liquid": FOOTER,
    "partials/hero.liquid": HERO,
    "pages/index.html": home(input.name, input.tagline),
    "pages/showcase.html": SHOWCASE,
    "pages/changelog.md": CHANGELOG,
    "styles/site.css": SITE_CSS,
    "scripts/scene.js": SCENE_JS,
  };
}
