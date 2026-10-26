/**
 * Present mode: one slide at a time, arrow keys / space / swipe to move,
 * F for fullscreen. The slide number is kept in the URL hash.
 */
export function mountDeck(deck: HTMLElement): void {
  const slides = [...deck.querySelectorAll<HTMLElement>(".elemnt-slide")];
  if (!slides.length) return;
  const counter = document.querySelector<HTMLElement>(".deck-count");
  let i = Math.min(slides.length - 1, Math.max(0, Number(location.hash.slice(1)) - 1 || 0));
  const show = (n: number) => {
    i = Math.min(slides.length - 1, Math.max(0, n));
    slides.forEach((s, j) => (s.hidden = j !== i));
    if (counter) counter.textContent = `${i + 1} / ${slides.length}`;
    history.replaceState(null, "", `#${i + 1}`);
  };
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (["ArrowRight", "PageDown", " "].includes(e.key)) (e.preventDefault(), show(i + 1));
    if (["ArrowLeft", "PageUp"].includes(e.key)) (e.preventDefault(), show(i - 1));
    if (e.key === "Home") show(0);
    if (e.key === "End") show(slides.length - 1);
    if (e.key === "f" || e.key === "F") void (document.fullscreenElement ? document.exitFullscreen() : deck.requestFullscreen?.());
  });
  let x0: number | undefined;
  deck.addEventListener("touchstart", (e) => (x0 = e.touches[0]?.clientX), { passive: true });
  deck.addEventListener("touchend", (e) => {
    const x1 = e.changedTouches[0]?.clientX;
    if (x0 !== undefined && x1 !== undefined && Math.abs(x1 - x0) > 50) show(i + (x1 < x0 ? 1 : -1));
    x0 = undefined;
  });
  document.querySelector<HTMLButtonElement>(".deck-prev")?.addEventListener("click", () => show(i - 1));
  document.querySelector<HTMLButtonElement>(".deck-next")?.addEventListener("click", () => show(i + 1));
  show(i);
}
