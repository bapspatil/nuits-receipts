import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);
ScrollTrigger.config({ ignoreMobileResize: true });

// Every scrubbed tween starts from content that is already on screen and only
// moves it. Nothing waits at opacity 0 or fully clipped for a trigger, so a
// trigger that never fires leaves the page exactly as the static CSS drew it.
export function startReel(): () => void {
  const ctx = gsap.context(() => {
    const scraps = gsap.utils.toArray<HTMLElement>(".scrap");
    const scatter = document.querySelector<HTMLElement>(".scatter")!;
    // The scraps drift from where they were dropped on the desk into one
    // pile over the envelope, scrubbed by the scroll that carries it past.
    gsap.to(scraps, {
      left: "50%",
      xPercent: -50,
      top: (i) => `${4 + i * 7}%`,
      rotate: (i) => (i % 2 ? 1.5 : -1.5),
      ease: "none",
      scrollTrigger: { trigger: scatter, start: "top 85%", end: "bottom 35%", scrub: 0.6 },
    });

    // How it works: the stage holds, the rail tracks sideways under it.
    const how = document.querySelector<HTMLElement>(".how")!;
    const rail = how.querySelector<HTMLElement>(".rail")!;
    how.classList.add("is-reel");
    // A meter under the held title tracks the rail, so the pin reads as
    // progress through three steps rather than as the page getting stuck.
    const meter = document.createElement("div");
    meter.className = "how-meter";
    meter.setAttribute("aria-hidden", "true");
    how.querySelector(".how-title")!.after(meter);
    gsap
      .timeline({
        scrollTrigger: {
          trigger: how,
          start: "top top",
          end: () => `+=${innerHeight * 1.4}`,
          pin: true,
          scrub: 0.6,
          invalidateOnRefresh: true,
          anticipatePin: 1,
        },
      })
      .to({}, { duration: 0.25 })
      .to(rail, { x: () => -(rail.scrollWidth - how.clientWidth) - 1, ease: "none", duration: 1 })
      .fromTo(meter, { scaleX: 0.04 }, { scaleX: 1, ease: "none", duration: 1 }, "<")
      .to({}, { duration: 0.25 });

    // The ledger: rows already printed, stamps land one by one as you scroll.
    const ledger = document.querySelector<HTMLElement>(".ledger")!;
    const stamps = gsap.utils.toArray<HTMLElement>(".statement tbody .stamp");
    const foot = ledger.querySelector<HTMLElement>(".statement-foot")!;
    gsap
      .timeline({
        scrollTrigger: {
          trigger: ledger,
          start: "top top",
          end: () => `+=${innerHeight * 1.2}`,
          pin: true,
          scrub: 0.6,
          invalidateOnRefresh: true,
          anticipatePin: 1,
        },
      })
      .from(stamps, {
        scale: 1.9,
        rotate: -18,
        clipPath: "inset(0% 100% 0% 0%)",
        ease: "none",
        stagger: 0.18,
        duration: 0.3,
      })
      .from(foot, { x: -24, ease: "none", duration: 0.3 }, "<0.1")
      .to({}, { duration: 0.4 });

    ScrollTrigger.refresh();
  });

  document.fonts.ready.then(() => ScrollTrigger.refresh());

  return () => {
    ctx.revert();
    document.querySelector(".how")?.classList.remove("is-reel");
    document.querySelector(".how-meter")?.remove();
  };
}
