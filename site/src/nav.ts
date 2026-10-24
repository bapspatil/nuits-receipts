// Manners for the narrow menu, which already opens and closes natively. Home
// page only: the privacy page and the 404 run no script and keep the bare
// disclosure.
const menu = document.querySelector<HTMLDetailsElement>(".menu");
if (menu) {
  const summary = menu.querySelector("summary")!;
  menu.addEventListener("click", (e) => {
    if ((e.target as Element).closest(".menu-panel a")) menu.open = false;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !menu.open) return;
    menu.open = false;
    summary.focus();
  });
  document.addEventListener("click", (e) => {
    if (menu.open && !menu.contains(e.target as Node)) menu.open = false;
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
