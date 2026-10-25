import { useEffect, useState } from "react";
import { api, type Comment } from "./api";

interface Props {
  pageId: string;
  quote: string | undefined;
  clearQuote(): void;
}

export function CommentsPanel({ pageId, quote, clearQuote }: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string>();
  const [showResolved, setShowResolved] = useState(false);
  const [error, setError] = useState<string>();

  const load = () => api.get<Comment[]>(`/api/pages/${pageId}/comments`).then(setComments);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    try {
      await api.post(`/api/pages/${pageId}/comments`, { body, ...(replyTo ? { parentId: replyTo } : quote ? { anchor: { exact: quote.slice(0, 1000) } } : {}) });
      setBody("");
      setReplyTo(undefined);
      clearQuote();
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const threads = comments.filter((c) => !c.parentId && (showResolved || !c.resolvedAt));
  const replies = (id: string) => comments.filter((c) => c.parentId === id);

  return (
    <section className="panel" aria-label="Comments">
      <h2>Comments</h2>
      <label className="check">
        <input id="show-resolved" type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved
      </label>
      {error && <p className="error">{error}</p>}
      {threads.length === 0 && <p className="hint">No comments yet. Select text in the preview to comment on it.</p>}
      {threads.map((t) => (
        <article key={t.id} className={`thread${t.resolvedAt ? " resolved" : ""}`}>
          {t.anchor && <blockquote>{t.anchor.exact}</blockquote>}
          {[t, ...replies(t.id)].map((c) => (
            <div key={c.id} className="comment">
              <strong>{c.authorName ?? c.authorEmail}</strong> <span className="when">{new Date(c.createdAt).toLocaleString()}</span>
              <p>{c.body}</p>
            </div>
          ))}
          <div className="row">
            <button type="button" className="link" onClick={() => setReplyTo(t.id)}>
              Reply
            </button>
            <button
              type="button"
              className="link"
              onClick={() => void api.post(`/api/pages/${pageId}/comments/${t.id}/resolve`, { resolved: !t.resolvedAt }).then(load)}
            >
              {t.resolvedAt ? "Reopen" : "Resolve"}
            </button>
          </div>
        </article>
      ))}
      <form onSubmit={(e) => void submit(e)} className="new-comment">
        {replyTo ? (
          <p className="hint">
            Replying. <button type="button" className="link" onClick={() => setReplyTo(undefined)}>Cancel</button>
          </p>
        ) : quote ? (
          <blockquote>
            {quote} <button type="button" className="link" onClick={clearQuote}>Clear</button>
          </blockquote>
        ) : null}
        <textarea id="comment-body" aria-label="Comment" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment" />
        <button className="btn" type="submit" disabled={!body.trim()}>
          Comment
        </button>
      </form>
    </section>
  );
}
