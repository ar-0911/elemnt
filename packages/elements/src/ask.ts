import { make } from "./theme.js";

export interface AskOptions {
  pageId: string;
  /** utm_source of this visit, so questions from e.g. LinkedIn readers can be told apart. */
  source?: string;
  /** Hydrates the answer (charts, diagrams…) the same way as the page. */
  enhance?(root: HTMLElement): void;
}

interface Answer {
  html: string;
  covered: boolean;
  section: string | null;
}

/**
 * Ask the page: a button that opens a question panel, and an "Ask about this"
 * chip when the reader selects text on the page. Answers come back as
 * sanitized HTML compiled by the server from Claude's Elemnt source.
 */
export function mountAsk(article: HTMLElement, opts: AskOptions): () => void {
  let quote = "";
  const panel = make("aside", { className: "elemnt-ask" });
  panel.hidden = true;
  panel.setAttribute("aria-label", "Ask about this page");
  const close = make("button", { type: "button", className: "elemnt-ask-close", textContent: "×", title: "Close" });
  const quoteEl = make("blockquote", { className: "elemnt-ask-quote" });
  quoteEl.hidden = true;
  const input = make("textarea", { placeholder: "Ask a question about this page", rows: 2, maxLength: 500 });
  input.setAttribute("aria-label", "Your question");
  const send = make("button", { type: "submit", className: "elemnt-run-btn", textContent: "Ask" });
  const form = make("form", {}, input, send);
  const log = make("div", { className: "elemnt-ask-log" });
  log.setAttribute("aria-live", "polite");
  panel.append(make("div", { className: "elemnt-ask-head" }, make("strong", { textContent: "Ask this page" }), close), quoteEl, log, form);

  const open = make("button", { type: "button", className: "elemnt-ask-open", textContent: "Ask" });
  const chip = make("button", { type: "button", className: "elemnt-ask-chip", textContent: "Ask about this" });
  chip.hidden = true;
  document.body.append(panel, open, chip);

  const show = () => {
    panel.hidden = false;
    open.hidden = true;
    input.focus();
  };
  const hide = () => {
    panel.hidden = true;
    open.hidden = false;
  };
  open.onclick = show;
  close.onclick = hide;

  const setQuote = (q: string) => {
    quote = q.slice(0, 1000);
    quoteEl.textContent = quote;
    quoteEl.hidden = !quote;
  };

  const onSelect = () => {
    const sel = getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!sel || !text || text.length < 3 || !article.contains(sel.anchorNode)) return void (chip.hidden = true);
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    chip.style.top = `${scrollY + rect.bottom + 6}px`;
    chip.style.left = `${scrollX + rect.left}px`;
    chip.hidden = false;
    chip.onclick = () => {
      setQuote(text);
      chip.hidden = true;
      show();
    };
  };
  document.addEventListener("selectionchange", onSelect);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const question = input.value.trim();
    if (question.length < 3) return;
    send.disabled = true;
    const q = make("p", { className: "elemnt-ask-q", textContent: question });
    const a = make("div", { className: "elemnt-ask-a elemnt-page", textContent: "Thinking…" });
    log.append(q, a);
    a.scrollIntoView({ block: "nearest" });
    try {
      const res = await fetch(`/api/pages/${opts.pageId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ question, ...(quote ? { quote } : {}), ...(opts.source ? { source: opts.source } : {}) }),
      });
      const data = (await res.json()) as Answer & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't get an answer.");
      // Sanitized on the server: compiled from Elemnt source, raw HTML dropped.
      a.innerHTML = data.html;
      opts.enhance?.(a);
      if (data.section) {
        const target = document.getElementById(data.section);
        if (target) a.append(make("p", { className: "elemnt-ask-meta" }, make("a", { href: `#${data.section}`, textContent: `See “${target.textContent}” on this page` })));
      }
      if (!data.covered) a.append(make("p", { className: "elemnt-ask-meta", textContent: "The page doesn't cover this yet. The authors can see your question." }));
      input.value = "";
      setQuote("");
    } catch (err) {
      a.textContent = (err as Error).message;
      a.dataset.error = "1";
    } finally {
      send.disabled = false;
    }
  };

  return () => {
    document.removeEventListener("selectionchange", onSelect);
    panel.remove();
    open.remove();
    chip.remove();
  };
}
