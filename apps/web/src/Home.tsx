import { useEffect, useState } from "react";
import type { Me, Space, TreePage } from "./api";
import { navigate } from "./router";
import { CopyButton, Icon, useLocalFlag, type IconName } from "./ui";

/**
 * What you see with no page open: a greeting, a short getting-started list
 * for new people, and the pages in this space. Each checklist item is a real
 * action, ticked off when you do it (or by hand).
 */

export const checklistFlag = (id: string) => `gs-${id}`;

interface Props {
  me: Me | undefined;
  space: Space | undefined;
  spaces: Space[];
  pages: TreePage[];
  canEdit: boolean;
  canAdmin: boolean;
  onNewPage(): void;
  onNewSpace(): void;
  onSettings(tab?: string): void;
}

export function Home({ me, space, spaces, pages, canEdit, canAdmin, onNewPage, onNewSpace, onSettings }: Props) {
  const first = (me?.name ?? me?.username ?? "").split(" ")[0];
  const demo = spaces.find((s) => s.slug === "demo");
  const mcp = `claude mcp add --transport http elemnt ${location.origin}/mcp`;
  const recent = pages.slice(-6).reverse();

  return (
    <main className="editor-main home">
      <div className="home-inner">
        <header className="home-head">
          <p className="eyebrow">{space ? space.name : "Elemnt"}</p>
          <h1>{first ? `Welcome, ${first}` : "Welcome to Elemnt"}</h1>
          <p className="lede">Write docs once in Markdown. Readers get a designed page; Claude and other agents get clean Markdown.</p>
        </header>

        {canEdit && (
          <Checklist
            auto={{ page: pages.length > 0, publish: pages.some((p) => p.published) }}
            items={[
              { id: "page", icon: "page", title: "Create your first page", body: "Pick a title; you can move it later.", action: space ? { label: "New page", run: onNewPage } : canAdmin ? { label: "New space", run: onNewSpace } : undefined },
              { id: "preview", icon: "layout", title: "Write with the live preview", body: "Type on the left, see the finished page on the right. Start a line with / for rich components." },
              { id: "publish", icon: "globe", title: "Publish a page", body: "Drafts save as you type. Publish makes the page live for readers." },
              ...(canAdmin ? [{ id: "invite", icon: "team" as IconName, title: "Invite your team", body: "Send a link; choose whether they can edit or only read.", action: { label: "Invite people", run: () => onSettings("people") } }] : []),
              { id: "claude", icon: "sparkle", title: "Let Claude write with you", body: "Connect Claude Code or Claude chat. It drafts pages; you review and publish.", action: { label: "How to connect", run: () => onSettings("connect") } },
            ]}
          />
        )}

        <section className="home-grid">
          {demo && space?.slug !== "demo" && (
            <a className="tile" href="/app/demo/tour" onClick={(e) => (e.preventDefault(), navigate("demo", "tour"))}>
              <Icon name="compass" size={22} />
              <strong>Take the 5-minute tour</strong>
              <span>A sample page that shows what Elemnt can do.</span>
            </a>
          )}
          <div className="tile">
            <Icon name="sparkle" size={22} />
            <strong>Use Claude Code</strong>
            <span>Run this once, then ask Claude to write an Elemnt doc.</span>
            <code className="cmd">{mcp}</code>
            <CopyButton text={mcp} label="Copy command" />
          </div>
          <a className="tile" href="#" onClick={(e) => (e.preventDefault(), onSettings("style"))}>
            <Icon name="palette" size={22} />
            <strong>Pick your style</strong>
            <span>Choose colours and fonts for new pages. Claude uses it too.</span>
          </a>
        </section>

        {recent.length > 0 && space && (
          <section>
            <h2 className="section-title">Pages in {space.name}</h2>
            <ul className="page-cards">
              {recent.map((p) => (
                <li key={p.id}>
                  <a href={`/app/${space.slug}/${p.path}`} onClick={(e) => (e.preventDefault(), navigate(space.slug, p.path))}>
                    <strong>{p.title}</strong>
                    {p.summary && <span>{p.summary}</span>}
                    <em className={p.published ? (p.hasDraft ? "pill edited" : "pill live") : "pill draft"}>{p.published ? (p.hasDraft ? "Unpublished changes" : "Published") : "Draft"}</em>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!space && spaces.length === 0 && (
          <div className="empty-card">
            <p>There are no spaces yet. A space groups related pages, like "Engineering" or "Product docs".</p>
            {canAdmin && (
              <button type="button" className="btn primary" onClick={onNewSpace}>
                <Icon name="plus" size={16} /> Create a space
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function Checklist({ items, auto }: { auto: Record<string, boolean>; items: { id: string; icon: IconName; title: string; body: string; action?: { label: string; run(): void } | undefined }[] }) {
  const [hidden, hide] = useLocalFlag("gs-hidden");
  const [, rerender] = useState(0);
  useEffect(() => {
    const on = () => rerender((n) => n + 1);
    addEventListener("elemnt-local", on);
    return () => removeEventListener("elemnt-local", on);
  }, []);
  const done = items.map((it) => it.id).filter((id) => auto[id] || localStorageFlag(checklistFlag(id)));
  if (hidden) return null;
  return (
    <section className="checklist" aria-labelledby="gs-title">
      <header>
        <div>
          <h2 id="gs-title">Get started</h2>
          <p className="hint">
            {done.length} of {items.length} done
          </p>
        </div>
        <div className="progress" aria-hidden="true">
          <i style={{ width: `${(done.length / items.length) * 100}%` }} />
        </div>
        <button type="button" className="btn ghost small" onClick={hide}>
          Hide
        </button>
      </header>
      <ol>
        {items.map((it) => (
          <ChecklistItem key={it.id} {...it} auto={auto[it.id] ?? false} />
        ))}
      </ol>
    </section>
  );
}

function ChecklistItem({ id, icon, title, body, action, auto }: { auto: boolean; id: string; icon: IconName; title: string; body: string; action?: { label: string; run(): void } | undefined }) {
  const [flag, mark] = useLocalFlag(checklistFlag(id));
  const done = flag || auto;
  return (
    <li className={done ? "done" : undefined}>
      <button type="button" className="tick" aria-label={done ? `${title}: done` : `Mark "${title}" as done`} aria-pressed={done} onClick={mark}>
        {done ? <Icon name="check" size={14} /> : <Icon name={icon} size={16} />}
      </button>
      <div>
        <strong>{title}</strong>
        <span>{body}</span>
      </div>
      {action && !done && (
        <button type="button" className="btn small" onClick={action.run}>
          {action.label}
        </button>
      )}
    </li>
  );
}

function localStorageFlag(key: string) {
  try {
    return localStorage.getItem(`elemnt-${key}`) === "1";
  } catch {
    return false;
  }
}
