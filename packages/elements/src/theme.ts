const query = () => matchMedia("(prefers-color-scheme: dark)");

export function isDark(): boolean {
  const forced = document.documentElement.dataset.theme;
  return forced ? forced === "dark" : query().matches;
}

/** Calls back when the system theme changes or a toggle sets `data-theme` on <html>. */
export function onThemeChange(cb: (dark: boolean) => void): () => void {
  const q = query();
  const on = () => cb(isDark());
  q.addEventListener("change", on);
  const mo = new MutationObserver(on);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    q.removeEventListener("change", on);
    mo.disconnect();
  };
}

const KEY = "elemnt-theme";

/** The reader's own choice, if they made one. Storage can be unavailable (private windows), so it never throws. */
export function savedTheme(): "light" | "dark" | undefined {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Sets light or dark on <html> and remembers it; "auto" follows the system again. */
export function setTheme(mode: "light" | "dark" | "auto"): void {
  if (mode === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  try {
    if (mode === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {
    /* not remembered; still applied */
  }
}

/**
 * Turns a button into a light/dark switch. `pageDefault` is the page style's
 * mode, used until the reader picks one.
 */
export function mountThemeToggle(button: HTMLButtonElement, pageDefault: "auto" | "light" | "dark" = "auto"): void {
  const saved = savedTheme();
  if (saved) document.documentElement.dataset.theme = saved;
  else if (pageDefault !== "auto") document.documentElement.dataset.theme = pageDefault;
  const paint = () => {
    const dark = isDark();
    button.textContent = dark ? "☀" : "☾";
    button.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    button.title = button.getAttribute("aria-label")!;
    button.setAttribute("aria-pressed", String(dark));
  };
  button.addEventListener("click", () => setTheme(isDark() ? "light" : "dark"));
  onThemeChange(paint);
  paint();
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
