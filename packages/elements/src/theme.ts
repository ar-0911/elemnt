const query = () => matchMedia("(prefers-color-scheme: dark)");

export function isDark(): boolean {
  const forced = document.documentElement.dataset.theme;
  return forced ? forced === "dark" : query().matches;
}

export function onThemeChange(cb: (dark: boolean) => void): () => void {
  const q = query();
  const on = () => cb(isDark());
  q.addEventListener("change", on);
  return () => q.removeEventListener("change", on);
}

/** Marks an element as enhanced; returns false if it already was. */
export function claim(el: HTMLElement, key = "enhanced"): boolean {
  if (el.dataset[key]) return false;
  el.dataset[key] = "1";
  return true;
}

export function make<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  Object.assign(el, props);
  el.append(...children);
  return el;
}
