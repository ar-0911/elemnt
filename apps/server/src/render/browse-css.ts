/** Styles for the space landing page, the "Pages" menu and the "Keep reading" cards. */
export const browseCss = `
.eb-menu{position:relative;font-size:14px}
.eb-menu>summary{list-style:none;cursor:pointer;color:var(--muted);padding:4px 8px;border-radius:6px}
.eb-menu>summary::-webkit-details-marker{display:none}
.eb-menu>summary:hover,.eb-menu[open]>summary{background:var(--soft);color:var(--fg)}
.eb-menu>summary::after{content:"";display:inline-block;margin-left:6px;width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:translateY(-2px) rotate(45deg)}
.eb-menu-list{position:absolute;left:0;top:calc(100% + 8px);z-index:6;min-width:260px;max-width:min(380px,90vw);max-height:70vh;overflow:auto;padding:6px;border:1px solid var(--line);border-radius:10px;background:var(--surface);box-shadow:0 18px 40px -18px rgba(0,0,0,.45)}
header.bar .eb-menu-list a{display:block;padding:8px 10px;border-radius:7px;color:var(--fg);line-height:1.35}
header.bar .eb-menu-list a small{display:block;font-weight:400;color:var(--muted);font-size:12px;margin-top:2px}
header.bar .eb-menu-list a:hover{background:var(--soft)}
header.bar .eb-menu-list a[aria-current=page]{background:var(--soft);color:var(--accent);font-weight:600}
header.bar .eb-menu-list .eb-all{border-top:1px solid var(--line);margin-top:4px;border-radius:0 0 7px 7px;color:var(--accent);font-weight:600}
.crumb{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap}
.eb-card{--a:var(--ca,var(--accent));--b:var(--cb,var(--accent-2))}
:root[data-theme=dark] .eb-card{--a:var(--cad,var(--accent));--b:var(--cbd,var(--accent-2))}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .eb-card{--a:var(--cad,var(--accent));--b:var(--cbd,var(--accent-2))}}
.eb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:18px}
.eb-card{position:relative;display:flex;flex-direction:column;gap:10px;min-height:190px;padding:24px 24px 20px;border:1px solid var(--line);border-radius:calc(var(--radius,8px)*1.6);background:color-mix(in srgb,var(--surface) 88%,transparent);color:var(--fg);text-decoration:none;overflow:hidden;isolation:isolate;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}
.eb-card::before{content:"";position:absolute;inset:0 0 auto;height:3px;background:linear-gradient(90deg,var(--a),var(--b))}
.eb-card::after{content:"";position:absolute;z-index:-1;right:-30%;top:-60%;width:80%;height:120%;background:radial-gradient(closest-side,color-mix(in srgb,var(--a) 22%,transparent),transparent);opacity:.7;transition:opacity .18s}
.eb-card:hover,.eb-card:focus-visible{transform:translateY(-3px);border-color:color-mix(in srgb,var(--a) 55%,var(--line));box-shadow:0 22px 50px -28px color-mix(in srgb,var(--a) 70%,transparent)}
.eb-card:hover::after{opacity:1}
.eb-card h3{margin:0;font:700 1.3rem/1.2 var(--font-head,var(--font-body,system-ui));letter-spacing:-.01em}
.eb-card p{margin:0;color:var(--muted);font-size:15px;line-height:1.55;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.eb-meta{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;font:500 12px/1 var(--font-mono,ui-monospace,monospace);color:var(--muted)}
.eb-chip{display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border-radius:999px;border:1px solid color-mix(in srgb,var(--a) 35%,var(--line));color:var(--a);background:color-mix(in srgb,var(--a) 9%,transparent)}
.eb-go{margin-top:auto;font-weight:600;font-size:14px;color:var(--a)}
.eb-go::after{content:"→";display:inline-block;margin-left:6px;transition:transform .18s}
.eb-card:hover .eb-go::after{transform:translateX(4px)}
.eb-card.eb-feature{grid-column:1/-1;min-height:230px;padding:32px}
.eb-card.eb-feature h3{font-size:clamp(1.6rem,3.4vw,2.2rem);background:linear-gradient(100deg,var(--fg) 15%,var(--a) 65%,var(--b));-webkit-background-clip:text;background-clip:text;color:transparent}
.eb-card.eb-feature p{font-size:17px;max-width:62ch;-webkit-line-clamp:4}
.eb-more{margin:80px 0 0;padding-top:36px;border-top:1px solid var(--line)}
.eb-more-head{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:baseline;justify-content:space-between;margin:0 0 20px}
.eb-more-head h2{margin:0;font:700 1.4rem/1.2 var(--font-head,var(--font-body,system-ui))}
.eb-more-head a{color:var(--accent);font-weight:600;font-size:14px;text-decoration:none}
.eb-more .eb-card{min-height:170px}
.eb-index{max-width:1080px;margin:0 auto;padding:clamp(28px,5vw,56px) clamp(18px,4vw,32px) 96px}
.eb-index .elemnt-hero{margin-bottom:44px}
.eb-index .elemnt-hero h1{margin-bottom:.25em}
.eb-stats{display:flex;flex-wrap:wrap;gap:10px 22px;margin:18px 0 0;padding:0;list-style:none;color:var(--muted);font-size:14px}
.eb-stats b{color:var(--fg);font-weight:700}
.eb-section{margin:0 0 18px;font:600 12px/1 var(--font-mono,ui-monospace,monospace);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.eb-empty{padding:48px 24px;text-align:center;border:1px dashed var(--line);border-radius:12px;color:var(--muted)}
.eb-foot{display:flex;flex-wrap:wrap;gap:8px 18px;justify-content:space-between;margin-top:64px;padding-top:20px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}
.eb-foot a{color:var(--muted)}
@media (prefers-reduced-motion:reduce){.eb-card,.eb-card::after,.eb-go::after{transition:none}.eb-card:hover{transform:none}}
@media print{.eb-more,.eb-menu{display:none}}
`;
