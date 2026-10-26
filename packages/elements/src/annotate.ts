import { claim } from "./theme.js";

/** Hovering or focusing an annotated line highlights its note, and the other way round. */
export function enhanceAnnotate(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>("elemnt-annotate")) {
    if (!claim(el)) continue;
    const notes = [...el.querySelectorAll<HTMLElement>(".elemnt-notes li")];
    const lines = [...el.querySelectorAll<HTMLElement>(".elemnt-line[data-note]")];
    const activate = (n: string | undefined) => {
      lines.forEach((l) => l.toggleAttribute("data-active", l.dataset.note === n));
      notes.forEach((li, i) => li.toggleAttribute("data-active", String(i + 1) === n));
    };
    for (const l of lines) {
      l.tabIndex = 0;
      l.title = notes[Number(l.dataset.note) - 1]?.textContent?.trim() ?? "";
      l.onmouseenter = l.onfocus = () => activate(l.dataset.note);
    }
    notes.forEach((li, i) => (li.onmouseenter = () => activate(String(i + 1))));
    el.onmouseleave = () => activate(undefined);
  }
}
