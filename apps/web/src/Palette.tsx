import { useEffect, useRef, useState } from "react";
import { api, type SearchHit, type TreePage } from "./api";

interface Props {
  space: string;
  pages: TreePage[];
  onOpen(space: string, path: string): void;
  onClose(): void;
}

/** ⌘K: jump to a page by title, or full-text search across spaces. */
export function Palette({ space, pages, onOpen, onClose }: Props) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const t = setTimeout(() => void api.get<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`).then(setHits), 150);
    return () => clearTimeout(t);
  }, [q]);

  const titleMatches = pages
    .filter((p) => p.title.toLowerCase().includes(q.toLowerCase()) || p.path.includes(q.toLowerCase()))
    .slice(0, 6)
    .map((p) => ({ key: `t:${p.id}`, space, path: p.path, title: p.title, sub: p.path, snippetHtml: "" }));
  const searchMatches = hits
    .filter((h) => !(h.spaceSlug === space && titleMatches.some((t) => t.path === h.path)))
    .map((h) => ({ key: `s:${h.pageId}`, space: h.spaceSlug, path: h.path, title: h.title, sub: h.spaceName, snippetHtml: h.snippetHtml }));
  const items = [...titleMatches, ...searchMatches];

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, items.length - 1));
    if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
    if (e.key === "Enter" && items[active]) onOpen(items[active].space, items[active].path);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="palette" role="dialog" aria-label="Search" onClick={(e) => e.stopPropagation()}>
        <input
          ref={input}
          id="palette-q"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
          placeholder="Search pages…"
          aria-label="Search pages"
        />
        <ul>
          {items.map((it, i) => (
            <li key={it.key} className={i === active ? "active" : ""} onMouseEnter={() => setActive(i)} onClick={() => onOpen(it.space, it.path)}>
              <strong>{it.title}</strong> <span className="sub">{it.sub}</span>
              {/* Snippet HTML is escaped server-side; only <mark> is added. */}
              {it.snippetHtml && <p className="snippet" dangerouslySetInnerHTML={{ __html: it.snippetHtml }} />}
            </li>
          ))}
          {q && items.length === 0 && <li className="empty">No matches</li>}
        </ul>
      </div>
    </div>
  );
}
