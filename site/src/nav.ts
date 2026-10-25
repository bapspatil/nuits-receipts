// The full-screen menu. It is a native <details>, so it opens and closes with
// no script on every page; this adds the manners: an animated close, a locked
// page, a focus trap, Escape, and closing before an in-page jump.
const menu = document.querySelector<HTMLDetailsElement>(".menu");
if (menu) {
  const root = document.documentElement;
  const summary = menu.querySelector("summary")!;
  const bar = menu.closest<HTMLElement>(".bar")!;
  const others = () => [...document.body.children].filter((el) => el !== bar) as HTMLElement[];
  const still = () =>
    root.dataset.motion === "off" ||
    (!root.dataset.motion && matchMedia("(prefers-reduced-motion: reduce)").matches);
  // --menu-hold plus --menu-out in src/styles/chrome.css.
  const closeMs = () => (still() ? 0 : 140 + 440);
  let closing: Promise<void> | null = null;

  root.classList.add("menu-js");
  summary.setAttribute("aria-expanded", "false");

  const opened = () => {
    summary.setAttribute("aria-expanded", "true");
    if (!root.classList.contains("menu-locked"))
      root.style.setProperty("--menu-gutter", `${innerWidth - root.clientWidth}px`);
    root.classList.add("menu-locked");
    for (const el of others()) el.inert = true;
  };

  const closed = () => {
    delete menu.dataset.closing;
    summary.setAttribute("aria-expanded", "false");
    root.classList.remove("menu-locked");
    for (const el of others()) el.inert = false;
  };

  const open = () => {
    if (menu.open) return;
    menu.open = true;
    opened();
  };

  const close = (): Promise<void> => {
    if (!menu.open) return Promise.resolve();
    if (closing) return closing;
    menu.dataset.closing = "";
    closing = new Promise<void>((done) =>
      setTimeout(() => {
        menu.open = false;
        closed();
        closing = null;
        done();
      }, closeMs()),
    );
    return closing;
  };

  summary.addEventListener("click", (e) => {
    e.preventDefault();
    if (menu.open && !closing) void close();
    else if (!menu.open) open();
  });

  // Something else opened or closed it (find-in-page, a test): keep in step.
  menu.addEventListener("toggle", () => (menu.open ? opened() : closed()));

  menu.addEventListener("click", (e) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>(".menu-panel a");
    if (!a) return;
    const here = a.origin === location.origin && a.pathname === location.pathname && a.hash;
    const target = here ? document.getElementById(decodeURIComponent(a.hash.slice(1))) : null;
    if (!target) {
      // Another page: let it navigate, and leave the menu shut behind it for
      // the back button.
      setTimeout(() => {
        menu.open = false;
        closed();
      }, 0);
      return;
    }
    e.preventDefault();
    void close().then(() => {
      history.pushState(null, "", a.hash);
      target.scrollIntoView({ behavior: still() ? "auto" : "smooth", block: "start" });
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    });
  });

  document.addEventListener("keydown", (e) => {
    if (!menu.open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      void close().then(() => summary.focus());
      return;
    }
    if (e.key !== "Tab") return;
    // The rest of the page is inert; this keeps Tab cycling inside the bar
    // and the sheet instead of leaving for the browser chrome.
    const stops = [...bar.querySelectorAll<HTMLElement>("a[href], button:not([hidden]), summary")].filter(
      (el) => el.offsetParent !== null || el === summary,
    );
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

// Scroll spy: the section owning the middle band of the viewport marks its
// links in all three lists.
const links = new Map<string, HTMLAnchorElement[]>();
for (const a of document.querySelectorAll<HTMLAnchorElement>('.nav-link[href^="/#"]')) {
  const id = a.hash.slice(1);
  links.set(id, [...(links.get(id) ?? []), a]);
}
const sections = [...links.keys()].flatMap((id) => document.getElementById(id) ?? []);
const visible = new Set<string>();
const spy = new IntersectionObserver(
  (entries) => {
    for (const e of entries) e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id);
    const current = sections.find((s) => visible.has(s.id))?.id;
    for (const [id, as] of links)
      for (const a of as) id === current ? a.setAttribute("aria-current", "location") : a.removeAttribute("aria-current");
  },
  { rootMargin: "-45% 0px -45% 0px" },
);
for (const s of sections) spy.observe(s);

// Page links (Changelog, Privacy) mark the page they point at.
for (const a of document.querySelectorAll<HTMLAnchorElement>(".nav-page .nav-link"))
  if (a.origin === location.origin && a.pathname === location.pathname && !a.hash) a.setAttribute("aria-current", "page");
