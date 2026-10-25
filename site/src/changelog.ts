// The changelog book. The page is already open on the newest release (or the
// one in the URL) before this runs; this adds the reading: older and newer,
// the scrubber and chips, keys, swipe, #x.y.z deep links kept in step with
// history.replaceState, the art of the neighbours prefetched while idle, and
// the motion switch.
//
// The turn itself is pluggable. Without anything else it is the CSS slide in
// src/styles/changelog.css; src/book3d.ts, when it loads, replaces it with the
// three.js page turn. Reduced motion and the switch set to off get an
// instant swap and never load the 3D.
import "./nav";

export type Dir = 1 | -1;
// dir 1 goes to an older release (the page turns left to right, as a manga
// reads), -1 to a newer one.
export type Turn = (from: HTMLElement, to: HTMLElement, dir: Dir) => Promise<void>;

const root = document.documentElement;
const book = document.querySelector<HTMLElement>(".book")!;
const spreads = [...book.querySelectorAll<HTMLElement>(".spread")];
const scrub = document.querySelector<HTMLElement>(".scrub")!;
const scrubLinks = [...scrub.querySelectorAll<HTMLAnchorElement>(".scrub-v")];
const peek = scrub.querySelector<HTMLElement>(".scrub-peek")!;
const older = document.querySelector<HTMLAnchorElement>(".turn-older")!;
const newer = document.querySelector<HTMLAnchorElement>(".turn-newer")!;
const live = document.querySelector<HTMLElement>("[data-live]")!;
const wideQuery = matchMedia("(min-width: 64rem) and (min-height: 37.5rem)");
const untilFound = "onbeforematch" in document.body;

let current = 0;
let busy: Promise<void> | null = null;
let queued: { to: number; focus: boolean } | null = null;
let turnEffect: Turn | null = null;

// --- motion -----------------------------------------------------------------

export const still = () => root.dataset.motion === "off";

function setMotion(next: "on" | "off", remember: boolean) {
  root.dataset.motion = next;
  if (remember) {
    try {
      localStorage.setItem("motion", next);
    } catch {}
  }
  const button = document.querySelector<HTMLButtonElement>(".motion-switch");
  if (button) {
    button.setAttribute("aria-pressed", String(next === "on"));
    button.querySelector(".motion-state")!.textContent = next;
  }
  dispatchEvent(new CustomEvent("changelog:motion", { detail: next }));
}
const motionButton = document.querySelector<HTMLButtonElement>(".motion-switch");
if (motionButton) {
  motionButton.hidden = false;
  motionButton.addEventListener("click", () => setMotion(still() ? "on" : "off", true));
}
setMotion(still() ? "off" : "on", false);

// --- the spreads --------------------------------------------------------------

const versionOf = (i: number) => spreads[i].dataset.v!;

// "#1.12.3", "#v1.12.3" and the old "#v1-12-3" anchors.
function indexFor(hash: string) {
  const m = /^#v?(\d+)[.-](\d+)[.-](\d+)$/.exec(decodeURIComponent(hash));
  if (!m) return -1;
  const v = `${m[1]}.${m[2]}.${m[3]}`;
  return spreads.findIndex((s) => s.dataset.v === v);
}

function setHidden(el: HTMLElement, hidden: boolean) {
  if (!hidden) el.removeAttribute("hidden");
  else if (untilFound) el.setAttribute("hidden", "until-found");
  else el.hidden = true;
}

function paint(i: number) {
  for (const [j, s] of spreads.entries()) setHidden(s, j !== i);
  for (const a of scrubLinks) a.dataset.i === String(i) ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current");
  const set = (a: HTMLAnchorElement, j: number) => {
    const ok = j >= 0 && j < spreads.length;
    a.setAttribute("aria-disabled", String(!ok));
    a.href = ok ? `#${versionOf(j)}` : "#";
    a.querySelector(".turn-label")!.textContent = ok ? versionOf(j) : a === older ? "older" : "newer";
  };
  set(older, i + 1);
  set(newer, i - 1);
  // Keep the current chip in view on phones.
  const chip = scrubLinks.find((a) => a.dataset.i === String(i));
  const list = chip?.closest<HTMLElement>(".scrub-list");
  if (chip && list && list.scrollWidth > list.clientWidth) {
    list.scrollTo({ left: chip.offsetLeft - list.clientWidth / 2 + chip.offsetWidth / 2, behavior: still() ? "auto" : "smooth" });
  }
}

export const slide: Turn = (from, to, dir) =>
  new Promise((done) => {
    if (still()) return done();
    book.style.setProperty("--dir", String(dir));
    from.classList.add("is-leaving");
    to.classList.add("is-arriving");
    from.removeAttribute("hidden");
    setTimeout(() => {
      from.classList.remove("is-leaving");
      done();
      setTimeout(() => to.classList.remove("is-arriving"), 700);
    }, 280);
  });

export async function go(to: number, focus = false): Promise<void> {
  to = Math.max(0, Math.min(spreads.length - 1, to));
  if (to === current) {
    if (focus) heading(current).focus({ preventScroll: true });
    return;
  }
  if (busy) {
    queued = { to, focus };
    dispatchEvent(new CustomEvent("changelog:hurry"));
    return busy;
  }
  const from = current;
  const dir: Dir = to > from ? 1 : -1;
  current = to;
  busy = (async () => {
    paint(to);
    history.replaceState(null, "", `#${versionOf(to)}`);
    await (still() ? Promise.resolve() : (turnEffect ?? slide)(spreads[from], spreads[to], dir).catch(() => {}));
    setHidden(spreads[from], true);
    if (focus) heading(to).focus({ preventScroll: true });
    live.textContent = `Release ${versionOf(to)}`;
    dispatchEvent(new CustomEvent("changelog:turned", { detail: { from, to } }));
    prefetchAround(to);
  })();
  await busy;
  busy = null;
  if (queued) {
    const q = queued;
    queued = null;
    await go(q.to, q.focus);
  }
}

const heading = (i: number) => spreads[i].querySelector<HTMLElement>(".rel-v")!;

// --- art: the current release, then its neighbours while idle -------------------

const idle = (fn: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 600));
let ext: "avif" | "webp" | null = null;
const fetched = new Set<string>();

function format(): "avif" | "webp" {
  if (ext) return ext;
  const img = spreads[current].querySelector<HTMLImageElement>(".art-img");
  if (img?.currentSrc) ext = img.currentSrc.endsWith(".avif") ? "avif" : "webp";
  return ext ?? "avif";
}

// The art a spread shows here: phones get the small strip, as in the
// <picture> (scripts/changelog-book.mjs).
export function artUrl(i: number) {
  const { art, small } = spreads[i].dataset;
  return `${art}${small && !wideQuery.matches ? `-${small}` : ""}.${format()}`;
}

function prefetchAround(i: number) {
  idle(() => {
    for (const j of [i + 1, i - 1]) {
      if (j < 0 || j >= spreads.length) continue;
      const url = artUrl(j);
      if (fetched.has(url)) continue;
      fetched.add(url);
      const img = new Image();
      img.decoding = "async";
      img.src = url;
    }
  });
}

// --- input ------------------------------------------------------------------

for (const [el, step] of [
  [older, 1],
  [newer, -1],
] as const) {
  el.hidden = false;
  el.addEventListener("click", (e) => {
    e.preventDefault();
    void go(current + step);
  });
}

addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  if (root.classList.contains("menu-locked")) return;
  const t = e.target as HTMLElement;
  if (t.closest("input, select, textarea, [contenteditable]")) return;
  if (t.closest("a, button, summary") && (e.key === "Home" || e.key === "End")) return;
  const step: Record<string, number> = {
    ArrowLeft: current + 1,
    PageDown: current + 1,
    ArrowRight: current - 1,
    PageUp: current - 1,
    Home: spreads.length - 1,
    End: 0,
  };
  if (!(e.key in step)) return;
  e.preventDefault();
  void go(step[e.key]);
});

// Swipe or drag the book: finger to the right brings in the older page, as
// in a manga. With the 3D book the page follows the finger and lands or
// falls back on release; without it a swipe plays the slide. Vertical
// scrolling stays native. A mouse drags from the book's outer edges only, so
// text stays selectable.
const EDGE = 0.18;
let start: { x: number; y: number; id: number; mouse: boolean } | null = null;
let drag: { dir: Dir; handle: Promise<DragHandle | null>; p: number } | null = null;
book.style.touchAction = "pan-y";
const nearEdge = (x: number) => {
  const r = book.getBoundingClientRect();
  return x < r.left + r.width * EDGE || x > r.right - r.width * EDGE;
};
book.addEventListener("pointerdown", (e) => {
  const mouse = e.pointerType === "mouse";
  if (mouse && (e.button !== 0 || !nearEdge(e.clientX))) return;
  if ((e.target as HTMLElement).closest("a, button, summary, input, .full-body")) return;
  start = { x: e.clientX, y: e.clientY, id: e.pointerId, mouse };
  if (mouse) e.preventDefault();
});
book.addEventListener("pointermove", (e) => {
  if (e.pointerType === "mouse" && !start) book.style.cursor = dragEffect && nearEdge(e.clientX) ? "grab" : "";
  if (!start || e.pointerId !== start.id) return;
  const dx = e.clientX - start.x;
  const dy = e.clientY - start.y;
  if (!drag) {
    if (Math.abs(dx) < 12 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    const dir: Dir = dx > 0 ? 1 : -1;
    if (!dragEffect || busy || still() || current + dir < 0 || current + dir >= spreads.length) return;
    book.setPointerCapture(e.pointerId);
    drag = { dir, p: 0, handle: beginDrag(dir) };
  }
  drag.p = Math.max(0, Math.min(1, (dx * drag.dir) / (book.clientWidth * (wideQuery.matches ? 0.5 : 0.85))));
  void drag.handle.then((h) => h?.set(drag ? drag.p : 0));
});
const release = (e: PointerEvent, cancelled = false) => {
  if (!start || e.pointerId !== start.id) return;
  const dx = e.clientX - start.x;
  const dy = e.clientY - start.y;
  const s = start;
  start = null;
  if (drag) {
    const d = drag;
    drag = null;
    void d.handle.then((h) => h?.end(!cancelled && d.p > 0.3));
    return;
  }
  if (cancelled || s.mouse || Math.abs(dx) < 48 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
  void go(current + (dx > 0 ? 1 : -1));
};
book.addEventListener("pointerup", (e) => release(e));
book.addEventListener("pointercancel", (e) => release(e, true));

// A turn the reader drives. The 3D book prepares the leaf; until it is ready
// the finger's position is kept, so the page catches up when it appears.
export type DragHandle = { set(p: number): void; end(commit: boolean): Promise<boolean> };
export type DragTurn = (from: HTMLElement, to: HTMLElement, dir: Dir) => Promise<DragHandle | null>;
let dragEffect: DragTurn | null = null;

function beginDrag(dir: Dir): Promise<DragHandle | null> {
  const from = current;
  const to = current + dir;
  let release!: () => void;
  busy = new Promise<void>((r) => (release = r));
  const done = () => {
    busy = null;
    release();
  };
  return dragEffect!(spreads[from], spreads[to], dir)
    .catch(() => null)
    .then((h) => {
      if (!h) {
        done();
        return null;
      }
      return {
        set: h.set,
        async end(commit: boolean) {
          const landed = await h.end(commit).catch(() => false);
          if (landed) {
            current = to;
            paint(to);
            history.replaceState(null, "", `#${versionOf(to)}`);
            live.textContent = `Release ${versionOf(to)}`;
            dispatchEvent(new CustomEvent("changelog:turned", { detail: { from, to } }));
            prefetchAround(to);
          } else paint(from);
          done();
          return landed;
        },
      };
    });
}

// Links to a release anywhere on the page (chips, scrubber, All releases)
// open it in the book.
document.addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
  if (!a || a.classList.contains("turn") || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const i = indexFor(a.hash);
  if (i < 0) return;
  e.preventDefault();
  if (a.closest(".all")) book.scrollIntoView({ block: "start", behavior: still() ? "auto" : "smooth" });
  void go(i, true);
});
addEventListener("hashchange", () => {
  const i = indexFor(location.hash);
  if (i >= 0) void go(i, true);
});

// Find in page opens the release holding the match.
book.addEventListener("beforematch", (e) => {
  const s = (e.target as HTMLElement).closest<HTMLElement>(".spread");
  const i = s ? spreads.indexOf(s) : -1;
  if (i >= 0 && i !== current) {
    setHidden(spreads[current], true);
    current = i;
    paint(i);
    history.replaceState(null, "", `#${versionOf(i)}`);
  }
});

// The scrubber: hover or drag shows a thumbnail of the release under the
// pointer; letting go opens it. Only thumbnails load while dragging.
const peekImg = peek.querySelector("img")!;
const peekV = peek.querySelector<HTMLElement>(".scrub-peek-v")!;
function showPeek(a: HTMLAnchorElement | null) {
  if (!a || !wideQuery.matches) return void (peek.hidden = true);
  const i = Number(a.dataset.i);
  peekImg.src = spreads[i].dataset.thumb!;
  peekV.textContent = versionOf(i);
  const box = scrub.getBoundingClientRect();
  const r = a.getBoundingClientRect();
  peek.style.left = `${r.left + r.width / 2 - box.left}px`;
  peek.hidden = false;
}
const linkAt = (x: number) => {
  let best: HTMLAnchorElement | null = null;
  let d = Infinity;
  for (const a of scrubLinks) {
    const r = a.getBoundingClientRect();
    const m = Math.abs(r.left + r.width / 2 - x);
    if (m < d) [best, d] = [a, m];
  }
  return best;
};
const list = scrub.querySelector<HTMLElement>(".scrub-list")!;
let dragging: HTMLAnchorElement | null = null;
let dragMoved = false;
list.addEventListener("pointerover", (e) => showPeek((e.target as HTMLElement).closest(".scrub-v")));
list.addEventListener("pointerleave", () => !dragging && (peek.hidden = true));
list.addEventListener("pointerdown", (e) => {
  if (!wideQuery.matches) return;
  dragging = linkAt(e.clientX);
  dragMoved = false;
  list.setPointerCapture(e.pointerId);
});
list.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const a = linkAt(e.clientX);
  if (a !== dragging) dragMoved = true;
  dragging = a;
  showPeek(a);
});
list.addEventListener("pointerup", () => {
  if (!dragging) return;
  const a = dragging;
  dragging = null;
  peek.hidden = true;
  // Pointer capture retargets the click to the list, so a plain click on a
  // version is handled here too.
  void go(Number(a.dataset.i), !dragMoved);
});
list.addEventListener("pointercancel", () => ((dragging = null), (peek.hidden = true)));

// Copy link: an icon, with "Copied" beside it for a moment.
for (const button of book.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
  if (!navigator.clipboard) continue;
  button.hidden = false;
  const state = button.querySelector<HTMLElement>(".copy-state")!;
  let reset = 0;
  button.addEventListener("click", async () => {
    const v = button.closest<HTMLElement>(".spread")!.dataset.v;
    try {
      await navigator.clipboard.writeText(`${location.origin}${location.pathname}#${v}`);
      state.textContent = "Copied";
    } catch {
      state.textContent = "Copy failed";
    }
    clearTimeout(reset);
    reset = setTimeout(() => (state.textContent = ""), 1600);
  });
}

// All releases: the link beside the actions opens the list under the book.
const all = document.querySelector<HTMLDetailsElement>("#all")!;
document.addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("[data-all]");
  if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  all.open = true;
  all.scrollIntoView({ block: "start", behavior: still() ? "auto" : "smooth" });
  all.querySelector<HTMLElement>("summary")!.focus({ preventScroll: true });
});

// --- boot -------------------------------------------------------------------

{
  const found = indexFor(location.hash);
  current = found >= 0 ? found : 0;
  paint(current);
  root.dataset.ready = "";
  if (found >= 0) {
    history.replaceState(null, "", `#${versionOf(current)}`);
    heading(current).focus({ preventScroll: true });
  }
  addEventListener("load", () => prefetchAround(current), { once: true });
}

// --- the 3D book --------------------------------------------------------------
//
// src/book3d.ts and three.js load after first paint, only where the turn is
// worth its weight: motion on, WebGL2, no Save-Data and
// a device that is not short of memory. Phones get it too, one page wide. Until then, and if it fails, the
// slide above turns the page.
let book3d: Promise<void> | null = null;
function load3d() {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (book3d || still() || nav.connection?.saveData || (nav.deviceMemory ?? 8) < 4) return;
  if (!("WebGL2RenderingContext" in window)) return;
  book3d = import("./book3d").then((m) => m.attach()).catch(() => {});
}
addEventListener("load", () => idle(load3d), { once: true });
addEventListener("changelog:motion", load3d);

export const reader = {
  book,
  spreads,
  get current() {
    return current;
  },
  go,
  artUrl,
  useTurn(next: Turn | null, drag: DragTurn | null = null) {
    turnEffect = next;
    dragEffect = next ? drag : null;
  },
};
