import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { Pile, PileState } from "./pile";

gsap.registerPlugin(ScrollTrigger);
ScrollTrigger.config({ ignoreMobileResize: true });

// Clip regions for the beats. The visible one sits outside the box on every
// side (wipe.css explains why), so display type and focus rings are never cut.
const SHOW = "inset(-20% -8% -20% -8%)";
const BELOW = "inset(120% -8% -20% -8%)";
const ABOVE = "inset(-20% -8% 120% -8%)";

// Runs only with motion on. Every scrubbed tween either moves content that is
// already painted or wipes a beat that the static page shows in full, so a
// trigger that never fires leaves the page as the CSS drew it.
export function startReel(narrow: boolean): () => void {
  const section = document.querySelector<HTMLElement>(".reel")!;
  const stage = section.querySelector<HTMLElement>(".reel-stage")!;
  const canvas = stage.querySelector<HTMLCanvasElement>(".pile")!;
  const beats = gsap.utils.toArray<HTMLElement>(".beat", stage);
  const query = stage.querySelector<HTMLElement>(".query")!;
  const queryText = query.querySelector<HTMLElement>(".query-text")!;
  const word = queryText.textContent ?? "";
  const found = stage.querySelector<HTMLElement>(".slip-found")!;

  section.classList.add("is-reel");

  // The one state object the pile reads. The timeline writes it, the ticker
  // draws it, and nothing draws when nothing changed.
  const state: PileState = { arrive: 0, read: 0, file: 0, find: 0, pull: 0 };
  // scripts/shoot-pile.mjs renders the filed still from this state.
  if (new URLSearchParams(location.search).get("pile") === "filed") Object.assign(state, { arrive: 1, read: 1, file: 1, find: 1 });
  let pile: Pile | null = null;
  let dirty = true;
  let disposed = false;
  const tick = () => {
    if (!pile || !dirty) return;
    dirty = false;
    pile.render();
  };
  gsap.ticker.add(tick);

  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (!nav.connection?.saveData && (nav.deviceMemory ?? 8) >= 4) {
    import("./pile")
      .then(({ createPile }) => document.fonts.ready.then(() => createPile))
      .then((createPile) => {
        if (disposed) return;
        pile = createPile(canvas, stage, state, narrow);
        if (!pile) return;
        pile.render();
        // Shown only once a real frame exists; any failure keeps the still.
        canvas.dataset.ready = "";
        canvas.addEventListener("webglcontextlost", fail, { once: true });
      })
      .catch(fail);
  }
  function fail() {
    pile?.dispose();
    pile = null;
    delete canvas.dataset.ready;
  }

  const ctx = gsap.context(() => {
    gsap.set(beats.slice(1), { clipPath: BELOW, y: 48 });
    queryText.textContent = "";
    gsap.set(found, { clipPath: "inset(-12% -12% 112% -12%)" });

    const swap = (from: number, to: number) =>
      gsap
        .timeline()
        .to(beats[from], { y: -48, clipPath: ABOVE, duration: 0.3, ease: "power2.in" })
        .fromTo(beats[to], { y: 48, clipPath: BELOW }, { y: 0, clipPath: SHOW, duration: 0.35, ease: "power2.out" }, "<0.15");

    const typed = { n: 0 };
    gsap
      .timeline({
        defaults: { ease: "none" },
        onUpdate: () => {
          dirty = true;
        },
        scrollTrigger: {
          trigger: section,
          start: "top top",
          end: () => `+=${innerHeight * (narrow ? 4.4 : 5.2)}`,
          pin: true,
          scrub: 0.6,
          invalidateOnRefresh: true,
          anticipatePin: 1,
          // Wherever the reader stops, the stage settles on the nearest beat,
          // so no frame is left with a heading half wiped.
          snap: { snapTo: "labelsDirectional", duration: { min: 0.25, max: 0.7 }, delay: 0.15, ease: "power2.inOut" },
          onRefresh: () => {
            pile?.resize();
          },
        },
      })
      .addLabel("hero")
      .to({}, { duration: 0.45 })
      .add(swap(0, 1))
      .to(state, { arrive: 1, duration: 1 }, "<0.1")
      .addLabel("comes-in")
      .to({}, { duration: 0.25 })
      .add(swap(1, 2))
      .to(state, { read: 1, duration: 1 }, "<0.1")
      .addLabel("read")
      .to({}, { duration: 0.25 })
      .add(swap(2, 3))
      .set(stage, { attr: { "data-still": "filed" } }, "<0.2")
      .to(state, { file: 1, duration: 1.4 }, "<")
      .addLabel("filed")
      .to({}, { duration: 0.25 })
      .add(swap(3, 4))
      .fromTo(
        typed,
        { n: 0 },
        {
          n: word.length,
          duration: 0.5,
          onUpdate: () => {
            queryText.textContent = word.slice(0, Math.round(typed.n));
            query.classList.toggle("is-done", typed.n >= word.length);
          },
        },
      )
      .to(state, { find: 1, duration: 0.7 })
      .to(state, { pull: 1, duration: 0.7 })
      .to(found, { clipPath: "inset(-12% -12% -12% -12%)", duration: 0.2, ease: "power2.out" })
      .addLabel("found")
      .to({}, { duration: 0.5 });

    // Month end: the statement's stamps land row by row as it comes up.
    const stamps = gsap.utils.toArray<HTMLElement>(".statement tbody .stamp");
    gsap.from(stamps, {
      scale: 1.9,
      rotate: -18,
      clipPath: "inset(0% 100% 0% 0%)",
      ease: "power2.out",
      stagger: 0.12,
      scrollTrigger: { trigger: ".statement", start: "top 75%", end: "bottom 55%", scrub: 0.6 },
    });

    // The app: each screen sinks a little as the next one slides over it,
    // like paper laid on paper. The stack itself is CSS sticky, so it holds
    // without this.
    const cards = gsap.utils.toArray<HTMLElement>(".deck .card");
    cards.slice(0, -1).forEach((card, i) => {
      gsap.to(card.querySelector("figure"), {
        scale: 0.92,
        rotate: i % 2 ? 0.8 : -0.8,
        ease: "none",
        scrollTrigger: { trigger: cards[i + 1], start: "top bottom", end: "top 30%", scrub: 0.6 },
      });
    });

    // Phones ride at three speeds past the copy.
    gsap.utils.toArray<HTMLElement>(".phones li").forEach((phone, i) => {
      gsap.fromTo(
        phone,
        { yPercent: [10, 22, 4][i] ?? 0 },
        {
          yPercent: [-6, -14, -2][i] ?? 0,
          ease: "none",
          scrollTrigger: { trigger: ".pocket", start: "top bottom", end: "bottom top", scrub: 0.6 },
        },
      );
    });
  });

  const onResize = () => {
    pile?.resize();
    dirty = true;
  };
  addEventListener("resize", onResize);
  document.fonts.ready.then(() => ScrollTrigger.refresh());

  return () => {
    disposed = true;
    removeEventListener("resize", onResize);
    gsap.ticker.remove(tick);
    ctx.revert();
    fail();
    queryText.textContent = word;
    query.classList.remove("is-done");
    section.classList.remove("is-reel");
    stage.removeAttribute("data-still");
  };
}
