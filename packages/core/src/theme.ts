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
[data-elemnt-invalid]{outline:2px dashed var(--danger);outline-offset:4px}
`;
