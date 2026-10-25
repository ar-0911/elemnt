import { forwardRef, useEffect, useRef } from "react";
import { enhance } from "./enhance";

interface Props {
  html: string;
  onSelectText?(text: string): void;
}

/** Renders compiled, sanitized HTML from @elemnt/core and adds client behaviour. */
export const Preview = forwardRef<HTMLDivElement, Props>(function Preview({ html, onSelectText }, ref) {
  const inner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (inner.current) enhance(inner.current);
  }, [html]);
  return (
    <div className="preview" ref={ref}>
      <article
        className="elemnt-page"
        ref={inner}
        // Safe: @elemnt/core drops raw HTML and sanitizes its own output against an allowlist.
        dangerouslySetInnerHTML={{ __html: html }}
        onMouseUp={() => {
          const text = getSelection()?.toString().trim();
          if (text && onSelectText) onSelectText(text);
        }}
      />
    </div>
  );
});
