import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { CopyButton } from "./ui";

interface RepoLink {
  repo: string;
  branch: string;
  pinnedCommit: string;
  citedPaths: string[];
  checkedCommit: string | null;
  behindBy: number;
  changedPaths: string[];
  checkedAt: string | null;
}
type Check = { status: "current" | "unchanged" | "suggested" | "commented"; behindBy: number; changedPaths?: string[]; suggestionId?: string };

const short = (sha: string) => sha.slice(0, 7);
const STATUS: Record<Check["status"], string> = {
  current: "Nothing the page cites has changed.",
  unchanged: "Cited files changed; a drift suggestion is already open or nothing on the page needed to change.",
  suggested: "Claude suggested an update. Review it under Suggestions.",
  commented: "Cited files changed. A comment lists them (add a Claude key in Settings to get a suggested edit).",
};

/** Explainer pages: link the page to a GitHub repo, see how far behind it is, and get the README badge. */
export function RepoPanel({ pageId, canEdit, onSuggested }: { pageId: string; canEdit: boolean; onSuggested(id: string): void }) {
  const [link, setLink] = useState<RepoLink | null>();
  const [form, setForm] = useState({ repo: "", commit: "", cited: "" });
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.get<{ link: RepoLink | null }>(`/api/pages/${pageId}/repo`).then((r) => setLink(r.link));
  }, [pageId]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      const cited = form.cited.split(/[\s,]+/).filter(Boolean);
      const r = await api.put<{ link: RepoLink; badge: string }>(`/api/pages/${pageId}/repo`, { repo: form.repo, ...(form.commit ? { commit: form.commit } : {}), ...(cited.length ? { citedPaths: cited } : {}) });
      setLink(r.link);
      setNote(undefined);
    });
  const check = () =>
    run(async () => {
      const r = await api.post<Check>(`/api/pages/${pageId}/repo/check`);
      setNote(STATUS[r.status]);
      setLink((await api.get<{ link: RepoLink }>(`/api/pages/${pageId}/repo`)).link);
      if (r.suggestionId) onSuggested(r.suggestionId);
    });
  const pin = () => run(async () => setLink((await api.post<{ link: RepoLink }>(`/api/pages/${pageId}/repo/pin`)).link));
  const unlink = () =>
    run(async () => {
      await api.del(`/api/pages/${pageId}/repo`);
      setLink(null);
    });

  if (link === undefined) return <section className="panel" aria-label="Repo" />;
  const shortUrl = link ? `${location.origin}/r/${link.repo}` : "";
  const badge = `[![Explained on Elemnt](${shortUrl}/badge.svg)](${shortUrl})`;
  const card = `<a href="${shortUrl}">\n  <picture>\n    <source media="(prefers-color-scheme: dark)" srcset="${shortUrl}/card.svg?theme=dark">\n    <img alt="${link?.repo ?? ""}, explained on Elemnt" src="${shortUrl}/card.svg">\n  </picture>\n</a>`;

  return (
    <section className="panel repo-panel" aria-label="Repo">
      <h3>Repo explainer</h3>
      {link ? (
        <>
          <p>
            Explains <a href={`https://github.com/${link.repo}`}>{link.repo}</a> ({link.branch}), written against <code>{short(link.pinnedCommit)}</code>.{" "}
            {link.behindBy > 0 ? <strong>{link.behindBy} commits behind.</strong> : "Up to date as of the last check."}
          </p>
          {link.changedPaths.length > 0 && (
            <p className="hint">
              Changed since: {link.changedPaths.slice(0, 8).join(", ")}
              {link.changedPaths.length > 8 ? "…" : ""}
            </p>
          )}
          <p className="hint">Watching {link.citedPaths.length ? link.citedPaths.join(", ") : "every file"}, plus files the page links to.</p>
          {canEdit && (
            <p className="row">
              <button type="button" className="btn" disabled={busy} onClick={() => void check()}>
                Check now
              </button>
              <button type="button" className="btn ghost" disabled={busy || link.behindBy === 0} onClick={() => void pin()} title="Mark the page current without changing it">
                Mark current
              </button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => void unlink()}>
                Unlink
              </button>
            </p>
          )}
          {note && <p className="hint">{note}</p>}
          <h4>README card</h4>
          <p className="hint">Put this near the top of your README. It shows this page's title and summary once it's published, and links here.</p>
          <img className="readme-card-preview" src={`${shortUrl}/card.svg`} alt="" />
          <pre className="badge-snippet">{card}</pre>
          <CopyButton text={card} label="Copy card" />
          <h4>Or a small badge</h4>
          <pre className="badge-snippet">{badge}</pre>
          <CopyButton text={badge} label="Copy badge" />
          <h4>Keep it in sync</h4>
          <p className="hint">
            Install the Elemnt GitHub App on the repo, or add the <a href="https://github.com/ar-0911/elemnt/tree/main/integrations/github-action" target="_blank" rel="noreferrer">GitHub Action</a>. Either way, every push checks the files this page covers and suggests edits here.
          </p>
        </>
      ) : canEdit ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p className="hint">Link this page to a GitHub repo. Elemnt reads the repo only, and suggests edits here when files the page covers change.</p>
          <input required placeholder="owner/name or GitHub URL" value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} aria-label="Repo" />
          <input placeholder="Commit SHA (default: branch head)" value={form.commit} onChange={(e) => setForm({ ...form, commit: e.target.value })} aria-label="Commit" />
          <input placeholder="Paths to watch, e.g. src/ api/ (optional)" value={form.cited} onChange={(e) => setForm({ ...form, cited: e.target.value })} aria-label="Paths to watch" />
          <button type="submit" className="btn primary" disabled={busy}>
            Link repo
          </button>
        </form>
      ) : (
        <p className="hint">Not linked to a repo.</p>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
