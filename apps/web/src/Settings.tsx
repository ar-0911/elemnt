import { useEffect, useState } from "react";
import { AccountSection, PeopleSection } from "./SettingsAccount";
import { CopyButton, Dialog, Icon, local, type IconName } from "./ui";
import { checklistFlag } from "./Home";
import type { OrgTheme, PageStyle } from "@elemnt/core";
import { api, ApiError, refreshMe, type AiStatus, type Me } from "./api";
import { StyleForm } from "./StyleForm";

interface WidgetSettings {
  verified: boolean;
  hosts: string[];
  selfVerify: boolean;
  sandboxUrl: string | null;
}
interface WidgetReport {
  hash: string;
  reason: string;
  pageUrl: string | null;
  createdAt: string;
  summary: string;
  blocked: string | null;
}

/** Widget trust and abuse reports (admins). */
function WidgetsSection() {
  const [s, setS] = useState<WidgetSettings>();
  const [hosts, setHosts] = useState("");
  const [reports, setReports] = useState<WidgetReport[]>([]);
  const [error, setError] = useState<string>();

  const load = async () => {
    try {
      const ws = await api.get<WidgetSettings>("/api/settings/widgets");
      setS(ws);
      setHosts(ws.hosts.join(", "));
      setReports((await api.get<{ reports: WidgetReport[] }>("/api/widgets/reports")).reports);
    } catch (err) {
      if ((err as ApiError).status !== 403) setError((err as ApiError).message);
    }
  };
  useEffect(() => void load(), []);
  if (!s) return null;

  const update = async (body: { verified?: boolean; hosts?: string[] }) => {
    try {
      await api.put("/api/settings/widgets", body);
      setError(undefined);
      await load();
    } catch (err) {
      setError((err as ApiError).message);
    }
  };
  const block = async (r: WidgetReport) => {
    if (r.blocked) await api.del(`/api/widgets/${r.hash}/block`);
    else await api.post(`/api/widgets/${r.hash}/block`, { reason: r.reason });
    await load();
  };

  return (
    <>
      <h2>Widgets</h2>
      <p className="hint">
        {s.sandboxUrl ? <>Widgets run sandboxed on <code>{s.sandboxUrl}</code>.</> : <>No sandbox origin is configured, so widgets show their summary only. Set ELEMNT_SANDBOX_URL on the server.</>} On public pages, widgets
        from unverified workspaces wait for a click. Verified workspaces' widgets run at once and may connect to the hosts below.
      </p>
      <label className="row">
        <input type="checkbox" checked={s.verified} disabled={!s.selfVerify} onChange={(e) => void update({ verified: e.target.checked })} /> Verified workspace
        {!s.selfVerify && <span className="hint"> (granted by the server operator)</span>}
      </label>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void update({ hosts: hosts.split(/[\s,]+/).filter(Boolean) });
        }}
      >
        <input value={hosts} onChange={(e) => setHosts(e.target.value)} placeholder="api.example.com, status.example.com" aria-label="Hosts widgets may connect to" />
        <button type="submit" className="btn">
          Save hosts
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      <h3>Reports</h3>
      {reports.length === 0 ? (
        <p className="hint">No reports.</p>
      ) : (
        <ul className="reports">
          {reports.map((r, i) => (
            <li key={i}>
              <strong>{r.reason}</strong> on {r.pageUrl ?? "a page"}: {r.summary}{" "}
              <button type="button" className="btn" onClick={() => void block(r)}>
                {r.blocked ? "Unblock" : "Block everywhere"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Whether signed-out readers of public pages may use Ask the page (it spends the workspace's key). */
function AskSection() {
  const [on, setOn] = useState<boolean>();
  useEffect(() => {
    void api.get<{ askPublic: boolean }>("/api/settings/ask").then((r) => setOn(r.askPublic)).catch(() => {});
  }, []);
  if (on === undefined) return null;
  return (
    <>
      <h2>Ask the page</h2>
      <p className="hint">Members can always ask questions on pages. Turning this on lets anyone reading a public page ask too, using this workspace's Claude key (10 questions per reader per hour).</p>
      <label className="row">
        <input type="checkbox" checked={on} onChange={(e) => void api.put<{ askPublic: boolean }>("/api/settings/ask", { askPublic: e.target.checked }).then((r) => setOn(r.askPublic))} /> Public readers can ask
      </label>
    </>
  );
}

/** The organization theme every page starts from (admins). */
function ThemeSection() {
  const [theme, setTheme] = useState<OrgTheme>();
  const [status, setStatus] = useState<string>();
  useEffect(() => {
    void api.get<{ theme: OrgTheme | null }>("/api/settings/theme").then((r) => setTheme(r.theme ?? {}));
  }, []);
  if (!theme) return null;
  const save = async (next: OrgTheme | null) => {
    try {
      const r = await api.put<{ theme: OrgTheme | null }>("/api/settings/theme", { theme: next });
      setTheme(r.theme ?? {});
      setStatus(next ? "Saved. Every page without its own style uses it now." : "Removed.");
      void refreshMe();
    } catch (err) {
      setStatus((err as ApiError).message);
    }
  };
  return (
    <>
      <h2>Organization theme</h2>
      <p className="hint">
        The look every page in this workspace starts from. Pages can pick their own style in their frontmatter unless you lock the theme. Claude reads this theme (and your notes) before it writes a page.
      </p>
      <StyleForm org value={theme} onChange={setTheme} />
      <div className="row">
        <label className="row">
          <input type="checkbox" checked={Boolean(theme.lock)} onChange={(e) => setTheme({ ...theme, lock: e.target.checked || undefined })} /> Lock colours and fonts for every page
        </label>
        <button type="button" className="btn primary" onClick={() => void save(theme)}>
          Save theme
        </button>
        <button type="button" className="btn" onClick={() => void save(null)}>
          Remove
        </button>
      </div>
      {status && <p className="hint" role="status">{status}</p>}
    </>
  );
}

/** Each person's own style: new pages start with it and Claude offers it first. */
function MyStyleSection() {
  const [style, setStyle] = useState<PageStyle>();
  const [theme, setTheme] = useState<OrgTheme | null>(null);
  const [status, setStatus] = useState<string>();
  useEffect(() => {
    void api.get<{ style: PageStyle | null }>("/api/me/style").then((r) => setStyle(r.style ?? {}));
    void api.get<{ theme: OrgTheme | null }>("/api/settings/theme").then((r) => setTheme(r.theme));
  }, []);
  if (!style) return null;
  const save = async (next: PageStyle | null) => {
    try {
      const r = await api.put<{ style: PageStyle | null }>("/api/me/style", { style: next });
      setStyle(r.style ?? {});
      setStatus(next ? "Saved. New pages start in this style, and Claude uses it when you don't say otherwise." : "Cleared.");
      void refreshMe();
    } catch (err) {
      setStatus((err as ApiError).message);
    }
  };
  return (
    <>
      <h2>My style</h2>
      <p className="hint">{theme?.lock ? "Your organization's theme is locked, so colours and fonts come from it; width and background are still yours." : "How you like your pages to look. New pages start with it, and Claude offers it before asking."}</p>
      <StyleForm value={style} onChange={setStyle} base={theme} />
      <div className="row">
        <button type="button" className="btn primary" onClick={() => void save(style)}>
          Save my style
        </button>
        <button type="button" className="btn" onClick={() => void save(null)}>
          Clear
        </button>
      </div>
      {status && <p className="hint" role="status">{status}</p>}
    </>
  );
}

export type SettingsTab = "account" | "style" | "connect" | "people" | "claude" | "theme" | "widgets" | "ask";

const TABS: { id: SettingsTab; label: string; icon: IconName; admin?: boolean; group: string }[] = [
  { id: "account", label: "Account", icon: "user", group: "You" },
  { id: "style", label: "My style", icon: "palette", group: "You" },
  { id: "connect", label: "Connect Claude", icon: "plug", group: "You" },
  { id: "people", label: "People", icon: "team", admin: true, group: "Workspace" },
  { id: "claude", label: "Claude API key", icon: "key", admin: true, group: "Workspace" },
  { id: "theme", label: "Organization theme", icon: "palette", admin: true, group: "Workspace" },
  { id: "ask", label: "Ask the page", icon: "chat", admin: true, group: "Workspace" },
  { id: "widgets", label: "Widgets", icon: "shield", admin: true, group: "Workspace" },
];

/** Settings, one topic per tab: you first, then the workspace (admins). */
export function Settings({ me, canAdmin, tab, onTab, onClose, onMe }: { me: Me; canAdmin: boolean; tab: SettingsTab; onTab(t: SettingsTab): void; onClose(): void; onMe(m: Me): void }) {
  const tabs = TABS.filter((t) => !t.admin || canAdmin);
  const currentTab = tabs.some((t) => t.id === tab) ? tab : "account";
  return (
    <Dialog title="Settings" onClose={onClose} wide>
      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          {["You", "Workspace"].map((g) =>
            tabs.some((t) => t.group === g) ? (
              <div key={g}>
                <p className="side-label">{g}</p>
                {tabs
                  .filter((t) => t.group === g)
                  .map((t) => (
                    <button key={t.id} type="button" aria-current={currentTab === t.id ? "page" : undefined} onClick={() => onTab(t.id)}>
                      <Icon name={t.icon} size={16} />
                      {t.label}
                    </button>
                  ))}
              </div>
            ) : null,
          )}
        </nav>
        <div className="settings-body">
          {currentTab === "account" && <AccountSection me={me} onMe={onMe} />}
          {currentTab === "style" && <MyStyleSection />}
          {currentTab === "connect" && <ConnectSection />}
          {currentTab === "people" && <PeopleSection me={me} />}
          {currentTab === "claude" && <ClaudeKeySection />}
          {currentTab === "theme" && <ThemeSection />}
          {currentTab === "ask" && <AskSection />}
          {currentTab === "widgets" && <WidgetsSection />}
        </div>
      </div>
    </Dialog>
  );
}

function ConnectSection() {
  const cmd = `claude mcp add --transport http elemnt ${location.origin}/mcp`;
  const local_ = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  useEffect(() => local.set(checklistFlag("claude"), "1"), []);
  return (
    <section>
      <h2>Connect Claude to your docs</h2>
      <p className="hint">Claude reads your pages as Markdown and writes drafts and suggestions. Nothing it writes is published until a person reviews it.</p>
      <h3>Claude Code</h3>
      <p>Run this once in a terminal. The first time Claude uses it, a browser window asks you to approve.</p>
      <div className="code-row">
        <code>{cmd}</code>
        <CopyButton text={cmd} />
      </div>
      <h3>Claude chat (claude.ai and the desktop app)</h3>
      <ol className="steps-list">
        <li>Open Settings → Connectors → Add custom connector.</li>
        <li>
          Name it Elemnt and use the URL <code>{location.origin}/mcp</code>. <CopyButton text={`${location.origin}/mcp`} label="Copy URL" />
        </li>
        <li>Click Connect, then Allow on the Elemnt page that opens.</li>
      </ol>
      {local_ && <p className="note">Claude chat connects from the internet, so it can't reach an address like {location.host}. Deploy Elemnt or use a tunnel first. Claude Code works locally as is.</p>}
      <p className="hint">Then ask: "Write an Elemnt doc about …". Claude will ask about style first, unless your workspace has a locked theme.</p>
    </section>
  );
}

function ClaudeKeySection() {
  const [status, setStatus] = useState<AiStatus>();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void api.get<AiStatus>("/api/ai").then(setStatus);
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      setStatus(await api.put<AiStatus>("/api/ai/key", { apiKey: key }));
      setKey("");
      setError(undefined);
      setSaved(true);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  async function remove() {
    await api.del("/api/ai/key");
    setStatus(await api.get<AiStatus>("/api/ai"));
  }

  return (
    <section>
      <h2>Claude API key</h2>
      <p className="hint">
        Powers the AI inside Elemnt: ⌘I edits, Ask the page, reading levels and make-a-component. It's separate from a Claude subscription; get one at console.anthropic.com. Claude Code and Claude chat don't need it.
      </p>
      {status?.configured ? (
        <p className="note ok">
          <Icon name="check" size={16} /> A key is set: <code>{status.hint}</code>
          {status.source === "server" ? " (from the server's ANTHROPIC_API_KEY)" : ""}.
        </p>
      ) : (
        <p className="note">No key yet, so the in-app AI features are off.</p>
      )}
      <form onSubmit={(e) => void save(e)} className="form">
        <label>
          {status?.configured ? "Replace the key" : "API key"}
          <input type="password" value={key} onChange={(e) => (setKey(e.target.value), setSaved(false))} placeholder="sk-ant-…" autoComplete="off" />
        </label>
        {error && <p className="form-error">{error}</p>}
        {saved && <p className="form-ok">Saved. It's encrypted and won't be shown again.</p>}
        <div className="form-actions start">
          <button type="submit" className="btn primary" disabled={key.trim().length < 20}>
            Save key
          </button>
          {status?.source === "workspace" && (
            <button type="button" className="btn danger" onClick={() => void remove()}>
              Remove key
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
