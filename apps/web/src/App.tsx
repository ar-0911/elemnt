import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Me, type Space, type TreePage } from "./api";
import { PageEditor } from "./PageEditor";
import { Palette } from "./Palette";
import { Settings } from "./Settings";
import { navigate, useRoute } from "./router";

const NEW_PAGE = (title: string) => `---
title: ${title}
summary: One line on what this page explains.
---

Start with why this matters.

:::callout{type=tip}
Type / at the start of a line to insert a component.
:::
`;

function Tree({ pages, space, current }: { pages: TreePage[]; space: string; current: string | undefined }) {
  return (
    <ul className="tree">
      {pages.map((p) => (
        <li key={p.id} style={{ paddingLeft: `${(p.path.split("/").length - 1) * 14}px` }}>
          <a
            href={`/app/${space}/${p.path}`}
            aria-current={p.path === current ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              navigate(space, p.path);
            }}
          >
            {p.title}
            {!p.published ? <span className="dot draft" title="Not published yet" /> : p.hasDraft ? <span className="dot edited" title="Has unpublished changes" /> : null}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function App() {
  const route = useRoute();
  const [me, setMe] = useState<Me>();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [pages, setPages] = useState<TreePage[]>([]);
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api
      .get<Me>("/api/me")
      .then(setMe)
      .catch((e: ApiError) => {
        if (e.status === 401) location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
        else setError(e.message);
      });
    void api.get<Space[]>("/api/spaces").then((s) => {
      setSpaces(s);
      if (!parseSpace() && s[0]) navigate(s[0].slug);
    });
  }, []);

  const loadTree = useCallback(() => {
    if (route.space) void api.get<{ pages: TreePage[] }>(`/api/spaces/${route.space}/tree`).then((t) => setPages(t.pages));
  }, [route.space]);
  useEffect(loadTree, [loadTree]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const canEdit = me?.role === "owner" || me?.role === "admin" || me?.role === "editor";
  const canAdmin = me?.role === "owner" || me?.role === "admin";
  const current = pages.find((p) => p.path === route.path);

  async function newPage() {
    const path = prompt("Path for the new page (e.g. guides/deploy)")?.trim().toLowerCase();
    if (!path || !route.space) return;
    const title = path.split("/").pop()!.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
    try {
      await api.post(`/api/spaces/${route.space}/pages`, { path, source: NEW_PAGE(title), draft: true });
      loadTree();
      navigate(route.space, path);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function newSpace() {
    const name = prompt("Name of the new space")?.trim();
    if (!name) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const visibility = confirm("Make this space public? Anyone with the link can read published pages.") ? "public" : "workspace";
    try {
      await api.post("/api/spaces", { slug, name, visibility });
      setSpaces(await api.get<Space[]>("/api/spaces"));
      navigate(slug);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Elemnt</div>
        <label className="sr" htmlFor="space">Space</label>
        <select id="space" value={route.space ?? ""} onChange={(e) => navigate(e.target.value)}>
          {spaces.map((s) => (
            <option key={s.id} value={s.slug}>
              {s.name} {s.visibility === "public" ? "(public)" : ""}
            </option>
          ))}
        </select>
        <button type="button" className="search-btn" onClick={() => setPalette(true)}>
          Search <kbd>⌘K</kbd>
        </button>
        {route.space && <Tree pages={pages} space={route.space} current={route.path} />}
        <div className="side-actions">
          {canEdit && route.space && (
            <button type="button" className="btn" onClick={() => void newPage()}>
              New page
            </button>
          )}
          {canAdmin && (
            <button type="button" className="btn ghost" onClick={() => void newSpace()}>
              New space
            </button>
          )}
          {canAdmin && (
            <button type="button" className="btn ghost" onClick={() => setSettings(true)}>
              Settings
            </button>
          )}
        </div>
        <div className="me">{me?.email}</div>
      </aside>
      {error && (
        <p className="toast" role="alert" onClick={() => setError(undefined)}>
          {error}
        </p>
      )}
      {current ? (
        <PageEditor key={current.id} pageId={current.id} canEdit={canEdit} onChanged={loadTree} />
      ) : (
        <main className="editor-main empty">
          {spaces.length === 0 ? <p>No spaces yet.{canAdmin ? " Create one to start writing." : ""}</p> : <p>Pick a page, or create a new one.</p>}
        </main>
      )}
      {settings && <Settings onClose={() => setSettings(false)} />}
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

function parseSpace() {
  return location.pathname.replace(/^\/app\/?/, "").split("/")[0];
}
