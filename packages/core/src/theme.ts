/**
 * Default look for rendered Elemnt pages: color tokens (light and dark) and
 * styles for every built-in component. Used by the reader and the editor
 * preview so both look the same. Scoped to `.elemnt-page` where it styles
 * plain elements, so it can sit inside other apps.
 */
export const themeTokensCss = `
:root{--bg:#f7f8fa;--fg:#161a22;--muted:#5b6374;--line:#dde1e8;--surface:#fff;--accent:#2949c7;--soft:#e7ecfb;--code:#eef0f4;--warn:#9a5b00;--warn-soft:#fbf0dc;--danger:#b0312b;--danger-soft:#fbe6e4;--ok:#1f7a4d;--ok-soft:#e3f3ea}
@media (prefers-color-scheme:dark){:root{--bg:#0f1218;--fg:#e4e7ee;--muted:#9aa2b4;--line:#2a303c;--surface:#161a22;--accent:#8aa2ff;--soft:#1d2440;--code:#1c212b;--warn:#f0b65a;--warn-soft:#2c2213;--danger:#ff8b84;--danger-soft:#331a19;--ok:#6fd3a0;--ok-soft:#13291f;color-scheme:dark}}
`;

export const contentCss = `
.elemnt-page :is(h1,h2,h3){line-height:1.2;text-wrap:balance}a{color:var(--accent)}
.elemnt-page code{font:0.88em ui-monospace,Menlo,monospace;background:var(--code);padding:1px 5px;border-radius:4px}
.elemnt-page pre{background:var(--code);border:1px solid var(--line);border-radius:6px;padding:12px 14px;overflow-x:auto}pre code{background:none;padding:0}
.elemnt-page table{border-collapse:collapse;display:block;overflow-x:auto}th,td{border:1px solid var(--line);padding:6px 10px}
.lede{font-size:19px;color:var(--muted);margin-top:-8px}
.elemnt-callout{border:1px solid var(--line);border-left:4px solid var(--accent);background:var(--surface);border-radius:6px;padding:4px 16px;margin:16px 0}
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
.elemnt-details{border:1px solid var(--line);border-radius:6px;padding:8px 14px;background:var(--surface)}.elemnt-details summary{font-weight:600;cursor:pointer}
figure.elemnt-diagram{margin:20px 0;text-align:center}figure.elemnt-diagram pre.mermaid{background:var(--surface)}figcaption{font-size:14px;color:var(--muted)}
elemnt-query{font-weight:600;font-variant-numeric:tabular-nums}
figure.elemnt-chart,figure.elemnt-datagrid{margin:20px 0}
elemnt-chart svg{display:block;width:100%;height:auto;overflow:visible}elemnt-chart[data-drawn] table{display:none}
elemnt-chart .axis{stroke:var(--line)}elemnt-chart text{fill:var(--muted);font:12px system-ui}
.elemnt-chart-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:13px;color:var(--muted);margin-top:6px}.elemnt-chart-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px}
.elemnt-datagrid-filter{font:inherit;font-size:14px;padding:5px 9px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--fg);margin-bottom:8px;width:min(280px,100%)}
elemnt-datagrid th[data-sort]{cursor:pointer;user-select:none}elemnt-datagrid th[data-sort]::after{content:" ↕";color:var(--muted)}elemnt-datagrid th[data-sort=asc]::after{content:" ↑"}elemnt-datagrid th[data-sort=desc]::after{content:" ↓"}
.elemnt-explore{display:block;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:2px 16px;margin:16px 0}
elemnt-var,elemnt-calc{font-weight:700;color:var(--accent);font-variant-numeric:tabular-nums}
elemnt-var input[type=range]{vertical-align:middle;width:120px;margin:0 6px;accent-color:var(--accent)}
.elemnt-annotate{display:block;margin:16px 0}.elemnt-annotate .elemnt-line{display:inline-block;width:100%}
.elemnt-annotate .elemnt-line[data-note]{background:var(--soft);cursor:help}.elemnt-annotate .elemnt-line[data-active]{outline:2px solid var(--accent)}
.elemnt-annotate .elemnt-line[data-note]::after{content:attr(data-note);float:right;font:700 11px system-ui;color:var(--accent)}
.elemnt-notes li[data-active]{background:var(--soft);border-radius:4px}
.elemnt-quiz{display:block;border:1px solid var(--line);border-radius:8px;padding:4px 16px 12px;margin:16px 0;background:var(--surface)}
.elemnt-quiz-question{font-weight:700}.elemnt-quiz-options{list-style:upper-alpha;padding-left:24px}
.elemnt-quiz-option p{margin:4px 0}elemnt-quiz[data-ready] .elemnt-quiz-option{cursor:pointer;border-radius:6px;padding:2px 6px}
elemnt-quiz[data-ready] .elemnt-quiz-option:hover{background:var(--soft)}
.elemnt-quiz-option[data-picked=right]{background:var(--ok-soft)}.elemnt-quiz-option[data-picked=wrong]{background:var(--danger-soft)}
elemnt-quiz[data-ready]:not([data-answered]) .elemnt-quiz-why{display:none}.elemnt-quiz-why{border-top:1px solid var(--line);margin-top:8px;color:var(--muted)}
.elemnt-compare{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0}@media (max-width:640px){.elemnt-compare{grid-template-columns:1fr}}
.elemnt-side{border:1px solid var(--line);border-radius:8px;padding:2px 14px;background:var(--surface);min-width:0}.elemnt-side-label{font-weight:700;color:var(--muted);text-transform:uppercase;font-size:12px;letter-spacing:.05em}
.elemnt-term{font-style:normal;border-bottom:1px dotted var(--accent);cursor:help;position:relative}
.elemnt-term:is(:hover,:focus)::after{content:attr(data-def);position:absolute;left:0;top:calc(100% + 6px);z-index:5;width:max-content;max-width:280px;padding:8px 10px;border-radius:6px;background:var(--fg);color:var(--bg);font-size:13px;line-height:1.4;font-weight:400}
elemnt-widget{display:block;margin:16px 0}.elemnt-widget-summary{border:1px dashed var(--line);border-radius:8px;padding:4px 14px;color:var(--muted)}
.elemnt-widget-frame{border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface)}
.elemnt-widget-label{display:flex;justify-content:space-between;gap:8px;font:12px system-ui;color:var(--muted);padding:4px 10px;border-bottom:1px solid var(--line);background:var(--bg)}
.elemnt-widget-label button{font:inherit;color:var(--muted);background:none;border:0;cursor:pointer;text-decoration:underline;padding:0}
.elemnt-widget-frame iframe{display:block;width:100%;border:0}
.elemnt-run-btn,.elemnt-widget-run{font:600 13px system-ui;padding:5px 12px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
elemnt-run{display:block;position:relative}elemnt-run .elemnt-run-bar{display:flex;gap:8px;align-items:center;margin-top:-8px;margin-bottom:12px}
.elemnt-run-output{white-space:pre-wrap;font:13px ui-monospace,Menlo,monospace;background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:8px 12px;margin:0 0 16px}
.elemnt-run-output[data-error]{color:var(--danger)}
[data-elemnt-invalid]{outline:2px dashed var(--danger);outline-offset:4px}
`;
