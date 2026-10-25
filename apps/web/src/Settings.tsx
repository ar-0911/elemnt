import { useEffect, useState } from "react";
import { api, ApiError, type AiStatus } from "./api";

/** Workspace settings. For now: the workspace's own Anthropic API key. */
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
      </div>
    </div>
  );
}
