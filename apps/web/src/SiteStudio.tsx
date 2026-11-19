import { structuredPatch } from "diff";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type Space } from "./api";
import { CodeEditor } from "./CodeEditor";
import { Dialog, Icon, useToast } from "./ui";

/**
 * Project websites: the list (/app/sites) and the studio (/app/sites/:slug).
 * The studio edits the site's design files, previews the draft in a frame,
 * reviews Claude's change sets, and publishes or rolls back.
 */

interface SiteSummary {
  slug: string;
  name: string;
  url: string | null;
  spaceId: string | null;
  hostname: string | null;
  repo: string | null;
  published: boolean;
  publishedAt: string | null;
  unpublishedChanges: boolean;
  visibility: "public" | "members";
  agentPublish: boolean;
}
interface SiteFile {
  path: string;
  size: number;
  encoding: "utf8" | "base64";
}
interface ChangesetSummary {
  id: string;
  summary: string;
  source: string;
  createdAt: string;
  files: string[];
}
interface SiteDetail extends SiteSummary {
  files: SiteFile[];
  changesets: ChangesetSummary[];
}
interface Diagnostic {
  file?: string;
  route?: string;
  message: string;
}
interface ReviewFile {
  path: string;
  content: string | null;
  current: string | null;
  binary: boolean;
  conflict: boolean;
}

export function siteNavigate(slug?: string, query = "") {
  history.pushState(null, "", `/app/sites${slug ? `/${slug}` : ""}${query}`);
  dispatchEvent(new PopStateEvent("popstate"));
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);

export function SitesHome({ canEdit, spaces, slug }: { canEdit: boolean; spaces: Space[]; slug: string | undefined }) {
  if (slug) return <SiteStudio key={slug} slug={slug} canEdit={canEdit} spaces={spaces} />;
  return <SiteList canEdit={canEdit} spaces={spaces} />;
}

function SiteList({ canEdit, spaces }: { canEdit: boolean; spaces: Space[] }) {
  const [sites, setSites] = useState<SiteSummary[]>();
  const [domain, setDomain] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    void api.get<{ sites: SiteSummary[]; domain: string | null }>("/api/sites").then((r) => {
      setSites(r.sites);
      setDomain(r.domain);
    });
  }, []);
  return (
    <main className="home sites-home">
      <header className="home-head">
        <div>
          <h1>Websites</h1>
          <p className="hint">Each project gets its own designed website: your layout, nav, 3D and motion, with the project's docs inside. Claude can design it from the repo.</p>
        </div>
        {canEdit && (
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} /> New website
          </button>
        )}
      </header>
      {!domain && <p className="callout-note">Sites need a domain: set ELEMNT_SITES_DOMAIN on the server (e.g. example.com gives elemnt.example.com) and point *.example.com at it.</p>}
      <div className="site-cards">
        {sites?.map((s) => (
          <a key={s.slug} className="site-card" href={`/app/sites/${s.slug}`} onClick={(e) => (e.preventDefault(), siteNavigate(s.slug))}>
            <span className="site-card-art" aria-hidden="true" />
            <strong>{s.name}</strong>
            <span className="hint">{s.hostname ?? s.url?.replace(/^https?:\/\//, "") ?? s.slug}</span>
            <span>{s.published ? <span className="pill live">Live</span> : <span className="pill">Not published</span>}{s.published && s.unpublishedChanges && <span className="pill edited">Changes</span>}</span>
          </a>
        ))}
        {sites && !sites.length && <p className="hint">No websites yet.</p>}
      </div>
      {creating && <NewSiteDialog spaces={spaces} domain={domain} onClose={() => setCreating(false)} />}
    </main>
  );
}

function AccessField({ value, onChange, privateSpace }: { value: "public" | "members"; onChange(v: "public" | "members"): void; privateSpace: boolean }) {
  return (
    <label>
      Who can open it
      <select value={privateSpace ? "members" : value} onChange={(e) => onChange(e.target.value as "public" | "members")} disabled={privateSpace}>
        <option value="public">Anyone with the link</option>
        <option value="members">Only people in its docs space (sign in with Elemnt)</option>
      </select>
      {privateSpace && <span className="hint">The docs space is private, so the site is too.</span>}
    </label>
  );
}

function NewSiteDialog({ spaces, domain, onClose }: { spaces: Space[]; domain: string | null; onClose(): void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [space, setSpace] = useState(spaces[0]?.slug ?? "");
  const [repo, setRepo] = useState("");
  const [tagline, setTagline] = useState("");
  const [visibility, setVisibility] = useState<"public" | "members">("public");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const privateSpace = spaces.find((x) => x.slug === space)?.visibility === "private";
  const toast = useToast();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/api/sites", { slug: slug || slugify(name), name, visibility: privateSpace ? "members" : visibility, ...(space ? { space } : {}), ...(repo ? { repo } : {}), ...(tagline ? { tagline } : {}) });
      toast("Website created from the starter design. Restyle it here or ask Claude.");
      siteNavigate(slug || slugify(name));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <Dialog title="New website" onClose={onClose}>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <label>
          Name
          <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Spelunk" />
        </label>
        <label>
          Address
          <span className="input-affix">
            <input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} placeholder={slugify(name) || "spelunk"} />
            <span>.{domain ?? "your-domain"}</span>
          </span>
        </label>
        <label>
          Docs come from
          <select value={space} onChange={(e) => setSpace(e.target.value)}>
            <option value="">No docs yet</option>
            {spaces.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <AccessField value={visibility} onChange={setVisibility} privateSpace={privateSpace} />
        <label>
          GitHub repo <span className="hint">(optional)</span>
          <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/name" />
        </label>
        <label>
          Tagline <span className="hint">(optional)</span>
          <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="One line on what it is" />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
            Create website
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function groupFiles(files: SiteFile[]) {
  const groups = new Map<string, SiteFile[]>();
  for (const f of files) {
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.indexOf("/")) : "";
    groups.set(dir, [...(groups.get(dir) ?? []), f]);
  }
  return [...groups.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
}

function SiteStudio({ slug, canEdit, spaces }: { slug: string; canEdit: boolean; spaces: Space[] }) {
  const toast = useToast();
  const [site, setSite] = useState<SiteDetail>();
  const [open, setOpen] = useState("pages/index.html");
  const [text, setText] = useState<{ path: string; value: string; saved: string; binary: boolean; version: number }>();
  const [preview, setPreview] = useState<{ url: string | null; diagnostics: Diagnostic[] }>();
  const [busy, setBusy] = useState<string>();
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [review, setReview] = useState<string | undefined>(() => new URLSearchParams(location.search).get("changeset") ?? undefined);
  const [dialog, setDialog] = useState<"settings" | "generate" | "new-file" | "releases">();
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);

  const load = useCallback(async () => {
    const s = await api.get<SiteDetail>(`/api/sites/${slug}`);
    setSite(s);
    return s;
  }, [slug]);

  const openFile = useCallback(
    async (path: string) => {
      setOpen(path);
      const f = await api.get<{ content: string; encoding: string }>(`/api/sites/${slug}/files/${path.split("/").map(encodeURIComponent).join("/")}`);
      setText((t) => ({ path, value: f.content, saved: f.content, binary: f.encoding === "base64", version: (t?.version ?? 0) + 1 }));
    },
    [slug],
  );

  const refreshPreview = useCallback(async () => {
    if (!canEdit) return;
    setBusy("preview");
    try {
      const p = await api.post<{ url: string | null; diagnostics: Diagnostic[] }>(`/api/sites/${slug}/preview`);
      setPreview(p);
      setDiagnostics(p.diagnostics);
    } finally {
      setBusy(undefined);
    }
  }, [slug, canEdit]);

  useEffect(() => {
    void load().then((s) => {
      const first = s.files.find((f) => f.path === "pages/index.html") ?? s.files.find((f) => f.encoding === "utf8");
      if (first) void openFile(first.path);
    });
    void refreshPreview();
  }, [load, openFile, refreshPreview]);

  const dirty = text && text.value !== text.saved;

  async function save() {
    if (!text || text.binary || text.value === text.saved) return;
    setBusy("save");
    try {
      await api.put(`/api/sites/${slug}/files`, { files: [{ path: text.path, content: text.value }] });
      setText({ ...text, saved: text.value });
      await load();
      await refreshPreview();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(undefined);
    }
  }

  async function publish(force = false) {
    setBusy("publish");
    try {
      if (dirty) await save();
      await api.post(`/api/sites/${slug}/publish`, force ? { force: true } : {});
      await load();
      toast("Published. The site is live.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setDiagnostics((err.details.diagnostics as Diagnostic[]) ?? []);
        if (confirm(`${err.message}\n\nPublish anyway?`)) return publish(true);
      } else toast((err as Error).message, "error");
    } finally {
      setBusy(undefined);
    }
  }

  async function addFile(path: string) {
    await api.put(`/api/sites/${slug}/files`, { files: [{ path, content: path.endsWith(".json") ? "{}\n" : "" }] });
    await load();
    await openFile(path);
    setDialog(undefined);
  }

  async function deleteFile(path: string) {
    if (!confirm(`Delete ${path}?`)) return;
    await api.put(`/api/sites/${slug}/files`, { files: [{ path, content: null }] });
    const s = await load();
    if (open === path) {
      const next = s.files.find((f) => f.encoding === "utf8");
      if (next) void openFile(next.path);
    }
    void refreshPreview();
  }

  const groups = useMemo(() => groupFiles(site?.files ?? []), [site]);
  if (!site) return <main className="studio loading">Loading…</main>;
  const liveUrl = site.hostname ? `https://${site.hostname}` : site.url;

  return (
    <main className="studio">
      <header className="studio-head">
        <button type="button" className="icon-btn" aria-label="All websites" title="All websites" onClick={() => siteNavigate()}>
          ←
        </button>
        <div className="studio-title">
          <h1>{site.name}</h1>
          <span className="hint">
            {liveUrl && site.published ? (
              <a href={liveUrl} target="_blank" rel="noopener">
                {liveUrl.replace(/^https?:\/\//, "")} <Icon name="external" size={12} />
              </a>
            ) : (
              (liveUrl?.replace(/^https?:\/\//, "") ?? "no address")
            )}
            {site.published ? <span className="pill live">Live</span> : <span className="pill">Not published</span>}
            {site.published && site.unpublishedChanges && <span className="pill edited">Unpublished changes</span>}
          </span>
        </div>
        <span className="spacer" />
        {canEdit && (
          <>
            <button type="button" className="btn" onClick={() => setDialog("generate")}>
              <Icon name="sparkle" size={15} /> Design with Claude
            </button>
            <button type="button" className="btn ghost" onClick={() => setDialog("releases")}>
              <Icon name="history" size={15} /> Releases
            </button>
            <button type="button" className="btn ghost" onClick={() => setDialog("settings")}>
              <Icon name="settings" size={15} /> Settings
            </button>
            <button type="button" className="btn primary" disabled={busy === "publish"} onClick={() => void publish()}>
              {busy === "publish" ? "Publishing…" : "Publish"}
            </button>
          </>
        )}
      </header>

      <div className="studio-body">
        <nav className="studio-files" aria-label="Site files">
          {site.changesets.length > 0 && (
            <div className="studio-changesets">
              <div className="side-label">From Claude</div>
              {site.changesets.map((c) => (
                <button key={c.id} type="button" className={`changeset-item${review === c.id ? " on" : ""}`} onClick={() => setReview(c.id)}>
                  <Icon name="review" size={14} />
                  <span>
                    <strong>{c.summary}</strong>
                    <span className="hint">
                      {c.files.length} file{c.files.length === 1 ? "" : "s"} · {new Date(c.createdAt).toLocaleString()}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="side-label">
            Files
            {canEdit && (
              <button type="button" className="icon-btn small" aria-label="New file" title="New file" onClick={() => setDialog("new-file")}>
                <Icon name="plus" size={14} />
              </button>
            )}
          </div>
          {groups.map(([dir, files]) => (
            <div key={dir || "root"} className="file-group">
              {dir && <div className="file-dir">{dir}/</div>}
              {files.map((f) => (
                <div key={f.path} className={`file-row${open === f.path ? " on" : ""}`}>
                  <button type="button" onClick={() => (f.encoding === "utf8" ? void openFile(f.path) : setOpen(f.path))} title={f.path}>
                    {dir ? f.path.slice(dir.length + 1) : f.path}
                  </button>
                  {canEdit && f.path !== "site.json" && (
                    <button type="button" className="icon-btn small file-del" aria-label={`Delete ${f.path}`} onClick={() => void deleteFile(f.path)}>
                      <Icon name="close" size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </nav>

        <section className="studio-editor" aria-label="Editor">
          <div className="studio-bar">
            <code>{open}</code>
            {dirty && <span className="pill edited">Unsaved</span>}
            <span className="spacer" />
            {canEdit && (
              <button type="button" className="btn small" disabled={!dirty || busy === "save"} onClick={() => void save()}>
                Save <kbd>⌘S</kbd>
              </button>
            )}
          </div>
          {text && text.path === open && !text.binary ? (
            <CodeEditor key={`${text.path}:${text.version}`} path={text.path} value={text.value} readOnly={!canEdit} onChange={(v) => setText((t) => (t ? { ...t, value: v } : t))} onSave={() => void save()} />
          ) : (
            <p className="hint pad">{open} is a binary file.</p>
          )}
          {diagnostics.length > 0 && (
            <div className="studio-problems" role="status">
              <strong>
                {diagnostics.length} problem{diagnostics.length === 1 ? "" : "s"}
              </strong>
              <ul>
                {diagnostics.slice(0, 8).map((d, i) => (
                  <li key={i}>
                    {d.file ? (
                      <button type="button" className="link" onClick={() => void openFile(d.file!)}>
                        {d.file}
                      </button>
                    ) : (
                      <code>{d.route}</code>
                    )}
                    : {d.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="studio-preview" aria-label="Preview">
          <div className="studio-bar">
            <div className="seg small">
              <button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}>
                Desktop
              </button>
              <button type="button" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}>
                Phone
              </button>
            </div>
            <span className="spacer" />
            {preview?.url && (
              <a className="btn small ghost" href={preview.url} target="_blank" rel="noopener">
                Open <Icon name="external" size={12} />
              </a>
            )}
            {canEdit && (
              <button type="button" className="btn small" disabled={busy === "preview"} onClick={() => void refreshPreview()}>
                {busy === "preview" ? "Building…" : "Refresh"}
              </button>
            )}
          </div>
          <div className={`preview-stage ${device}`}>
            {preview?.url ? <iframe key={preview.url} src={preview.url} title="Site preview" /> : <p className="hint pad">{canEdit ? "Building a preview…" : "Previews are for editors."}</p>}
          </div>
        </section>
      </div>

      {review && (
        <ChangesetReview
          slug={slug}
          id={review}
          canEdit={canEdit}
          onClose={() => {
            setReview(undefined);
            history.replaceState(null, "", location.pathname);
          }}
          onDone={async (applied) => {
            setReview(undefined);
            history.replaceState(null, "", location.pathname);
            await load();
            if (applied) {
              await openFile(open);
              await refreshPreview();
              toast("Applied to the draft. Publish when you're happy.");
            }
          }}
        />
      )}
      {dialog === "new-file" && <NewFileDialog onClose={() => setDialog(undefined)} onCreate={addFile} />}
      {dialog === "settings" && <SiteSettingsDialog site={site} spaces={spaces} onClose={() => setDialog(undefined)} onSaved={() => void load()} />}
      {dialog === "generate" && <GenerateDialog site={site} onClose={() => setDialog(undefined)} onDone={(id) => (setDialog(undefined), void load(), setReview(id))} />}
      {dialog === "releases" && <ReleasesDialog slug={slug} onClose={() => setDialog(undefined)} onRolledBack={() => (setDialog(undefined), void load(), void openFile(open), void refreshPreview())} />}
    </main>
  );
}

function NewFileDialog({ onClose, onCreate }: { onClose(): void; onCreate(path: string): Promise<void> }) {
  const [path, setPath] = useState("pages/");
  const [error, setError] = useState<string>();
  return (
    <Dialog title="New file" onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          onCreate(path.trim()).catch((err: Error) => setError(err.message));
        }}
      >
        <p className="hint">pages/about.html is /about. Layouts and partials are .liquid; scripts and styles are served as they are.</p>
        <label>
          Path
          <input autoFocus value={path} onChange={(e) => setPath(e.target.value)} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary">Create</button>
        </div>
      </form>
    </Dialog>
  );
}

function SiteSettingsDialog({ site, spaces, onClose, onSaved }: { site: SiteDetail; spaces: Space[]; onClose(): void; onSaved(): void }) {
  const [name, setName] = useState(site.name);
  const [space, setSpace] = useState(spaces.find((s) => s.id === site.spaceId)?.slug ?? "");
  const [hostname, setHostname] = useState(site.hostname ?? "");
  const [repo, setRepo] = useState(site.repo ?? "");
  const [visibility, setVisibility] = useState(site.visibility);
  const [agentPublish, setAgentPublish] = useState(site.agentPublish);
  const [error, setError] = useState<string>();
  const privateSpace = spaces.find((x) => x.slug === space)?.visibility === "private";
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const access = { ...(privateSpace || visibility !== site.visibility ? { visibility: privateSpace ? "members" : visibility } : {}), ...(agentPublish !== site.agentPublish ? { agentPublish } : {}) };
      await api.patch(`/api/sites/${site.slug}`, { name, space: space || null, hostname: hostname || null, repo: repo || null, ...access });
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Dialog title="Website settings" onClose={onClose}>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Docs come from
          <select value={space} onChange={(e) => setSpace(e.target.value)}>
            <option value="">No docs</option>
            {spaces.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          GitHub repo
          <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/name" />
        </label>
        <label>
          Custom hostname <span className="hint">(optional)</span>
          <input value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="www.example.com" />
          <span className="hint">Point a CNAME at this server first. Leave empty to use {site.url?.replace(/^https?:\/\//, "")}.</span>
        </label>
        <AccessField value={visibility} onChange={setVisibility} privateSpace={privateSpace} />
        <label className="row">
          <input type="checkbox" checked={agentPublish} onChange={(e) => setAgentPublish(e.target.checked)} /> Let Claude publish changes
        </label>
        <span className="hint">When on, Claude can put its site changes live over MCP without waiting for you. Every publish is kept under Releases, so you can roll back. Docs pages still need your OK.</span>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary">Save</button>
        </div>
      </form>
    </Dialog>
  );
}

const STAGES = ["Reading the repo", "Designing the layout and 3D scene", "Writing the docs", "Building a preview"];

function GenerateDialog({ site, onClose, onDone }: { site: SiteDetail; onClose(): void; onDone(changeset: string): void }) {
  const [repo, setRepo] = useState(site.repo ?? "");
  const [brief, setBrief] = useState("");
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string>();
  async function start(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setRunning(true);
    try {
      const { id } = await api.post<{ id: string }>(`/api/sites/${site.slug}/generate`, { ...(repo ? { repo } : {}), ...(brief ? { brief } : {}) });
      const tick = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 20_000);
      for (;;) {
        await new Promise((r) => setTimeout(r, 3000));
        const job = await api.get<{ status: string; error?: string; result?: { changeset: string } }>(`/api/sites/${site.slug}/generate/${id}`);
        if (job.status === "done") {
          clearInterval(tick);
          onDone(job.result!.changeset);
          return;
        }
        if (job.status === "failed") {
          clearInterval(tick);
          throw new Error(job.error ?? "Claude couldn't design the site.");
        }
      }
    } catch (err) {
      setError((err as Error).message);
      setRunning(false);
    }
  }
  return (
    <Dialog title="Design with Claude" onClose={onClose}>
      <form className="form" onSubmit={(e) => void start(e)}>
        <p className="hint">Claude reads the repo and designs the whole site: layouts, a home page with a 3D scene about the project, motion, and docs drafts. You review every file before anything changes.</p>
        <label>
          GitHub repo
          <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/name" required disabled={running} />
        </label>
        <label>
          What should it feel like? <span className="hint">(optional)</span>
          <textarea rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} disabled={running} placeholder="e.g. Dark, cave-like, amber and teal. The 3D should be a dependency graph you can fly through." />
        </label>
        {running && (
          <div className="progress-note">
            <span className="spinner" />
            <div>
              <strong>{STAGES[stage]}…</strong>
              <span className="hint">This takes a few minutes. You can keep this open.</span>
            </div>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn primary" disabled={running}>
            Design it
          </button>
        </div>
        <p className="hint">Prefer Claude Code? Use the Elemnt connector's design_site prompt.</p>
      </form>
    </Dialog>
  );
}

function ReleasesDialog({ slug, onClose, onRolledBack }: { slug: string; onClose(): void; onRolledBack(): void }) {
  const [list, setList] = useState<{ id: string; createdAt: string }[]>();
  const toast = useToast();
  useEffect(() => {
    void api.get<{ releases: { id: string; createdAt: string }[] }>(`/api/sites/${slug}/releases`).then((r) => setList(r.releases));
  }, [slug]);
  async function rollback(id: string) {
    if (!confirm("Publish this release again? The draft is reset to it too.")) return;
    await api.post(`/api/sites/${slug}/publish`, { release: id, force: true });
    toast("Rolled back.");
    onRolledBack();
  }
  return (
    <Dialog title="Releases" onClose={onClose}>
      {!list ? (
        <p className="hint">Loading…</p>
      ) : !list.length ? (
        <p className="hint">Nothing published yet.</p>
      ) : (
        <ul className="release-list">
          {list.map((r, i) => (
            <li key={r.id}>
              <span>
                {new Date(r.createdAt).toLocaleString()} {i === 0 && <span className="pill live">Current</span>}
              </span>
              {i > 0 && (
                <button type="button" className="btn small" onClick={() => void rollback(r.id)}>
                  Roll back to this
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function FileDiff({ before, after }: { before: string; after: string }) {
  const patch = structuredPatch("a", "b", before, after, "", "", { context: 3 });
  if (!patch.hunks.length) return <p className="hint pad">No changes.</p>;
  return (
    <pre className="file-diff">
      {patch.hunks.map((h, i) => (
        <span key={i}>
          <span className="diff-hunk">{`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n`}</span>
          {h.lines.map((l, j) => (
            <span key={j} className={l[0] === "+" ? "diff-add" : l[0] === "-" ? "diff-del" : undefined}>
              {l}
              {"\n"}
            </span>
          ))}
        </span>
      ))}
    </pre>
  );
}

function ChangesetReview({ slug, id, canEdit, onClose, onDone }: { slug: string; id: string; canEdit: boolean; onClose(): void; onDone(applied: boolean): Promise<void> }) {
  const [cs, setCs] = useState<{ summary: string; status: string; source: string; files: ReviewFile[] }>();
  const [preview, setPreview] = useState<{ url: string | null; diagnostics: Diagnostic[] }>();
  const [error, setError] = useState<string>();
  const toast = useToast();
  useEffect(() => {
    void api.get<{ summary: string; status: string; source: string; files: ReviewFile[] }>(`/api/sites/${slug}/changesets/${id}`).then(setCs).catch((e: Error) => setError(e.message));
    if (canEdit) void api.post<{ url: string | null; diagnostics: Diagnostic[] }>(`/api/sites/${slug}/changesets/${id}/preview`).then(setPreview);
  }, [slug, id, canEdit]);
  const conflicts = cs?.files.filter((f) => f.conflict) ?? [];
  async function apply(force: boolean) {
    try {
      await api.post(`/api/sites/${slug}/changesets/${id}/apply`, force ? { force: true } : {});
      await onDone(true);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }
  async function dismiss() {
    await api.post(`/api/sites/${slug}/changesets/${id}/dismiss`);
    await onDone(false);
  }
  return (
    <Dialog
      title={cs ? `Review: ${cs.summary}` : "Review changes"}
      onClose={onClose}
      wide
      footer={
        canEdit && cs?.status === "open" ? (
          <>
            {preview?.url && (
              <a className="btn ghost" href={preview.url} target="_blank" rel="noopener">
                Preview with these changes <Icon name="external" size={12} />
              </a>
            )}
            <span className="spacer" />
            <button type="button" className="btn danger" onClick={() => void dismiss()}>
              Dismiss
            </button>
            <button type="button" className="btn primary" onClick={() => void apply(conflicts.length > 0)}>
              {conflicts.length ? "Apply anyway" : "Apply to draft"}
            </button>
          </>
        ) : undefined
      }
    >
      {error && <p className="form-error">{error}</p>}
      {!cs ? (
        <p className="hint">Loading…</p>
      ) : (
        <div className="changeset-review">
          {cs.status !== "open" && <p className="hint">This change set was {cs.status}.</p>}
          {conflicts.length > 0 && <p className="form-error">These files changed since Claude read them, so applying overwrites those edits: {conflicts.map((f) => f.path).join(", ")}.</p>}
          {preview && preview.diagnostics.length > 0 && (
            <p className="form-error">
              {preview.diagnostics.length} problem{preview.diagnostics.length === 1 ? "" : "s"} with these changes: {preview.diagnostics.slice(0, 3).map((d) => `${d.file ?? d.route}: ${d.message}`).join("; ")}
            </p>
          )}
          {cs.files.map((f) => (
            <details key={f.path} open={cs.files.length <= 4}>
              <summary>
                <code>{f.path}</code> {f.content === null ? <span className="pill">Deleted</span> : f.current === "" ? <span className="pill live">New</span> : <span className="pill edited">Changed</span>}
                {f.conflict && <span className="pill">Conflict</span>}
              </summary>
              {f.binary ? <p className="hint pad">Binary file.</p> : <FileDiff before={f.current ?? ""} after={f.content ?? ""} />}
            </details>
          ))}
        </div>
      )}
    </Dialog>
  );
}
