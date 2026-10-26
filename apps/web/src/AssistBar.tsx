import { useEffect, useRef, useState } from "react";

interface Props {
  hasSelection: boolean;
  busy: boolean;
  error: string | undefined;
  onSubmit(instruction: string): void;
  onClose(): void;
}

const IDEAS = ["Make this clearer for a new teammate", "Turn this into steps", "Add a callout for the risky part", "Tighten the wording", "Add tabs for npm and pnpm"];

/** ⌘I: tell Claude what to change. The answer comes back as a suggestion to review. */
export function AssistBar({ hasSelection, busy, error, onSubmit, onClose }: Props) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  return (
    <form
      className="assist"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim() && !busy) onSubmit(text.trim());
      }}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <input
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={hasSelection ? "What should Claude do with the selection?" : "What should Claude do with this page?"}
        list="assist-ideas"
        disabled={busy}
        aria-label="Instruction for Claude"
      />
      <datalist id="assist-ideas">
        {IDEAS.map((i) => (
          <option key={i} value={i} />
        ))}
      </datalist>
      <button type="submit" className="btn primary" disabled={busy || !text.trim()}>
        {busy ? "Thinking…" : "Suggest"}
      </button>
      <button type="button" className="btn ghost" onClick={onClose}>
        Cancel
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
