// The second motion layer: split-word heading wipes, draw-on illustrations,
// ambient loops that pause off screen and the export morph.
// Loaded after first paint, so none of it is on the path to the LCP.
//
// Everything here starts from content that is already painted. A heading is
// only split into hidden words once it is about to enter the viewport, and the
// wipe then runs to the end on its own clock; a trigger that never fires
// leaves the heading exactly as the static CSS drew it.
export type Motion = { setAnimated(on: boolean): void };

const NEAR = "0px 0px 6% 0px";

// Wraps each word of a heading's own text in a span, keeping the spaces as
// text nodes between them. The heading still reads as one run of real text to
// a screen reader, so no aria-label is needed, and inline-block words wrap
// exactly where the words did.
function splitWords(el: HTMLElement) {
  if (el.dataset.split !== undefined) return;
  el.dataset.split = "";
  let i = 0;
  for (const node of [...el.childNodes]) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const frag = document.createDocumentFragment();
    for (const part of node.textContent!.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        frag.append(" ");
        continue;
      }
      const w = document.createElement("span");
      w.className = "w";
      w.style.setProperty("--w", String(i++));
      w.textContent = part;
      frag.append(w);
    }
    node.replaceWith(frag);
  }
}

function onceNear(targets: Iterable<Element>, run: (el: HTMLElement) => void, rootMargin = NEAR) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        run(e.target as HTMLElement);
      }
    },
    { rootMargin },
  );
  for (const t of targets) io.observe(t);
  return io;
}

export function startMotion(initial: boolean): Motion {
  let animated = initial;
  let morph: { play(): void; pause(): void; reset(): void } | null = null;

  // Typography: section titles wipe in word by word just before they arrive.
  // The close title is split too, for its scroll-linked settle in motion.css.
  const titles = document.querySelectorAll<HTMLElement>(".scene .title, .close-title");
  titles.forEach(splitWords);
  onceNear(titles, (el) => {
    if (!animated || el.classList.contains("close-title")) return;
    el.classList.add("is-revealing");
  });

  // Illustrations draw their strokes on as they arrive. Fills are painted the
  // whole time, so a half-drawn icon is never an empty box.
  onceNear(document.querySelectorAll(".ill:not(.ill-seal)"), (el) => {
    if (animated) el.classList.add("is-drawing");
  });

  // Ambient loops run only while their element is on screen.
  const loops = new IntersectionObserver((entries) => {
    for (const e of entries) {
      (e.target as HTMLElement).toggleAttribute("data-offscreen", !e.isIntersecting);
      if (e.target.classList.contains("ill-export")) e.isIntersecting && animated ? morph?.play() : morph?.pause();
    }
  });
  document.querySelectorAll("[data-loop], .ill-export").forEach((el) => loops.observe(el));

  // The export icon's arrow turns into a tick and back, and its base line
  // fades while the tick shows: exported, ready.
  // GSAP and MorphSVG load only once the close is near and motion is on.
  const exportIcon = document.querySelector<SVGSVGElement>(".ill-export");
  let morphLoading = false;
  async function loadMorph() {
    if (morphLoading || !exportIcon) return;
    morphLoading = true;
    const [{ gsap }, { MorphSVGPlugin }] = await Promise.all([import("gsap"), import("gsap/MorphSVGPlugin")]);
    gsap.registerPlugin(MorphSVGPlugin);
    const [arrow, base] = exportIcon.querySelectorAll<SVGPathElement>(".export-glyph path");
    const tween = { duration: 0.45, ease: "power2.inOut" };
    const tl = gsap
      .timeline({ repeat: -1, repeatDelay: 2.4, delay: 0.9, paused: true })
      .to(arrow, { morphSVG: "M35.4 47.6l1.1-1.1 4.5 4.5 7.9-8.9 1.1 1-9 10.1z", ...tween })
      .to(base, { opacity: 0, ...tween }, "<")
      .to(arrow, { morphSVG: arrow.getAttribute("d")!, ...tween }, "+=2.4")
      .to(base, { opacity: 1, ...tween }, "<");
    morph = { play: () => tl.play(), pause: () => tl.pause(), reset: () => tl.pause(0) };
    if (animated && !exportIcon.hasAttribute("data-offscreen")) morph.play();
  }

  // Both stay observed, so turning motion on later still starts them.
  const nearHosts = new Set<Element>();
  const near = new IntersectionObserver(
    (entries) => {
      for (const e of entries) e.isIntersecting ? nearHosts.add(e.target) : nearHosts.delete(e.target);
      loadIfNear();
    },
    { rootMargin: "50% 0px" },
  );
  function loadIfNear() {
    if (!animated) return;
    if (exportIcon && nearHosts.has(exportIcon)) void loadMorph();
  }
  if (exportIcon) near.observe(exportIcon);

  return {
    setAnimated(on) {
      animated = on;
      if (!on) morph?.reset();
      if (!on) document.querySelectorAll(".is-revealing, .is-drawing").forEach((el) => el.classList.remove("is-revealing", "is-drawing"));
      loadIfNear();
    },
  };
}
