import { resolveStyle, styleCss } from "./style.js";

/**
 * Default look for rendered Elemnt pages: colour tokens (light and dark) and
 * styles for every built-in component. Used by the reader and the editor
 * preview so both look the same. Scoped to `.elemnt-page` where it styles
 * plain elements, so it can sit inside other apps.
 *
 * Dark mode follows the system unless `data-theme="light"` or `"dark"` is set
 * on <html>, which is what the reader's theme toggle does. Page styles
 * (`styleCss`) override the colour tokens after this.
 */
export const themeTokensCss = `
${styleCss(resolveStyle())}
:root{--warn:#9a5b00;--warn-soft:#fbf0dc;--danger:#b0312b;--danger-soft:#fbe6e4;--ok:#1f7a4d;--ok-soft:#e3f3ea}
:root[data-theme=dark]{--warn:#f0b65a;--warn-soft:#2c2213;--danger:#ff8b84;--danger-soft:#331a19;--ok:#6fd3a0;--ok-soft:#13291f}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--warn:#f0b65a;--warn-soft:#2c2213;--danger:#ff8b84;--danger-soft:#331a19;--ok:#6fd3a0;--ok-soft:#13291f}}
`;

/** Page style treatments, background art and the layout components. */
const layoutCss = `
.elemnt-page h1{font-size:clamp(2rem,4.5vw,3rem);margin:.4em 0 .3em}
.elemnt-headings-gradient .elemnt-page :is(h1,h2){background:linear-gradient(100deg,var(--fg) 10%,var(--accent) 55%,var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent}
.elemnt-headings-underline .elemnt-page h2::after{content:"";display:block;width:56px;height:3px;margin-top:10px;border-radius:2px;background:linear-gradient(90deg,var(--accent),var(--accent-2))}
.elemnt-styled{position:relative;isolation:isolate}
.elemnt-styled::before{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none}
body.elemnt-styled::before{position:fixed}
.elemnt-bg-aurora::before{inset:-15%;background:radial-gradient(38% 32% at 18% 8%,color-mix(in srgb,var(--accent) 34%,transparent),transparent 70%),radial-gradient(34% 30% at 86% 18%,color-mix(in srgb,var(--accent-2) 28%,transparent),transparent 70%),radial-gradient(44% 38% at 58% 96%,color-mix(in srgb,var(--accent) 18%,transparent),transparent 70%);filter:blur(24px);animation:elemnt-drift 26s ease-in-out infinite alternate}
.elemnt-bg-grid::before{background-image:linear-gradient(color-mix(in srgb,var(--line) 70%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--line) 70%,transparent) 1px,transparent 1px);background-size:36px 36px;-webkit-mask-image:radial-gradient(ellipse 90% 60% at 50% 0%,#000 30%,transparent 80%);mask-image:radial-gradient(ellipse 90% 60% at 50% 0%,#000 30%,transparent 80%)}
.elemnt-bg-dots::before{background-image:radial-gradient(color-mix(in srgb,var(--muted) 35%,transparent) 1px,transparent 1.5px);background-size:20px 20px}
.elemnt-bg-mesh::before{background:radial-gradient(50% 40% at 0% 0%,color-mix(in srgb,var(--accent) 22%,transparent),transparent 70%),radial-gradient(40% 40% at 100% 10%,color-mix(in srgb,var(--accent-2) 22%,transparent),transparent 70%),radial-gradient(60% 50% at 50% 100%,color-mix(in srgb,var(--accent) 10%,transparent),transparent 70%)}
@keyframes elemnt-drift{from{transform:translate3d(-2%,-1%,0) rotate(0)}to{transform:translate3d(2%,2%,0) rotate(6deg)}}
.elemnt-hero{position:relative;overflow:hidden;margin:8px 0 40px;padding:clamp(28px,6vw,64px) clamp(20px,4vw,48px);border:1px solid var(--line);border-radius:calc(var(--radius,8px)*1.6);background:linear-gradient(135deg,color-mix(in srgb,var(--surface) 85%,transparent),color-mix(in srgb,var(--soft) 70%,transparent));box-shadow:0 30px 80px -40px color-mix(in srgb,var(--accent) 45%,transparent)}
.elemnt-hero[data-align=center]{text-align:center}.elemnt-hero[data-align=center] .elemnt-hero-actions{justify-content:center}
.elemnt-hero-body{position:relative;max-width:640px}.elemnt-hero[data-align=center] .elemnt-hero-body{margin:0 auto}
.elemnt-hero h1{font-size:clamp(2.2rem,5.5vw,3.6rem);line-height:1.04;margin:.15em 0 .35em;background:linear-gradient(100deg,var(--fg) 20%,var(--accent) 60%,var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent}
.elemnt-hero > .elemnt-hero-body > p:not(.elemnt-eyebrow):not(.elemnt-hero-actions){font-size:1.15em;color:var(--muted)}
.elemnt-eyebrow{display:inline-block;margin:0;font:600 12px/1 var(--font-mono,ui-monospace,monospace);letter-spacing:.12em;text-transform:uppercase;color:var(--accent);padding:6px 10px;border:1px solid color-mix(in srgb,var(--accent) 35%,transparent);border-radius:999px;background:color-mix(in srgb,var(--accent) 8%,transparent)}
.elemnt-hero-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
.elemnt-hero-actions a{font:600 15px var(--font-body,system-ui);padding:10px 18px;border-radius:999px;text-decoration:none;border:1px solid var(--line);color:var(--fg);background:var(--surface);transition:transform .15s,box-shadow .15s}
.elemnt-hero-actions a:first-child{border-color:transparent;color:#fff;background:linear-gradient(100deg,var(--accent),var(--accent-2));box-shadow:0 10px 24px -10px var(--accent)}
.elemnt-hero-actions a:hover{transform:translateY(-1px)}
.elemnt-art{position:absolute;right:-60px;top:50%;width:min(420px,60%);height:auto;transform:translateY(-50%);color:var(--accent);opacity:.9;pointer-events:none}
.elemnt-art-waves,.elemnt-art-grid{inset:auto 0 0 0;top:auto;right:0;width:100%;height:38%;transform:none;opacity:.45}
.elemnt-orbit{transform-origin:200px 200px;animation:elemnt-spin 18s linear infinite}.elemnt-orbit-2{animation-duration:30s;animation-direction:reverse}.elemnt-orbit-3{animation-duration:46s}
.elemnt-wave{animation:elemnt-wave 9s ease-in-out infinite alternate}.elemnt-wave-2{animation-duration:12s}.elemnt-wave-3{animation-duration:15s}
@keyframes elemnt-spin{to{transform:rotate(360deg)}}@keyframes elemnt-wave{to{transform:translateX(-200px)}}
@media (max-width:640px){.elemnt-art{opacity:.35}}
.elemnt-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:24px 0}
.elemnt-cards[data-cols="1"]{grid-template-columns:1fr}.elemnt-cards[data-cols="2"]{grid-template-columns:repeat(2,minmax(0,1fr))}.elemnt-cards[data-cols="4"]{grid-template-columns:repeat(4,minmax(0,1fr))}
@media (max-width:720px){.elemnt-cards[data-cols]{grid-template-columns:1fr}}
.elemnt-card{position:relative;padding:18px 20px;border:1px solid var(--line);border-radius:var(--radius,8px);background:var(--surface);transition:transform .2s,border-color .2s,box-shadow .2s}
.elemnt-card:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--accent) 45%,var(--line));box-shadow:0 18px 40px -24px color-mix(in srgb,var(--accent) 60%,transparent)}
.elemnt-card > :last-child{margin-bottom:0}.elemnt-card-title{margin:.2em 0 .4em;font-size:1.1em}
.elemnt-card[data-link] .elemnt-card-title a{color:inherit;text-decoration:none}.elemnt-card[data-link] .elemnt-card-title a::after{content:"";position:absolute;inset:0}
.elemnt-card[data-link] .elemnt-card-title::after{content:" →";color:var(--accent)}
.elemnt-card-icon{display:inline-grid;place-items:center;width:40px;height:40px;font-size:20px;border-radius:calc(var(--radius,8px)*.9);background:var(--soft)}
.elemnt-card[data-tone=ok]{border-top:3px solid var(--ok)}.elemnt-card[data-tone=warn]{border-top:3px solid var(--warn)}.elemnt-card[data-tone=danger]{border-top:3px solid var(--danger)}.elemnt-card[data-tone=accent]{border-top:3px solid var(--accent)}
.elemnt-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin:28px 0}
.elemnt-stat{padding:16px 18px;border-left:3px solid var(--accent);background:linear-gradient(90deg,var(--soft),transparent);border-radius:0 var(--radius,8px) var(--radius,8px) 0}
.elemnt-stat p{margin:0}.elemnt-stat-value{font:700 clamp(1.8rem,4vw,2.6rem)/1.1 var(--font-head,inherit);letter-spacing:-.02em;background:linear-gradient(100deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent;font-variant-numeric:tabular-nums}
.elemnt-stat-label{font-weight:600;margin-top:4px!important}.elemnt-stat-note{font-size:13px;color:var(--muted)}
.elemnt-timeline{list-style:none;padding:0 0 0 28px;margin:24px 0;position:relative}
.elemnt-timeline::before{content:"";position:absolute;left:8px;top:6px;bottom:6px;width:2px;background:linear-gradient(var(--accent),var(--accent-2))}
.elemnt-event{position:relative;margin:0 0 22px}.elemnt-event::before{content:"";position:absolute;left:-26px;top:6px;width:14px;height:14px;border-radius:50%;background:var(--surface);border:3px solid var(--accent)}
.elemnt-event[data-tone=ok]::before{border-color:var(--ok)}.elemnt-event[data-tone=warn]::before{border-color:var(--warn)}.elemnt-event[data-tone=danger]::before{border-color:var(--danger)}
.elemnt-event-date{margin:0;font:600 12px var(--font-mono,ui-monospace,monospace);color:var(--muted);letter-spacing:.06em;text-transform:uppercase}.elemnt-event-title{margin:2px 0 4px;font-weight:700}
.elemnt-band{margin:40px calc((100cqw - 100%) / -2);padding:40px max(16px,calc((100cqw - 100%) / 2))}
@supports not (width:1cqw){.elemnt-band{margin-inline:-16px;padding-inline:16px}}
.elemnt-band-inner > :first-child{margin-top:0}.elemnt-band-inner > :last-child{margin-bottom:0}
.elemnt-band[data-tone=soft]{background:var(--soft)}
.elemnt-band[data-tone=accent]{background:linear-gradient(120deg,var(--accent),var(--accent-2));color:#fff}.elemnt-band[data-tone=accent] :is(a,h1,h2,h3){color:#fff;background:none;-webkit-text-fill-color:#fff}
.elemnt-band[data-tone=contrast]{background:var(--fg);color:var(--bg)}.elemnt-band[data-tone=contrast] :is(h1,h2,h3){color:var(--bg);background:none;-webkit-text-fill-color:var(--bg)}.elemnt-band[data-tone=contrast] a{color:var(--bg)}
.elemnt-band[data-tone=glow]{background:radial-gradient(60% 120% at 50% 0%,color-mix(in srgb,var(--accent) 20%,transparent),transparent 70%);border-block:1px solid var(--line)}
.elemnt-badge{display:inline-block;vertical-align:middle;font:600 .7em/1 var(--font-body,system-ui);letter-spacing:.02em;padding:.35em .65em;border-radius:999px;background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent);-webkit-text-fill-color:currentColor}
.elemnt-badge[data-tone=ok]{background:var(--ok-soft);color:var(--ok)}.elemnt-badge[data-tone=warn]{background:var(--warn-soft);color:var(--warn)}.elemnt-badge[data-tone=danger]{background:var(--danger-soft);color:var(--danger)}.elemnt-badge[data-tone=muted]{background:var(--code);color:var(--muted)}
.elemnt-quote{margin:36px 0;padding:0 0 0 24px;border-left:4px solid;border-image:linear-gradient(var(--accent),var(--accent-2)) 1}
.elemnt-quote blockquote{margin:0;font:500 clamp(1.25rem,2.6vw,1.6rem)/1.4 var(--font-head,inherit);letter-spacing:-.01em}.elemnt-quote blockquote p{margin:.3em 0}
.elemnt-quote figcaption{margin-top:10px;color:var(--muted);font-size:15px}
.elemnt-graphic{margin:28px 0;text-align:center}.elemnt-graphic svg{max-width:100%;height:auto;color:var(--fg)}
.elemnt-graphic[data-width=half] svg{width:50%}.elemnt-graphic[data-width=third] svg{width:33%}.elemnt-graphic[data-width=full] svg{width:100%}
.elemnt-graphic[data-width=wide]{margin-inline:min(0px,calc((100% - min(100cqw,1100px)) / 2))}.elemnt-graphic[data-width=wide] svg{width:100%}
@media (prefers-reduced-motion:reduce){.elemnt-styled::before,.elemnt-orbit,.elemnt-wave{animation:none!important}.elemnt-graphic svg *{animation:none!important}}
`;

export const contentCss = `
.elemnt-page{font-family:var(--font-body,system-ui,sans-serif)}.elemnt-page :is(h1,h2,h3,h4){font-family:var(--font-head,inherit);letter-spacing:-.01em}
.elemnt-page :is(h1,h2,h3){line-height:1.2;text-wrap:balance}a{color:var(--accent)}
.elemnt-page code{font-family:var(--font-mono,ui-monospace,monospace);font-size:.88em;background:var(--code);padding:1px 5px;border-radius:4px}
.elemnt-page pre{background:var(--code);border:1px solid var(--line);border-radius:calc(var(--radius,8px)*.75);padding:12px 14px;overflow-x:auto}pre code{background:none;padding:0}
.elemnt-page table{border-collapse:collapse;display:block;overflow-x:auto}th,td{border:1px solid var(--line);padding:6px 10px}
.lede{font-size:19px;color:var(--muted);margin-top:-8px}
.elemnt-callout{border:1px solid var(--line);border-left:4px solid var(--accent);background:var(--surface);border-radius:calc(var(--radius,8px)*.75);padding:4px 16px;margin:16px 0}
.elemnt-callout[data-type=warn]{border-left-color:var(--warn);background:var(--warn-soft)}
.elemnt-callout[data-type=danger]{border-left-color:var(--danger);background:var(--danger-soft)}
.elemnt-callout[data-type=tip]{border-left-color:var(--ok);background:var(--ok-soft)}
.elemnt-callout-title{font-weight:700;margin-bottom:0}
.elemnt-steps ol,.elemnt-runbook{counter-reset:s;list-style:none;padding-left:0}
.elemnt-steps li,.elemnt-runbook-step{counter-increment:s;position:relative;padding-left:40px;margin:14px 0}
.elemnt-steps li::before,.elemnt-runbook-step::before{content:counter(s);position:absolute;left:0;top:0;width:28px;height:28px;border-radius:50%;background:var(--soft);color:var(--accent);font:700 13px/28px system-ui;text-align:center}
.elemnt-runbook-title{font-weight:700;margin:0 0 6px}.elemnt-runbook-gate{margin-left:8px;font:600 11px system-ui;padding:3px 7px;border-radius:4px;background:var(--warn-soft);color:var(--warn)}
.elemnt-runbook-expect{font-size:14px;color:var(--muted)}
.elemnt-tab-label{font-weight:700}.tablist{display:flex;gap:2px;border-bottom:1px solid var(--line)}
.tablist button{font:600 13px system-ui;border:0;background:none;color:var(--muted);padding:8px 12px;border-bottom:2px solid transparent;cursor:pointer}
.tablist button[aria-selected=true]{color:var(--accent);border-bottom-color:var(--accent)}
.elemnt-repo{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;margin:20px 0;padding:18px 20px;border:1px solid var(--line);border-radius:calc(var(--radius,8px)*1.2);background:linear-gradient(135deg,var(--surface),color-mix(in srgb,var(--accent) 6%,var(--surface)))}
.elemnt-repo-body{flex:1 1 320px;min-width:0}.elemnt-repo-head{display:flex;align-items:center;gap:10px}
.elemnt-repo-mark{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;color:#fff;background:linear-gradient(135deg,var(--accent),var(--accent-2,var(--accent)));font-weight:700}
.elemnt-repo-name{font:700 1.1em var(--font-heading,inherit);color:var(--fg);text-decoration:none}.elemnt-repo-name:hover{color:var(--accent)}
.elemnt-repo-desc{margin:8px 0 10px;color:var(--muted)}
.elemnt-repo-topics{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}.elemnt-repo-topics span{font-size:12px;padding:2px 9px;border-radius:999px;color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,transparent)}
.elemnt-repo-stats{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:13px;color:var(--muted)}.elemnt-repo-stats strong{color:var(--fg)}
.elemnt-repo-release{font:600 12px var(--font-mono,ui-monospace,monospace);padding:2px 8px;border-radius:999px;border:1px solid var(--line);text-decoration:none;color:var(--fg)}
.elemnt-repo-actions{display:flex;gap:8px}.elemnt-repo-actions a{font-weight:600;font-size:14px;padding:8px 14px;border-radius:999px;text-decoration:none;border:1px solid var(--line);color:var(--fg);background:var(--bg,var(--surface))}.elemnt-repo-actions a:first-child{color:#fff;border-color:transparent;background:linear-gradient(135deg,var(--accent),var(--accent-2,var(--accent)))}
.elemnt-filetree{margin:16px 0;padding:12px 16px;border:1px solid var(--line);border-radius:calc(var(--radius,8px)*.75);background:var(--surface);font:13.5px/1.7 var(--font-mono,ui-monospace,monospace)}
.elemnt-filetree ul{list-style:none;margin:0;padding-left:18px}.elemnt-filetree .elemnt-filetree-root{padding-left:0;max-height:520px;overflow:auto}
.elemnt-filetree li{margin:0}.elemnt-filetree summary{cursor:pointer;list-style:none}.elemnt-filetree summary::-webkit-details-marker{display:none}
.elemnt-filetree summary::before{content:"▸";display:inline-block;width:1.1em;color:var(--muted);transition:transform .15s}.elemnt-filetree details[open]>summary::before{transform:rotate(90deg)}
.elemnt-filetree li.file{padding-left:1.1em}.elemnt-filetree a{color:var(--fg);text-decoration:none}.elemnt-filetree a:hover{color:var(--accent);text-decoration:underline}
.elemnt-filetree .dir>details>summary>a{font-weight:600}.elemnt-filetree .more{color:var(--muted);padding-left:1.1em}
.elemnt-filetree li[data-marked]>a,.elemnt-filetree li[data-marked]>details>summary>a{color:var(--accent);font-weight:700}.elemnt-filetree li[data-marked]>a::after,.elemnt-filetree li[data-marked]>details>summary>a::after{content:" ●";font-size:.7em;vertical-align:middle}
.elemnt-filetree-foot{margin-top:8px;padding-top:8px;border-top:1px dashed var(--line);font:12px var(--font-body,system-ui);color:var(--muted)}.elemnt-filetree-foot a{color:var(--muted)}
.elemnt-snippet{margin:16px 0;border:1px solid var(--line);border-radius:calc(var(--radius,8px)*.75);overflow:hidden;background:var(--code)}
.elemnt-snippet figcaption{display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid var(--line);background:var(--surface);font:600 12.5px var(--font-mono,ui-monospace,monospace)}.elemnt-snippet figcaption a{color:var(--fg);text-decoration:none}.elemnt-snippet figcaption a:hover{color:var(--accent)}
.elemnt-snippet:not([data-ready]) figcaption{border-bottom:0}.elemnt-snippet figcaption::after{content:"↗";margin-left:auto;color:var(--muted)}
.elemnt-page .elemnt-snippet pre{margin:0;border:0;border-radius:0;padding:10px 0;font-size:13px;line-height:1.6}
.elemnt-snippet-line{display:block;padding:0 14px 0 0;white-space:pre}.elemnt-snippet-line .n{display:inline-block;width:3.2em;padding-right:1em;text-align:right;color:var(--muted);opacity:.7;user-select:none}
.elemnt-details{border:1px solid var(--line);border-radius:calc(var(--radius,8px)*.75);padding:8px 14px;background:var(--surface)}.elemnt-details summary{font-weight:600;cursor:pointer}
figure.elemnt-diagram{margin:20px 0;text-align:center}figure.elemnt-diagram pre.mermaid{background:var(--surface)}figcaption{font-size:14px;color:var(--muted)}
elemnt-query{font-weight:600;font-variant-numeric:tabular-nums}
figure.elemnt-chart,figure.elemnt-datagrid{margin:20px 0}
elemnt-chart svg{display:block;width:100%;height:auto;overflow:visible}elemnt-chart[data-drawn] table{display:none}
elemnt-chart .axis{stroke:var(--line)}elemnt-chart text{fill:var(--muted);font:12px system-ui}
.elemnt-chart-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:13px;color:var(--muted);margin-top:6px}.elemnt-chart-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px}
.elemnt-datagrid-filter{font:inherit;font-size:14px;padding:5px 9px;border:1px solid var(--line);border-radius:calc(var(--radius,8px)*.75);background:var(--surface);color:var(--fg);margin-bottom:8px;width:min(280px,100%)}
elemnt-datagrid th[data-sort]{cursor:pointer;user-select:none}elemnt-datagrid th[data-sort]::after{content:" ↕";color:var(--muted)}elemnt-datagrid th[data-sort=asc]::after{content:" ↑"}elemnt-datagrid th[data-sort=desc]::after{content:" ↓"}
.elemnt-explore{display:block;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius,8px);padding:2px 16px;margin:16px 0}
elemnt-var,elemnt-calc{font-weight:700;color:var(--accent);font-variant-numeric:tabular-nums}
elemnt-var input[type=range]{vertical-align:middle;width:120px;margin:0 6px;accent-color:var(--accent)}
.elemnt-annotate{display:block;margin:16px 0}.elemnt-annotate .elemnt-line{display:inline-block;width:100%}
.elemnt-annotate .elemnt-line[data-note]{background:var(--soft);cursor:help}.elemnt-annotate .elemnt-line[data-active]{outline:2px solid var(--accent)}
.elemnt-annotate .elemnt-line[data-note]::after{content:attr(data-note);float:right;font:700 11px system-ui;color:var(--accent)}
.elemnt-notes li[data-active]{background:var(--soft);border-radius:4px}
.elemnt-quiz{display:block;border:1px solid var(--line);border-radius:var(--radius,8px);padding:4px 16px 12px;margin:16px 0;background:var(--surface)}
.elemnt-quiz-question{font-weight:700}.elemnt-quiz-options{list-style:upper-alpha;padding-left:24px}
.elemnt-quiz-option p{margin:4px 0}elemnt-quiz[data-ready] .elemnt-quiz-option{cursor:pointer;border-radius:calc(var(--radius,8px)*.75);padding:2px 6px}
elemnt-quiz[data-ready] .elemnt-quiz-option:hover{background:var(--soft)}
.elemnt-quiz-option[data-picked=right]{background:var(--ok-soft)}.elemnt-quiz-option[data-picked=wrong]{background:var(--danger-soft)}
elemnt-quiz[data-ready]:not([data-answered]) .elemnt-quiz-why{display:none}.elemnt-quiz-why{border-top:1px solid var(--line);margin-top:8px;color:var(--muted)}
.elemnt-compare{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0}@media (max-width:640px){.elemnt-compare{grid-template-columns:1fr}}
.elemnt-side{border:1px solid var(--line);border-radius:var(--radius,8px);padding:2px 14px;background:var(--surface);min-width:0}.elemnt-side-label{font-weight:700;color:var(--muted);text-transform:uppercase;font-size:12px;letter-spacing:.05em}
.elemnt-term{font-style:normal;border-bottom:1px dotted var(--accent);cursor:help;position:relative}
.elemnt-term:is(:hover,:focus)::after{content:attr(data-def);position:absolute;left:0;top:calc(100% + 6px);z-index:5;width:max-content;max-width:280px;padding:8px 10px;border-radius:calc(var(--radius,8px)*.75);background:var(--fg);color:var(--bg);font-size:13px;line-height:1.4;font-weight:400}
elemnt-widget{display:block;margin:16px 0}.elemnt-widget-summary{border:1px dashed var(--line);border-radius:var(--radius,8px);padding:4px 14px;color:var(--muted)}
.elemnt-widget-frame{border:1px solid var(--line);border-radius:var(--radius,8px);overflow:hidden;background:var(--surface)}
.elemnt-widget-label{display:flex;justify-content:space-between;gap:8px;font:12px system-ui;color:var(--muted);padding:4px 10px;border-bottom:1px solid var(--line);background:var(--bg)}
.elemnt-widget-label button{font:inherit;color:var(--muted);background:none;border:0;cursor:pointer;text-decoration:underline;padding:0}
.elemnt-widget-frame iframe{display:block;width:100%;border:0}
.elemnt-run-btn,.elemnt-widget-run{font:600 13px system-ui;padding:5px 12px;border-radius:calc(var(--radius,8px)*.75);border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
elemnt-run{display:block;position:relative}elemnt-run .elemnt-run-bar{display:flex;gap:8px;align-items:center;margin-top:-8px;margin-bottom:12px}
.elemnt-run-output{white-space:pre-wrap;font:13px ui-monospace,Menlo,monospace;background:var(--surface);border:1px solid var(--line);border-radius:calc(var(--radius,8px)*.75);padding:8px 12px;margin:0 0 16px}
.elemnt-run-output[data-error]{color:var(--danger)}
[data-elemnt-invalid]{outline:2px dashed var(--danger);outline-offset:4px}
${layoutCss}
`;

