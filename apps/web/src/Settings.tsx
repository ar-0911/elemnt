import { useEffect, useState } from "react";
import { api, ApiError, type AiStatus } from "./api";

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

/** Workspace settings: the Anthropic API key, MCP connection and widget trust. */
export function Settings({ onClose }: { onClose(): void }) {
  const [status, setStatus] = useState<AiStatus>();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string>();

  useEffect(() => {
    void api.get<AiStatus>("/api/ai").then(setStatus);
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      setStatus(await api.put<AiStatus>("/api/ai/key", { apiKey: key }));
      setKey("");
      setError(undefined);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  async function remove() {
    await api.del("/api/ai/key");
    setStatus(await api.get<AiStatus>("/api/ai"));
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="palette settings" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <h2>Claude</h2>
        <p className="hint">
          Elemnt uses your workspace's own Anthropic API key for ⌘I suggestions. It's encrypted at rest and never shown again.
          {status?.configured && (
            <>
              {" "}
              Current key: <code>{status.hint}</code>
              {status.source === "server" ? " (set by the server's ANTHROPIC_API_KEY)" : ""}.
            </>
          )}
        </p>
        <form onSubmit={(e) => void save(e)} className="row">
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" autoComplete="off" aria-label="Anthropic API key" />
          <button type="submit" className="btn primary" disabled={key.trim().length < 20}>
            Save
          </button>
          {status?.source === "workspace" && (
            <button type="button" className="btn" onClick={() => void remove()}>
              Remove
            </button>
          )}
        </form>
        {error && <p className="error">{error}</p>}
        <h2>Connect Claude to your docs</h2>
        <p className="hint">
          Claude Code: <code>claude mcp add --transport http elemnt {location.origin}/mcp</code>. In Claude, add a custom connector with the URL <code>{location.origin}/mcp</code>. Both sign in through Elemnt; anything they write lands as a draft or suggestion.
        </p>
        <WidgetsSection />
      </div>
    </div>
  );
}
