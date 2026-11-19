import { useEffect, useState } from "react";
import { api, type ApiError, type Space, type TreePage } from "./api";
import { Dialog, Icon, useToast } from "./ui";

interface MovePlan {
  from: { slug: string; name: string; visibility: Space["visibility"] };
  to: { slug: string; name: string; visibility: Space["visibility"] };
  moves: { id: string; title: string; from: string; to: string }[];
  conflicts: string[];
  locked: string[];
  sites: { slug: string; name: string; root: string | null }[];
}

const WHO: Record<Space["visibility"], string> = {
  public: "anyone with the link",
  workspace: "everyone in the workspace",
  private: "only the people added to it, plus owners",
};

const under = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

/** Pages of a space, for the "put it under" picker. */
function useTree(slug: string | undefined) {
  const [pages, setPages] = useState<TreePage[]>();
  useEffect(() => {
    setPages(undefined);
    if (slug) void api.get<{ pages: TreePage[] }>(`/api/spaces/${slug}/tree`).then((t) => setPages(t.pages), () => setPages([]));
  }, [slug]);
  return pages;
}

function ParentPicker({ pages, value, onChange, exclude, label = "Put it under" }: { pages: TreePage[] | undefined; value: string; onChange(v: string): void; exclude?: string; label?: string }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={!pages}>
        <option value="">The top level of the space</option>
        {(pages ?? [])
          .filter((p) => !exclude || !under(p.path, exclude))
          .map((p) => (
            <option key={p.id} value={p.path}>
              {"  ".repeat(p.path.split("/").length - 1)}
              {p.title} ({p.path})
            </option>
          ))}
      </select>
    </label>
  );
}

/** Move a page, and everything under it, to another space (or elsewhere in this one). */
export function MovePageDialog({ page, space, spaces, onClose, onMoved }: { page: { id: string; path: string; title: string }; space: Space; spaces: Space[]; onClose(): void; onMoved(space: string, path: string): void }) {
  const toast = useToast();
  const others = spaces.filter((s) => s.slug !== space.slug);
  const [target, setTarget] = useState(others[0]?.slug ?? space.slug);
  const [parent, setParent] = useState("");
  const [slug, setSlug] = useState(page.path.split("/").pop()!);
  const [plan, setPlan] = useState<MovePlan>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pages = useTree(target);
  const same = target === space.slug;

  useEffect(() => setParent(""), [target]);
  useEffect(() => {
    setPlan(undefined);
    setError(undefined);
    if (!slug) return;
    const q = new URLSearchParams({ space: target, slug, ...(parent ? { parent } : {}) });
    const timer = setTimeout(() => {
      api.get<MovePlan>(`/api/pages/${page.id}/move?${q}`).then(setPlan, (err: ApiError) => setError(err.message));
    }, 200);
    return () => clearTimeout(timer);
  }, [page.id, target, parent, slug]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ space: string; path: string; moved: number }>(`/api/pages/${page.id}/move`, { space: target, slug, ...(parent ? { parent } : {}) });
      toast(`Moved ${r.moved === 1 ? page.title : `${page.title} and ${r.moved - 1} sub-page${r.moved > 2 ? "s" : ""}`}. Old links redirect here.`);
      onMoved(r.space, r.path);
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  }

  const blocked = !plan || plan.conflicts.length > 0 || plan.locked.length > 0;
  const widens = plan && plan.from.visibility !== plan.to.visibility;
  return (
    <Dialog title={`Move ${page.title}`} onClose={onClose}>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <p className="hint">Its sub-pages, history, comments and suggestions come along. Links to the old address keep working.</p>
        <label>
          To space
          <select value={target} onChange={(e) => setTarget(e.target.value)} autoFocus>
            {[...others, space].map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
                {s.slug === space.slug ? " (this space)" : ""}
              </option>
            ))}
          </select>
        </label>
        <ParentPicker pages={pages} value={parent} onChange={setParent} {...(same ? { exclude: page.path } : {})} />
        <label>
          Address
          <div className="prefixed">
            <span>
              /{target}/{parent ? `${parent}/` : ""}
            </span>
            <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))} spellCheck={false} />
          </div>
        </label>

        {plan && (
          <div className="move-summary" role="status">
            <p>
              <Icon name="move" size={14} /> {plan.moves.length === 1 ? "1 page moves." : `${plan.moves.length} pages move: this one and ${plan.moves.length - 1} under it.`}
            </p>
            {widens && (
              <p className="callout-note">
                In {plan.to.name}, {WHO[plan.to.visibility]} can read {plan.moves.length === 1 ? "it" : "them"}. Today that's {WHO[plan.from.visibility]}.
              </p>
            )}
            {plan.sites.length > 0 && (
              <p className="callout-note">
                The website{plan.sites.length > 1 ? "s" : ""} {plan.sites.map((s) => s.name).join(", ")} show{plan.sites.length > 1 ? "" : "s"} {plan.from.name}'s docs, so {plan.moves.length === 1 ? "this page drops" : "these pages drop"} off {plan.sites.length > 1 ? "them" : "it"}. Repoint it in Websites if needed.
              </p>
            )}
            {plan.conflicts.length > 0 && (
              <p className="form-error">
                {plan.to.name} already has a page at {plan.conflicts.join(", ")}. Change the address or pick another parent.
              </p>
            )}
            {plan.locked.length > 0 && <p className="form-error">Someone is editing {plan.locked.join(", ")} right now. Try again when they're done.</p>}
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || blocked}>
            {busy ? "Moving…" : "Move"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Delete a space: its pages go to another space, or into the trash with it. */
export function DeleteSpaceDialog({ space, spaces, onClose, onDeleted }: { space: Space; spaces: Space[]; onClose(): void; onDeleted(): void }) {
  const toast = useToast();
  const others = spaces.filter((s) => s.slug !== space.slug);
  const [check, setCheck] = useState<{ pages: number; sites: { slug: string; name: string }[] }>();
  const [mode, setMode] = useState<"move" | "trash">(others.length ? "move" : "trash");
  const [target, setTarget] = useState(others[0]?.slug ?? "");
  const [parent, setParent] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pages = useTree(mode === "move" ? target : undefined);

  useEffect(() => {
    api.get<typeof check>(`/api/spaces/${space.slug}/delete-check`).then(setCheck, (err: ApiError) => setError(err.message));
  }, [space.slug]);
  useEffect(() => setParent(""), [target]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const move = mode === "move" && check?.pages;
      const r = await api.delJson<{ moved: number }>(`/api/spaces/${space.slug}`, { confirm, ...(move ? { pages: "move", moveTo: target, ...(parent ? { parent } : {}) } : { pages: "trash" }) });
      toast(`${space.name} is in the trash for 30 days${r.moved ? `; its ${r.moved} page${r.moved > 1 ? "s" : ""} moved` : ""}. Owners can restore it in Settings, Trash.`);
      onDeleted();
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  }

  const blockedBySite = Boolean(check?.sites.length);
  return (
    <Dialog title={`Delete ${space.name}`} onClose={onClose}>
      <form className="form" onSubmit={(e) => void submit(e)}>
        {!check ? (
          <p className="hint">{error ?? "Checking what's in it…"}</p>
        ) : blockedBySite ? (
          <p className="callout-note">
            The website{check.sites.length > 1 ? "s" : ""} {check.sites.map((s) => s.name).join(", ")} show{check.sites.length > 1 ? "" : "s"} this space's docs. Point {check.sites.length > 1 ? "them" : "it"} at another space in Websites first, then come back.
          </p>
        ) : (
          <>
            <p className="hint">The space goes to the trash. Owners can restore it from Settings for 30 days; after that it's gone for good.</p>
            {check.pages > 0 && (
              <fieldset className="choices">
                <legend>
                  Its {check.pages} page{check.pages > 1 ? "s" : ""}
                </legend>
                {others.length > 0 && (
                  <label className={`choice${mode === "move" ? " on" : ""}`}>
                    <input type="radio" name="pages" checked={mode === "move"} onChange={() => setMode("move")} />
                    <Icon name="move" />
                    <span>
                      <strong>Move them to another space</strong>
                      <span className="hint">With their history and comments. Old links redirect.</span>
                    </span>
                  </label>
                )}
                <label className={`choice${mode === "trash" ? " on" : ""}`}>
                  <input type="radio" name="pages" checked={mode === "trash"} onChange={() => setMode("trash")} />
                  <Icon name="trash" />
                  <span>
                    <strong>Delete them with the space</strong>
                    <span className="hint">They come back if you restore the space.</span>
                  </span>
                </label>
              </fieldset>
            )}
            {check.pages > 0 && mode === "move" && (
              <>
                <label>
                  Move to
                  <select value={target} onChange={(e) => setTarget(e.target.value)}>
                    {others.map((s) => (
                      <option key={s.slug} value={s.slug}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <ParentPicker pages={pages} value={parent} onChange={setParent} label="Under" />
              </>
            )}
            <label>
              <span>
                Type <strong>{space.name}</strong> to confirm
              </span>
              <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} />
            </label>
          </>
        )}
        {error && check && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn danger" disabled={busy || !check || blockedBySite || confirm.trim() !== space.name.trim() || (mode === "move" && Boolean(check.pages) && !target)}>
            <Icon name="trash" size={14} /> {busy ? "Deleting…" : "Delete space"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

interface Trashed {
  id: string;
  slug: string;
  name: string;
  visibility: Space["visibility"];
  pages: number;
  deletedAt: string;
  purgeAt: string;
}

const days = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));

/** Settings, Trash: deleted spaces, restorable for 30 days. Owners only. */
export function TrashSection({ onRestored }: { onRestored?(): void }) {
  const toast = useToast();
  const [items, setItems] = useState<Trashed[]>();
  const [sure, setSure] = useState<string>();
  const load = () => void api.get<{ spaces: Trashed[] }>("/api/trash").then((r) => setItems(r.spaces));
  useEffect(load, []);

  async function run(work: Promise<unknown>, done: string) {
    try {
      await work;
      toast(done);
      onRestored?.();
    } catch (err) {
      toast((err as ApiError).message, "error");
    }
    setSure(undefined);
    load();
  }

  return (
    <>
      <h2>Trash</h2>
      <p className="hint">Deleted spaces stay here for 30 days with all their pages, history and members, then they're deleted for good.</p>
      {!items ? (
        <p className="hint">Loading…</p>
      ) : !items.length ? (
        <p className="hint">The trash is empty.</p>
      ) : (
        <ul className="invite-list">
          {items.map((s) => (
            <li key={s.id}>
              <span>
                <strong>{s.name}</strong>{" "}
                <span className="hint">
                  {s.pages} page{s.pages === 1 ? "" : "s"} · deleted for good in {days(s.purgeAt)} day{days(s.purgeAt) === 1 ? "" : "s"}
                </span>
              </span>
              <span className="row-actions">
                <button type="button" className="btn small" onClick={() => void run(api.post(`/api/trash/${s.id}/restore`), `Restored ${s.name}.`)}>
                  <Icon name="undo" size={14} /> Restore
                </button>
                {sure === s.id ? (
                  <button type="button" className="btn small danger" onClick={() => void run(api.del(`/api/trash/${s.id}`), `${s.name} is deleted for good.`)}>
                    Really delete?
                  </button>
                ) : (
                  <button type="button" className="btn small ghost danger" onClick={() => setSure(s.id)}>
                    Delete now
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** "Let Claude publish": one switch for a space's pages, Claude's suggestions and the websites that show it. */
export function ClaudePublishDialog({ space, onClose, onSaved }: { space: Space; onClose(): void; onSaved(): void }) {
  const toast = useToast();
  const [on, setOn] = useState(Boolean(space.agentPublish));
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/api/spaces/${space.slug}`, { agentPublish: on });
      toast(on ? `Claude can now publish in ${space.name}.` : `Claude's changes in ${space.name} wait for review again.`);
      onSaved();
      onClose();
    } catch (err) {
      toast((err as ApiError).message, "error");
      setBusy(false);
    }
  }
  return (
    <Dialog title={`Claude in ${space.name}`} onClose={onClose}>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <label className="row">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> Let Claude publish in this space
        </label>
        <p className="hint">When it's on, Claude can, over MCP:</p>
        <ul className="hint">
          <li>publish new pages it writes, and its own drafts</li>
          <li>apply and publish its own suggested edits</li>
          <li>publish the websites that show this space</li>
        </ul>
        <p className="hint">
          Claude never publishes over a person's unpublished draft, and can't accept anyone else's suggestions. Every publish is a revision (or a site release) you can restore. When it's off, everything Claude writes waits for your review.
        </p>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || on === Boolean(space.agentPublish)}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
