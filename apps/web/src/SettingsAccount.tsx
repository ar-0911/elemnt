import { useCallback, useEffect, useState } from "react";
import { api, ApiError, refreshMe, type Me } from "./api";
import { checklistFlag } from "./Home";
import { CopyButton, Icon, local, useToast } from "./ui";

type Role = "owner" | "admin" | "editor" | "viewer";

const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including choosing other owners.",
  admin: "Manage people, themes and settings, and edit everything.",
  editor: "Write, edit and publish pages.",
  viewer: "Read pages and comment.",
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "never");

/** Your name, username, password and API tokens. */
export function AccountSection({ me, onMe }: { me: Me; onMe(m: Me): void }) {
  const toast = useToast();
  const [name, setName] = useState(me.name ?? "");
  const [username, setUsername] = useState(me.username ?? "");
  const [profileError, setProfileError] = useState<string>();

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.put("/api/me/account", { name, ...(username ? { username } : {}) });
      onMe(await refreshMe());
      setProfileError(undefined);
      toast("Profile saved.");
    } catch (err) {
      setProfileError((err as ApiError).message);
    }
  }

  return (
    <>
      <section>
        <h2>Profile</h2>
        <form className="form" onSubmit={(e) => void saveProfile(e)}>
          <div className="form-grid">
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </label>
            <label>
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Pick one to sign in with" />
            </label>
          </div>
          <label>
            Email
            <input value={me.email} disabled />
          </label>
          {profileError && <p className="form-error">{profileError}</p>}
          <div className="form-actions start">
            <button type="submit" className="btn primary">
              Save profile
            </button>
          </div>
        </form>
      </section>
      <PasswordForm hasPassword={me.hasPassword} onSet={async () => onMe(await refreshMe())} />
      <TokensSection />
    </>
  );
}

function PasswordForm({ hasPassword, onSet }: { hasPassword: boolean; onSet(): void }) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.put("/api/me/password", { ...(hasPassword ? { current } : {}), password });
      setCurrent("");
      setPassword("");
      setError(undefined);
      toast(hasPassword ? "Password changed. Other browsers were signed out." : "Password set. You can sign in with it now.");
      onSet();
    } catch (err) {
      setError((err as ApiError).message);
    }
  }
  return (
    <section>
      <h2>{hasPassword ? "Change password" : "Set a password"}</h2>
      {!hasPassword && <p className="hint">You signed in with a token. Set a password to sign in with your username or email instead.</p>}
      <form className="form" onSubmit={(e) => void submit(e)}>
        <div className="form-grid">
          {hasPassword && (
            <label>
              Current password
              <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
            </label>
          )}
          <label>
            New password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions start">
          <button type="submit" className="btn" disabled={password.length < 8}>
            {hasPassword ? "Change password" : "Set password"}
          </button>
        </div>
      </form>
    </section>
  );
}

interface Token {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  clientId: string | null;
}

function TokensSection() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [name, setName] = useState("");
  const [made, setMade] = useState<{ name: string; token: string }>();
  const load = useCallback(() => void api.get<Token[]>("/api/me/tokens").then(setTokens), []);
  useEffect(load, [load]);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const t = await api.post<{ name: string; token: string }>("/api/me/tokens", { name });
    setMade(t);
    setName("");
    load();
  }
  return (
    <section>
      <h2>API tokens and connected apps</h2>
      <p className="hint">For scripts, CI and Claude Code with a header. Claude apps that connected through the browser show up here too. Remove anything you don't recognise.</p>
      {made && (
        <div className="note ok">
          <p>
            <strong>{made.name}</strong>: copy it now, it won't be shown again.
          </p>
          <div className="code-row">
            <code>{made.token}</code>
            <CopyButton text={made.token} />
          </div>
        </div>
      )}
      {tokens.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Created</th>
              <th>Last used</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id}>
                <td>
                  {t.name}
                  {t.clientId && <span className="pill">app</span>}
                </td>
                <td>{when(t.createdAt)}</td>
                <td>{when(t.lastUsedAt)}</td>
                <td className="right">
                  <button type="button" className="btn small danger" onClick={() => void api.del(`/api/me/tokens/${t.id}`).then(load)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form className="inline-form" onSubmit={(e) => void create(e)}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder='Token name, e.g. "Claude Code on my laptop"' aria-label="New token name" />
        <button type="submit" className="btn" disabled={!name.trim()}>
          <Icon name="plus" size={14} /> Create token
        </button>
      </form>
    </section>
  );
}

interface Member {
  userId: string;
  email: string;
  name: string | null;
  username: string | null;
  role: Role;
}
interface Invite {
  id: string;
  role: Role;
  expiresAt: string;
  uses: number;
}

/** Who's in the workspace, their roles, and invite links (admins). */
export function PeopleSection({ me }: { me: Me }) {
  const toast = useToast();
  const [data, setData] = useState<{ members: Member[]; invites: Invite[]; signupOpen: boolean }>();
  const [role, setRole] = useState<Role>("editor");
  const [link, setLink] = useState<string>();
  const load = useCallback(() => void api.get<typeof data>("/api/members").then(setData), []);
  useEffect(load, [load]);
  const isOwner = me.role === "owner";

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const made = await api.post<{ url: string }>("/api/invites", { role });
    setLink(made.url);
    local.set(checklistFlag("invite"), "1");
    load();
  }
  async function change(userId: string, next: Role) {
    try {
      await api.put(`/api/members/${userId}`, { role: next });
      toast("Role updated.");
    } catch (err) {
      toast((err as ApiError).message, "error");
    }
    load();
  }
  async function remove(m: Member) {
    if (!confirm(`Remove ${m.name || m.email} from this workspace? They'll be signed out.`)) return;
    try {
      await api.del(`/api/members/${m.userId}`);
      toast("Removed.");
    } catch (err) {
      toast((err as ApiError).message, "error");
    }
    load();
  }

  if (!data) return <p className="hint">Loading…</p>;
  return (
    <>
      <section>
        <h2>Invite people</h2>
        <p className="hint">Make a link and send it. Anyone with it can create an account with the role you pick, for the next 7 days.</p>
        <form className="inline-form" onSubmit={(e) => void invite(e)}>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role for people who use this link">
            {(["viewer", "editor", "admin"] as Role[]).map((r) => (
              <option key={r} value={r}>
                {r[0]!.toUpperCase() + r.slice(1)}: {ROLE_HELP[r]}
              </option>
            ))}
          </select>
          <button type="submit" className="btn primary">
            Create invite link
          </button>
        </form>
        {link && (
          <div className="code-row">
            <code>{link}</code>
            <CopyButton text={link} label="Copy link" />
          </div>
        )}
        {data.invites.length > 0 && (
          <ul className="invite-list">
            {data.invites.map((i) => (
              <li key={i.id}>
                <span className="pill">{i.role}</span> link, used {i.uses} time{i.uses === 1 ? "" : "s"}, expires {when(i.expiresAt)}
                <button type="button" className="btn small ghost" onClick={() => void api.del(`/api/invites/${i.id}`).then(load)}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
        {data.signupOpen && <p className="note">Sign-up is open on this server: anyone can create an account and join as a viewer.</p>}
      </section>
      <section>
        <h2>Members</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {data.members.map((m) => {
              const self = m.userId === me.userId;
              const locked = self || (m.role === "owner" && !isOwner);
              return (
                <tr key={m.userId}>
                  <td>
                    <strong>{m.name || m.username || m.email}</strong>
                    {self && <span className="pill">you</span>}
                    <div className="hint">{m.username ? `@${m.username} · ${m.email}` : m.email}</div>
                  </td>
                  <td>
                    <div className="row-actions">
                      <select value={m.role} disabled={locked} onChange={(e) => void change(m.userId, e.target.value as Role)} aria-label={`Role for ${m.name || m.email}`} title={ROLE_HELP[m.role]}>
                        {(isOwner ? (["owner", "admin", "editor", "viewer"] as Role[]) : m.role === "owner" ? (["owner"] as Role[]) : (["admin", "editor", "viewer"] as Role[])).map((r) => (
                          <option key={r} value={r}>
                            {r[0]!.toUpperCase() + r.slice(1)}
                          </option>
                        ))}
                      </select>
                      {!locked && (
                        <button type="button" className="btn small danger" onClick={() => void remove(m)}>
                          Remove
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <dl className="roles-help">
          {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
            <div key={r}>
              <dt>{r[0]!.toUpperCase() + r.slice(1)}</dt>
              <dd>{ROLE_HELP[r]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
