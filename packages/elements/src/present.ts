/**
 * Present mode: one slide at a time, arrow keys / space / swipe to move,
 * F for fullscreen. The slide number is kept in the URL hash.
 */
export function mountDeck(deck: HTMLElement): void {
  let slides: HTMLElement[] = [];
  const counter = document.querySelector<HTMLElement>(".deck-count");
  const area = deck.querySelector<HTMLElement>(".deck-slides") ?? deck;
  let i = 0;
  const show = (n: number) => {
    if (!slides.length) return;
    i = Math.min(slides.length - 1, Math.max(0, n));
    slides.forEach((s, j) => (s.hidden = j !== i));
    if (counter) counter.textContent = `${i + 1} / ${slides.length}`;
    history.replaceState(null, "", `#${i + 1}`);
  };
  // Slides are drawn on a fixed stage; scale it to the space the window has.
  const scale = () => {
    const stage = deck.querySelector<HTMLElement>(".slide-stage");
    if (!stage) return;
    const s = Math.min(area.clientWidth / stage.offsetWidth, area.clientHeight / stage.offsetHeight);
    if (s > 0) deck.style.setProperty("--s", String(s));
  };
  addEventListener("resize", scale);
  document.addEventListener("fullscreenchange", scale);
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

  // Measure once the page's fonts are in, while every slide is still laid out.
  const start = () => {
    slides = fitSlides(deck);
    scale();
    show(Number(location.hash.slice(1)) - 1 || 0);
    deck.classList.add("ready");
  };
  if (document.fonts?.ready) void document.fonts.ready.then(start, start);
  else start();
}

const HEADING = /^H[1-6]$/;
/** Smallest zoom a block is shrunk to before it's left as is. */
const MIN_ZOOM = 0.4;

/**
 * Makes every `.elemnt-slide` under `root` fit its stage. A slide that runs
 * over is split: trailing blocks, then list items or table rows, move to a
 * continuation slide that repeats the heading. A block that still doesn't fit
 * on a slide of its own (a long code sample, a big graphic) is scaled down.
 * Slide numbers are renumbered. Returns the slides in order.
 */
export function fitSlides(root: ParentNode): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const first of root.querySelectorAll<HTMLElement>(".elemnt-slide")) {
    let slide: HTMLElement | undefined = first;
    for (let guard = 0; slide && guard < 40; guard++) {
      out.push(slide);
      slide = fitSlide(slide);
    }
  }
  out.forEach((s, n) => {
    s.setAttribute("aria-label", `Slide ${n + 1} of ${out.length}`);
    const num = s.querySelector(".slide-num");
    if (num) num.textContent = `${n + 1} / ${out.length}`;
  });
  return out;
}

/** Fits one slide; returns the continuation slide it split off, if any. */
function fitSlide(slide: HTMLElement): HTMLElement | undefined {
  const body = slide.querySelector<HTMLElement>(".slide-body");
  if (!body || !overflows(body)) return undefined;
  const flow = flowRoot(body);
  const lead = flow.firstElementChild && /^H[12]$/.test(flow.firstElementChild.tagName) ? flow.firstElementChild : null;
  const blocks = () => [...flow.children].filter((c) => c !== lead);
  const rest: Element[] = [];

  // Move blocks off the end, or split the last one, until the slide fits.
  while (overflows(body) && blocks().length > 1) {
    const last = blocks().at(-1)!;
    const tail = splitToFit(body, last, 2);
    if (tail) {
      rest.unshift(tail);
      break;
    }
    rest.unshift(last);
    last.remove();
  }
  // Don't leave a heading, or a line that introduces what follows, at the bottom of a slide.
  for (let last = blocks().at(-1); last && rest.length && leadsIn(last) && blocks().length > 1; last = blocks().at(-1)) {
    rest.unshift(last);
    last.remove();
  }
  // One block left and still too long: split it if it's a list or table.
  const only = blocks()[0];
  if (overflows(body) && only) {
    const tail = splitToFit(body, only, 1);
    if (tail) rest.unshift(tail);
  }
  if (overflows(body)) shrink(body, flow, lead);
  if (!rest.length) return undefined;

  const next = slide.cloneNode(true) as HTMLElement;
  next.classList.remove("slide-cover");
  const nextBody = next.querySelector<HTMLElement>(".slide-body")!;
  nextBody.replaceChildren();
  if (lead) {
    const h = lead.cloneNode(true) as HTMLElement;
    h.removeAttribute("id");
    h.querySelector(".slide-cont")?.remove();
    const tag = document.createElement("span");
    tag.className = "slide-cont";
    tag.textContent = " · continued";
    h.append(tag);
    nextBody.append(h);
  }
  nextBody.append(...rest);
  slide.after(next);
  return next;
}

/** The element whose children are the slide's blocks, looking through wrappers like a band. */
function flowRoot(body: HTMLElement): Element {
  let el: Element = body;
  while (el.children.length === 1 && el.firstElementChild!.matches(".elemnt-band,.elemnt-band-inner")) el = el.firstElementChild!;
  return el;
}

const leadsIn = (el: Element) => HEADING.test(el.tagName) || (el.tagName === "P" && /:\s*$/.test(el.textContent ?? ""));

function overflows(body: HTMLElement): boolean {
  return body.scrollHeight > body.clientHeight + 1 || body.scrollWidth > body.clientWidth + 1;
}

/** Blocks whose children can be spread over several slides. */
const SPLITTABLE = "ul,ol,.elemnt-cards";

/**
 * Moves items off the end of a list, grid or table into a
 * copy of it until the slide fits, keeping at least `keep` items. Returns the
 * copy, or null (and changes nothing) when it can't.
 */
function splitToFit(body: HTMLElement, block: Element, keep: number): Element | null {
  const parent = block.matches(SPLITTABLE) ? block : block.matches("table") ? block.querySelector("tbody") : null;
  if (!parent) return null;
  const items = [...parent.children];
  if (items.length <= keep) return null;
  const moved: Element[] = [];
  while (overflows(body) && items.length - moved.length > keep) {
    const item = items[items.length - moved.length - 1]!;
    moved.unshift(item);
    item.remove();
  }
  if (overflows(body) || !moved.length) {
    parent.append(...moved);
    return null;
  }
  // No lone item at the top of the next slide when this one can spare another.
  if (moved.length === 1 && items.length - moved.length > keep + 1) {
    const item = items[items.length - 2]!;
    moved.unshift(item);
    item.remove();
  }
  const copy = block.cloneNode(true) as Element;
  copy.removeAttribute("id");
  const copyParent = copy.matches("table") ? copy.querySelector("tbody")! : copy;
  copyParent.replaceChildren(...moved);
  if (copy.matches("ol")) copy.setAttribute("start", String(Number(block.getAttribute("start") ?? 1) + items.length - moved.length));
  return copy;
}

/** Scales the slide's content (not its heading) down, in steps, until it fits. */
function shrink(body: HTMLElement, flow: Element, lead: Element | null): void {
  const fit = document.createElement("div");
  fit.className = "slide-fit";
  fit.append(...[...flow.childNodes].filter((n) => n !== lead));
  flow.append(fit);
  for (let z = 0.95; overflows(body) && z >= MIN_ZOOM; z -= 0.05) fit.style.zoom = String(z);
}
