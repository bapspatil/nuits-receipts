// The changelog reader. With no script the page is the strip: every release
// stacked down the roll, all of it real text. This adds the book on wide
// screens (one slip at a time, Back and Next, arrow keys, swipe, an anchor per
// slip), the motion switch, and the turn effect: a CSS tear, or the WebGL curl
// once src/curl.ts is loaded. Reduced motion and the switch set to off get an
// instant swap and never load either.
import "./nav";

type Motion = "on" | "off";
type Dir = 1 | -1;
export type TurnEffect = (from: HTMLElement, to: HTMLElement, dir: Dir) => Promise<void>;

const root = document.documentElement;
const wide = matchMedia("(min-width: 64rem) and (min-height: 37.5rem)");
const book = document.querySelector<HTMLElement>(".book")!;
const controls = document.querySelector<HTMLElement>(".controls")!;
const back = controls.querySelector<HTMLButtonElement>(".ctl-back")!;
const next = controls.querySelector<HTMLButtonElement>(".ctl-next")!;
const folio = document.querySelector<HTMLElement>(".folio")!;
const live = document.querySelector<HTMLElement>("[data-live]")!;
const leaves = [...book.querySelectorAll<HTMLElement>(".leaf")];
const releases = [...book.querySelectorAll<HTMLElement>(".release")];
const untilFound = "onbeforematch" in document.body;

let motion: Motion = root.dataset.motion === "off" ? "off" : "on";
let current = 0;
let busy: Promise<void> | null = null;
let queued: { to: number; focus: boolean } | null = null;

// --- motion switch -----------------------------------------------------------

const still = () => motion === "off";

function setMotion(nextMotion: Motion, remember: boolean) {
  motion = nextMotion;
  root.dataset.motion = nextMotion;
  if (remember) {
    try {
      localStorage.setItem("motion", nextMotion);
    } catch {}
  }
  const button = document.querySelector<HTMLButtonElement>(".motion-switch");
  if (button) {
    button.setAttribute("aria-pressed", String(nextMotion === "on"));
    button.querySelector(".motion-state")!.textContent = nextMotion;
  }
  dispatchEvent(new CustomEvent("changelog:motion", { detail: nextMotion }));
}

const motionButton = document.querySelector<HTMLButtonElement>(".motion-switch");
if (motionButton) {
  motionButton.hidden = false;
  motionButton.addEventListener("click", () => setMotion(motion === "on" ? "off" : "on", true));
}
setMotion(motion, false);

// --- effects -----------------------------------------------------------------

const wait = (el: HTMLElement) =>
  new Promise<void>((done) => {
    const finish = () => done();
    el.addEventListener("animationend", (e) => e.target === el && finish());
    setTimeout(finish, 700);
  });

// The fallback turn: the slip leaving is torn off and pulled away up the page
// as one sheet (src/styles/changelog.css). Going back, the earlier slip comes
// down onto the roll.
const tear: TurnEffect = async (from, to, dir) => {
  const moving = slipOf(dir === 1 ? from : to);
  moving.classList.add(dir === 1 ? "is-tearing" : "is-tearing-back");
  await wait(moving);
  moving.classList.remove("is-tearing", "is-tearing-back");
};

let effect: TurnEffect | null = null;
export function useEffect(next: TurnEffect | null) {
  effect = next;
}

// The visual unit that moves: the slip of a page, or the index on the cover.
function slipOf(leaf: HTMLElement) {
  return leaf.classList.contains("cover") ? leaf.querySelector<HTMLElement>(".index")! : leaf;
}

// --- the book ----------------------------------------------------------------

const articleOf = (leaf: HTMLElement) => leaf.closest<HTMLElement>(".release");
const unitOf = (leaf: HTMLElement) => articleOf(leaf) ?? leaf;

function hide(el: HTMLElement, hidden: boolean) {
  if (!hidden) el.removeAttribute("hidden");
  else if (untilFound) el.setAttribute("hidden", "until-found");
  else el.hidden = true;
}

function paint(index: number) {
  const leaf = leaves[index];
  const unit = unitOf(leaf);
  for (const l of leaves) if (l !== leaf && !l.classList.contains("cover")) hide(l, true);
  hide(leaf, false);
  for (const u of [leaves[0], ...releases]) hide(u, u !== unit);
  back.setAttribute("aria-disabled", String(index === 0));
  next.setAttribute("aria-disabled", String(index === leaves.length - 1));
  setFolio(index);
}

// The page number, comic style, in the corner under the version.
// It counts releases, so the slips of one release share a number.
function setFolio(index: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const unit = unitOf(leaves[index]);
  folio.textContent = `${pad(releases.indexOf(unit) + 1)} / ${pad(releases.length)}`;
  folio.hidden = index === 0;
}

function describe(leaf: HTMLElement) {
  const article = articleOf(leaf);
  if (!article) return "Changelog";
  const version = article.querySelector(".rel-version")!.textContent;
  const date = article.querySelector("time")?.textContent;
  const pages = article.querySelectorAll(".page").length;
  const page = pages > 1 ? `, page ${leaf.dataset.page} of ${pages}` : "";
  return `${version}${date ? `, ${date}` : ""}${page}`;
}

function headingOf(leaf: HTMLElement) {
  return (articleOf(leaf)?.querySelector<HTMLElement>(".rel-version") ?? leaf.querySelector<HTMLElement>("h1"))!;
}

function anchorOf(leaf: HTMLElement) {
  const article = articleOf(leaf);
  if (!article) return "cover";
  return leaf.dataset.page === "1" ? article.id : leaf.id;
}

async function turn(to: number, focus = false) {
  if (to < 0 || to >= leaves.length || to === current) {
    if (focus && to === current) headingOf(leaves[current]).focus({ preventScroll: true });
    return;
  }
  if (busy) {
    queued = { to, focus };
    dispatchEvent(new CustomEvent("changelog:hurry"));
    return busy;
  }
  const from = leaves[current];
  const target = leaves[to];
  const dir: Dir = to > current ? 1 : -1;
  current = to;
  busy = (async () => {
    const sameUnit = unitOf(from) === unitOf(target);
    const run = !still() && root.dataset.book !== undefined ? (effect ?? tear) : null;
    if (run) {
      // The slip that moves is drawn on top: the one leaving when going on,
      // the one arriving when going back.
      const top = dir === 1 ? from : target;
      top.classList.add("is-top");
      if (!sameUnit) {
        unitOf(from).classList.add("is-leaving");
        unitOf(top).classList.add("is-top");
        unitOf(target).classList.add("is-entering");
      }
      paintKeeping(to, from);
      // The folio changes with the head, as the arriving one wipes in.
      const folioAt = setTimeout(() => setFolio(to), 200);
      await run(from, target, dir).catch(() => {});
      clearTimeout(folioAt);
      for (const el of [from, target, unitOf(from), unitOf(target)]) el.classList.remove("is-top", "is-leaving");
      const entering = unitOf(target);
      setTimeout(() => entering.classList.remove("is-entering"), 900);
    }
    paint(to);
    history.replaceState(null, "", `#${anchorOf(target)}`);
    if (book.getBoundingClientRect().top < 0) book.scrollIntoView({ block: "start" });
    if (focus) headingOf(target).focus({ preventScroll: true });
    else live.textContent = describe(target);
    markIndex();
  })();
  await busy;
  busy = null;
  if (queued) {
    const q = queued;
    queued = null;
    await turn(q.to, q.focus);
  }
}

// During a turn both the leaf leaving and the one arriving are on show.
function paintKeeping(index: number, keep: HTMLElement) {
  paint(index);
  hide(keep, false);
  hide(unitOf(keep), false);
  setFolio(leaves.indexOf(keep));
}

function markIndex() {
  const article = articleOf(leaves[current]);
  for (const a of document.querySelectorAll<HTMLAnchorElement>(".index-list a"))
    a.hash === `#${article?.id}` ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current");
}

// "#v1-12-2", "#v1-12-2-p2", "#v1.12.2", "#1.12.2", "#index" and "#cover".
function leafFor(hash: string): number {
  let id = decodeURIComponent(hash.replace(/^#/, ""));
  if (/^v?\d+\.\d+\.\d+$/.test(id)) id = `v${id.replace(/^v/, "").replace(/\./g, "-")}`;
  const el = id ? document.getElementById(id) : null;
  if (!el) return -1;
  const leaf = el.closest<HTMLElement>(".leaf") ?? el.querySelector<HTMLElement>(".leaf");
  return leaf ? leaves.indexOf(leaf) : -1;
}

// The head script may already have set data-book, so the mode the reader is
// in is tracked here rather than read back from the attribute.
let inBook = false;

function enterBook() {
  inBook = true;
  root.dataset.book = "";
  root.dataset.reader = "";
  controls.hidden = false;
  const found = leafFor(location.hash);
  current = found >= 0 ? found : 0;
  paint(current);
  markIndex();
  if (found >= 0) {
    const target = location.hash === "#index" ? document.getElementById("index-title")! : headingOf(leaves[current]);
    target.focus({ preventScroll: true });
  }
}

function leaveBook() {
  inBook = false;
  folio.hidden = true;
  delete root.dataset.book;
  controls.hidden = true;
  for (const el of [...leaves, ...releases]) el.removeAttribute("hidden");
  const anchor = document.getElementById(anchorOf(leaves[current]));
  if (current > 0) anchor?.scrollIntoView({ block: "start" });
}

function syncMode() {
  if (wide.matches && !inBook) enterBook();
  else if (!wide.matches && inBook) leaveBook();
}

back.addEventListener("click", () => void turn(current - 1));
next.addEventListener("click", () => void turn(current + 1));

// In-page links (the index, the newest version, Index in the plate) turn the
// book instead of scrolling, and land focus on what they point at.
document.addEventListener("click", (e) => {
  if (root.dataset.book === undefined) return;
  const a = (e.target as Element).closest<HTMLAnchorElement>("main a[href^='#']");
  if (!a) return;
  const to = leafFor(a.hash);
  if (to < 0) return;
  e.preventDefault();
  if (a.hash === "#index") {
    void turn(0).then(() => document.getElementById("index-title")!.focus({ preventScroll: true }));
    history.replaceState(null, "", "#index");
  } else void turn(to, true);
});

addEventListener("hashchange", () => {
  if (root.dataset.book === undefined) return;
  const to = leafFor(location.hash);
  if (to >= 0) void turn(to, true);
});

// Keys belong to whatever has focus first: links, buttons, fields and the
// open menu keep theirs, and so does a screen reader's browse mode.
document.addEventListener("keydown", (e) => {
  if (root.dataset.book === undefined || e.defaultPrevented) return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (root.classList.contains("menu-locked")) return;
  const t = e.target as HTMLElement;
  if (t.closest("a, button, input, select, textarea, summary, [contenteditable]")) return;
  const step: Record<string, number> = {
    ArrowRight: current + 1,
    PageDown: current + 1,
    ArrowLeft: current - 1,
    PageUp: current - 1,
    Home: 0,
    End: leaves.length - 1,
  };
  if (!(e.key in step)) return;
  e.preventDefault();
  void turn(step[e.key]);
});

// Swipe, for touch screens wide enough for the book. Vertical scrolling stays
// native (touch-action: pan-y on the book).
let start: { x: number; y: number } | null = null;
book.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch" && root.dataset.book !== undefined) start = { x: e.clientX, y: e.clientY };
});
book.addEventListener("pointerup", (e) => {
  if (!start) return;
  const dx = e.clientX - start.x;
  const dy = e.clientY - start.y;
  start = null;
  if (Math.abs(dx) < 48 || Math.abs(dy) > Math.abs(dx) * Math.tan(Math.PI / 6)) return;
  void turn(current + (dx < 0 ? 1 : -1));
});
book.addEventListener("pointercancel", () => (start = null));
book.style.touchAction = "pan-y";

// Find in page opens the slip holding the match.
book.addEventListener("beforematch", (e) => {
  if (root.dataset.book === undefined) return;
  const el = e.target as HTMLElement;
  const leaf = el.closest<HTMLElement>(".leaf") ?? el.querySelector<HTMLElement>(".leaf");
  const to = leaf ? leaves.indexOf(leaf) : -1;
  if (to >= 0 && to !== current) {
    current = to;
    paint(to);
    history.replaceState(null, "", `#${anchorOf(leaf!)}`);
    markIndex();
  }
});

// The strip: a Next at the foot of every slip goes to the next release.
for (const [i, article] of releases.entries()) {
  const button = article.querySelector<HTMLButtonElement>(".rel-next")!;
  const target = releases[i + 1];
  if (!target) continue;
  button.hidden = false;
  button.addEventListener("click", async () => {
    const from = article.querySelector<HTMLElement>(".page:last-of-type")!;
    if (!still() && stripEffect) await stripEffect(from).catch(() => {});
    target.scrollIntoView({ block: "start", behavior: still() ? "auto" : "smooth" });
    target.querySelector<HTMLElement>(".rel-version")!.focus({ preventScroll: true });
    history.replaceState(null, "", `#${target.id}`);
  });
}

let stripEffect: ((slip: HTMLElement) => Promise<void>) | null = null;
export function useStripEffect(next: ((slip: HTMLElement) => Promise<void>) | null) {
  stripEffect = next;
}

wide.addEventListener("change", syncMode);
syncMode();

export const reader = { leaves, get current() { return current; }, turn, slipOf, still };
