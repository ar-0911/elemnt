import { mountThemeToggle } from "@elemnt/elements";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, getMe, type Me, type Space, type TreePage } from "./api";
import { checklistFlag, Home } from "./Home";
import { PageEditor } from "./PageEditor";
import { Palette } from "./Palette";
import { Settings, type SettingsTab } from "./Settings";
import { navigate, useRoute } from "./router";
import { withStyle } from "./look";
import { restartTour, Tour } from "./Tour";
import { Dialog, Icon, local, Menu, Toasts, useToast, type IconName } from "./ui";

const NEW_PAGE = (title: string, summary: string) => `---
title: ${title.replace(/\n/g, " ")}
${summary.trim() ? `summary: ${summary.replace(/\n/g, " ")}\n` : ""}---

Start with why this matters to the reader.

:::callout{type=tip}
Start a line with / to insert a component: callouts, steps, charts, diagrams and more.
:::
`;

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9/]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");

const SPACE_ICON: Record<Space["visibility"], IconName> = { public: "globe", workspace: "team", private: "lock" };

function Tree({ pages, space, current }: { pages: TreePage[]; space: string; current: string | undefined }) {
  if (!pages.length) return <p className="tree-empty">No pages yet.</p>;
  return (
    <ul className="tree">
      {pages.map((p) => (
        <li key={p.id} style={{ paddingLeft: `${(p.path.split("/").length - 1) * 12}px` }}>
          <a
            href={`/app/${space}/${p.path}`}
            aria-current={p.path === current ? "page" : undefined}
            title={p.title}
            onClick={(e) => {
              e.preventDefault();
              navigate(space, p.path);
            }}
          >
            <span className="tree-title">{p.title}</span>
            {!p.published ? <span className="dot draft" title="Draft, not published yet" /> : p.hasDraft ? <span className="dot edited" title="Has unpublished changes" /> : null}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Light/dark switch; the choice is shared with the reader. */
function ThemeButton() {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (ref.current) mountThemeToggle(ref.current);
  }, []);
  return <button ref={ref} type="button" className="icon-btn theme-btn" />;
}

interface ExplainJob {
  status: "running" | "done" | "failed";
  error?: string;
  result?: { path: string; space: string; citedPaths: string[]; commit: string };
}

const EXPLAIN_STAGES = ["Reading the repo's files", "Working out how it fits together", "Writing the explainer", "Checking the page"];

function NewPageDialog({
  space,
  initialMode = "blank",
  onClose,
  onCreate,
  onExplained,
}: {
  space: Space;
  initialMode?: "blank" | "repo";
  onClose(): void;
  onCreate(path: string, title: string, summary: string): Promise<void>;
  onExplained(path: string): void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [path, setPath] = useState("");
  const [edited, setEdited] = useState(false);
  const [repo, setRepo] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState<number>();
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
  const finalPath = edited ? path : slugify(title);
  const repoOk = /^(https?:\/\/)?(www\.)?github\.com\/[\w.-]+\/[\w.-]+|^[\w.-]+\/[\w.-]+$/.test(repo.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "repo") return explain();
    if (!title.trim() || !finalPath) return;
    setBusy(true);
    try {
      await onCreate(finalPath, title.trim(), summary.trim());
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function explain() {
    if (!repoOk) return;
    setBusy(true);
    setError(undefined);
    const started = Date.now();
    try {
      const { id } = await api.post<{ id: string }>("/api/explain", { repo: repo.trim(), space: space.slug, ...(edited && path ? { path } : {}) });
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        if (!alive.current) return;
        setElapsed(Date.now() - started);
        const job = await api.get<ExplainJob>(`/api/explain/${id}`);
        if (job.status === "failed") throw new Error(job.error ?? "Explaining failed.");
        if (job.status === "done" && job.result) return onExplained(job.result.path);
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
      setElapsed(undefined);
    }
  }

  const stage = elapsed === undefined ? 0 : Math.min(EXPLAIN_STAGES.length - 1, Math.floor(elapsed / 25_000));
  return (
    <Dialog title={`New page in ${space.name}`} onClose={onClose}>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <div className="seg seg-wide" role="group" aria-label="Start from">
          <button type="button" aria-pressed={mode === "blank"} onClick={() => setMode("blank")} disabled={busy}>
            <Icon name="page" size={14} /> Blank page
          </button>
          <button type="button" aria-pressed={mode === "repo"} onClick={() => setMode("repo")} disabled={busy}>
            <Icon name="repo" size={14} /> Explain a GitHub repo
          </button>
        </div>
        {mode === "blank" ? (
          <>
            <label>
              Title
              <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Deploying the billing service" required />
            </label>
            <label>
              One-line summary <span className="hint">Optional. Shown in search, link previews and to agents.</span>
              <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What will the reader be able to do after reading?" />
            </label>
          </>
        ) : (
          <>
            <p className="hint">Claude reads the repo and drafts one rich page: what it is, how it works, a quickstart and a tour of the code with live snippets. You review it before anything is published, and Elemnt suggests updates when the code changes.</p>
            <label>
              GitHub repo
              <input autoFocus value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="https://github.com/owner/name" disabled={busy} spellCheck={false} autoCapitalize="none" />
            </label>
          </>
        )}
        <label>
          Address {mode === "repo" && <span className="hint">Optional. Defaults to the repo's name.</span>}
          <div className="prefixed">
            <span>/{space.slug}/</span>
            <input
              value={mode === "repo" ? path : finalPath}
              onChange={(e) => {
                setEdited(true);
                setPath(slugify(e.target.value));
              }}
              placeholder={mode === "repo" ? "repo-name" : "deploying-billing"}
              aria-describedby="path-hint"
              disabled={busy && mode === "repo"}
            />
          </div>
          {mode === "blank" && (
            <span className="hint" id="path-hint">
              Use / to nest it under another page, like guides/deploy.
            </span>
          )}
        </label>
        {busy && mode === "repo" && (
          <div className="progress-note" role="status">
            <span className="spinner" aria-hidden="true" />
            <div>
              <strong>{EXPLAIN_STAGES[stage]}…</strong>
              <span className="hint">Usually one to three minutes. You can close this; the draft will appear in the page list.</span>
            </div>
          </div>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            {busy && mode === "repo" ? "Close" : "Cancel"}
          </button>
          {mode === "blank" ? (
            <button type="submit" className="btn primary" disabled={busy || !title.trim() || !finalPath}>
              {busy ? "Creating…" : "Create page"}
            </button>
          ) : (
            <button type="submit" className="btn primary" disabled={busy || !repoOk}>
              <Icon name="sparkle" size={14} /> {busy ? "Explaining…" : "Explain this repo"}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

function NewSpaceDialog({ onClose, onCreate }: { onClose(): void; onCreate(name: string, visibility: Space["visibility"]): Promise<void> }) {
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<Space["visibility"]>("workspace");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const options: { value: Space["visibility"]; icon: IconName; title: string; body: string }[] = [
    { value: "workspace", icon: "team", title: "Workspace", body: "Everyone in this workspace can read it. Good for internal docs." },
    { value: "public", icon: "globe", title: "Public", body: "Anyone with the link can read published pages. Good for READMEs and open source." },
  ];
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onCreate(name.trim(), visibility);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <Dialog title="New space" onClose={onClose}>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <p className="hint">A space groups related pages, like "Engineering" or "API docs".</p>
        <label>
          Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Engineering" required />
        </label>
        <fieldset className="choices">
          <legend>Who can read it</legend>
          {options.map((o) => (
            <label key={o.value} className={`choice${visibility === o.value ? " on" : ""}`}>
              <input type="radio" name="visibility" value={o.value} checked={visibility === o.value} onChange={() => setVisibility(o.value)} />
              <Icon name={o.icon} />
              <span>
                <strong>{o.title}</strong>
                <span className="hint">{o.body}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !slugify(name)}>
            {busy ? "Creating…" : "Create space"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const SHORTCUTS: [string, string][] = [
  ["⌘K", "Search and jump to a page"],
  ["⌘I", "Ask Claude about the selection"],
  ["⌘S", "Save draft now (it also saves as you type)"],
  ["⌘↵", "Publish"],
  ["⌘\\", "Switch between write, split and preview"],
  ["/", "Insert a component (at the start of a line)"],
  ["?", "Show these shortcuts"],
];

function ShortcutsDialog({ onClose }: { onClose(): void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose}>
      <p className="hint">On Windows and Linux, use Ctrl instead of ⌘.</p>
      <dl className="shortcuts">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k}>
            <dt>
              <kbd>{k}</kbd>
            </dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

function Initials({ me }: { me: Me | undefined }) {
  const src = me?.name || me?.username || me?.email || "?";
  const letters = src
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return <span className="avatar" aria-hidden="true">{letters}</span>;
}

export function App() {
  return (
    <Toasts>
      <Shell />
    </Toasts>
  );
}

function Shell() {
  const route = useRoute();
  const toast = useToast();
  const [me, setMe] = useState<Me>();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [pages, setPages] = useState<TreePage[]>([]);
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState<SettingsTab | false>(false);
  const [dialog, setDialog] = useState<"page" | "explain" | "space" | "keys">();

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch((e: ApiError) => {
        if (e.status === 401) location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
        else toast(e.message, "error");
      });
    void api.get<Space[]>("/api/spaces").then((s) => {
      setSpaces(s);
      if (!location.pathname.replace(/^\/app\/?/, "") && s[0]) navigate(s[0].slug);
    });
    // Arriving from sign-up: say hello once, then tidy the address bar.
    if (new URLSearchParams(location.search).has("welcome")) history.replaceState(null, "", location.pathname);
  }, [toast]);

  const loadTree = useCallback(() => {
    if (route.space) void api.get<{ pages: TreePage[] }>(`/api/spaces/${route.space}/tree`).then((t) => setPages(t.pages));
  }, [route.space]);
  useEffect(loadTree, [loadTree]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, .cm-editor, [contenteditable]");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (e.key === "?" && !typing && !e.metaKey && !e.ctrlKey) setDialog("keys");
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const canEdit = me?.role === "owner" || me?.role === "admin" || me?.role === "editor";
  const canAdmin = me?.role === "owner" || me?.role === "admin";
  const current = pages.find((p) => p.path === route.path);
  const space = spaces.find((s) => s.slug === route.space);

  async function createPage(path: string, title: string, summary: string) {
    if (!route.space) return;
    const source = NEW_PAGE(title, summary);
    await api.post(`/api/spaces/${route.space}/pages`, { path, source: me?.style ? withStyle(source, me.style) : source, draft: true });
    local.set(checklistFlag("page"), "1");
    setDialog(undefined);
    loadTree();
    navigate(route.space, path);
    toast("Page created. It's a draft until you publish it.");
  }

  async function createSpace(name: string, visibility: Space["visibility"]) {
    const slug = slugify(name).replace(/\//g, "-");
    await api.post("/api/spaces", { slug, name, visibility });
    setSpaces(await api.get<Space[]>("/api/spaces"));
    setDialog(undefined);
    navigate(slug);
    toast(`Created ${name}.`);
  }

  async function signOut() {
    await fetch("/logout", { method: "POST", credentials: "same-origin" });
    location.href = "/login";
  }

  return (
    <div className="shell">
      <aside className="sidebar" data-tour="sidebar">
        <div className="side-head">
          <a className="brand" href="/app/">
            <svg viewBox="0 0 32 32" width="24" height="24" aria-hidden="true">
              <defs>
                <linearGradient id="brand-g" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#6366f1" />
                  <stop offset="1" stopColor="#06b6d4" />
                </linearGradient>
              </defs>
              <rect width="32" height="32" rx="9" fill="url(#brand-g)" />
              <path d="M10 9h12M10 16h9M10 23h12M10 9v14" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
            Elemnt
          </a>
          <ThemeButton />
        </div>

        {canEdit && route.space && (
          <button type="button" className="btn primary block" data-tour="new-page" onClick={() => setDialog("page")}>
            <Icon name="plus" size={16} /> New page
          </button>
        )}
        <button type="button" className="search-btn" onClick={() => setPalette(true)} {...(!canEdit ? { "data-tour": "new-page" } : {})}>
          <Icon name="search" size={16} />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>

        <nav className="side-section" aria-label="Spaces">
          <div className="side-label">
            Spaces
            {canAdmin && (
              <button type="button" className="icon-btn small" aria-label="New space" title="New space" onClick={() => setDialog("space")}>
                <Icon name="plus" size={14} />
              </button>
            )}
          </div>
          <ul className="spaces">
            {spaces.map((s) => (
              <li key={s.id}>
                <a href={`/app/${s.slug}`} aria-current={s.slug === route.space && !route.path ? "page" : s.slug === route.space ? "true" : undefined} onClick={(e) => (e.preventDefault(), navigate(s.slug))}>
                  <Icon name={SPACE_ICON[s.visibility]} size={15} />
                  <span>{s.name}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {route.space && (
          <nav className="side-section grow" aria-label={`Pages in ${space?.name ?? route.space}`}>
            <div className="side-label">Pages</div>
            <Tree pages={pages} space={route.space} current={route.path} />
          </nav>
        )}

        <div className="side-foot">
          <Menu
            label="Account and help"
            up
            trigger={
              <>
                <Initials me={me} />
                <span className="who">
                  <strong>{me?.name || me?.username || "You"}</strong>
                  <span>{me?.role ? `${me.role[0]!.toUpperCase()}${me.role.slice(1)}` : ""}</span>
                </span>
              </>
            }
            items={[
              { label: "Settings", icon: "settings", onSelect: () => setSettings("account") },
              { label: "Take the tour", icon: "compass", onSelect: () => (current ? restartTour() : pages[0] && route.space ? (navigate(route.space, pages[0].path), setTimeout(restartTour, 600)) : restartTour()) },
              { label: "Keyboard shortcuts", icon: "keyboard", hint: "?", onSelect: () => setDialog("keys") },
              "sep",
              { label: "Sign out", icon: "logout", onSelect: () => void signOut() },
            ]}
          />
        </div>
      </aside>

      {current ? (
        <PageEditor key={current.id} pageId={current.id} canEdit={canEdit} space={space} onChanged={loadTree} />
      ) : (
        <Home me={me} space={space} spaces={spaces} pages={pages} canEdit={canEdit} canAdmin={canAdmin} onNewPage={() => setDialog("page")} onExplain={() => setDialog("explain")} onNewSpace={() => setDialog("space")} onSettings={(tab) => setSettings((tab as SettingsTab) ?? "account")} />
      )}

      {current && <Tour />}
      {settings && me && <Settings me={me} canAdmin={canAdmin} tab={settings} onTab={setSettings} onClose={() => setSettings(false)} onMe={setMe} />}
      {(dialog === "page" || dialog === "explain") && space && (
        <NewPageDialog
          space={space}
          initialMode={dialog === "explain" ? "repo" : "blank"}
          onClose={() => setDialog(undefined)}
          onCreate={createPage}
          onExplained={(path) => {
            setDialog(undefined);
            local.set(checklistFlag("page"), "1");
            loadTree();
            navigate(space.slug, path);
            toast("Your explainer draft is ready. Review it, then publish.");
          }}
        />
      )}
      {dialog === "space" && <NewSpaceDialog onClose={() => setDialog(undefined)} onCreate={createSpace} />}
      {dialog === "keys" && <ShortcutsDialog onClose={() => setDialog(undefined)} />}
      {palette && route.space && (
        <Palette
          space={route.space}
          pages={pages}
          onClose={() => setPalette(false)}
          onOpen={(s, p) => {
            setPalette(false);
            navigate(s, p);
          }}
        />
      )}
    </div>
  );
}
