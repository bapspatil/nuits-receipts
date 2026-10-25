// Renders the changelog comic as static HTML: every release is an <article>,
// every page of it a receipt slip of panels. Pure, so it can be tested without
// a build: releases (from scripts/changelog-parse.mjs) in, HTML strings out.
//
// The rules live here so a new release needs no hand layout: panel size comes
// from text length, a slip holds at most four panel units and 560 characters,
// and sections run on in order across slips.

export const SITE = "https://receipts.nuits.net";
export const PAGE_URL = `${SITE}/changelog/`;

const MAX_UNITS = 4;
const MAX_CHARS = 560;

// What each kind of change looks like. The stamp word is what a reader sees;
// the sound word is decoration, hidden from assistive tech.
export const KINDS = {
  breaking: { stamp: "Breaking", sfx: "KRAK" },
  features: { stamp: "New", sfx: "KA-CHUNK" },
  ui: { stamp: "Restyled", sfx: "SHFF" },
  hotfixes: { stamp: "Fixed", sfx: "TAK" },
  fixes: { stamp: "Fixed", sfx: "TAK" },
  docs: { stamp: "Docs", sfx: "FLIP" },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const escapeHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const formatDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

// The inline markdown CHANGELOG.md uses: `code`, **bold** and [text](url).
// Text is escaped first, so nothing in an entry can become markup by accident.
export function inline(text) {
  const codes = [];
  let s = escapeHtml(text).replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

const plain = (text) => text.replace(/`|\*\*/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

export const sizeOf = (text) => {
  const n = plain(text).length;
  return n <= 80 ? "s" : n <= 160 ? "m" : "l";
};

// Splits one release into slips. Items keep their order; a section that does
// not fit runs on to the next slip, where its stamp repeats as "cont.".
export function paginate(release) {
  const items = [
    ...release.intro.map((text) => ({ kind: "intro", section: null, entry: { text, scope: null, label: null, pr: null } })),
    ...release.sections.flatMap((section, s) =>
      section.entries.map((entry) => ({ kind: section.kind, section: s, entry })),
    ),
  ].map((item) => {
    const size = sizeOf(item.entry.text);
    return { ...item, size, units: size === "l" ? 2 : 1, chars: plain(item.entry.text).length };
  });
  const fill = (maxUnits) => {
    const pages = [];
    let page = null;
    for (const { units, chars, ...item } of items) {
      if (!page || (page.items.length && (page.units + units > maxUnits || page.chars + chars > MAX_CHARS))) {
        page = { items: [], units: 0, chars: 0 };
        pages.push(page);
      }
      page.items.push(item);
      page.units += units;
      page.chars += chars;
    }
    return pages;
  };
  // Fill greedily to learn how many slips it takes, then share the panels
  // out evenly across that many, so no slip is left holding one orphan line.
  let pages = fill(MAX_UNITS);
  const total = items.reduce((n, it) => n + it.units, 0);
  for (let target = Math.ceil(total / pages.length); pages.length > 1 && target < MAX_UNITS; target++) {
    const even = fill(target);
    if (even.length === pages.length) {
      pages = even;
      break;
    }
  }
  return pages.length ? pages : [{ items: [], units: 0, chars: 0 }];
}

// Column spans on a six-column panel grid. A long panel takes the row; two
// shorter ones share it, the longer of the pair taking two thirds when it is
// at least twice as long, so slips vary without hand layout.
export function spans(items) {
  const out = [];
  let i = 0;
  while (i < items.length) {
    const a = items[i];
    const b = items[i + 1];
    if (a.size === "l" || !b || b.size === "l") {
      out.push(6);
      i += 1;
      continue;
    }
    const la = plain(a.entry.text).length;
    const lb = plain(b.entry.text).length;
    out.push(...(la > lb * 2 ? [4, 2] : lb > la * 2 ? [2, 4] : [3, 3]));
    i += 2;
  }
  return out;
}

// The impact art is drawn per entry, not per kind: a hash of the entry text
// places the focus point, the cut of the tone and the sound word's tilt, so
// two slips of the same kind never print alike, and a rebuild prints the same.
// Advance widths (em) of the version figures in Bricolage 800 at display
// tracking, so CSS can set each version as large as its column allows.
const ADVANCE = { 0: 0.438, 1: 0.227, 2: 0.42, 3: 0.42, 4: 0.46, 5: 0.425, 6: 0.448, 7: 0.368, 8: 0.445, 9: 0.444, ".": 0.154 };
export const fit = (version) => [...version].reduce((w, c) => w + (ADVANCE[c] ?? 0.45), 0).toFixed(2);

const SPLASH = ["stack", "flip", "inset"];

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}

export function seed(text) {
  const h = hash(text);
  const pick = (lo, hi, shift) => lo + (((h >>> shift) & 255) / 255) * (hi - lo);
  const tilt = pick(3, 9, 16) * ((h & 1) === 0 ? -1 : 1);
  const flip = (h >>> 5) & 1 ? -1 : 1;
  return (
    `--fx:${pick(38, 62, 0).toFixed(0)}%;--fy:${pick(44, 66, 8).toFixed(0)}%;--cut:${pick(4, 40, 24).toFixed(0)}%;` +
    `--tilt:${tilt.toFixed(1)}deg;--flip:${flip};--sx:${pick(4, 46, 12).toFixed(0)}%;--gap:${pick(3.2, 5.2, 20).toFixed(1)}deg;--w:${pick(0.5, 1.3, 2).toFixed(2)}deg`
  );
}

// Props are line art by scope or label (src/assets/svg/props/); a ui entry
// gets the generic ledger.
const PROP_ALIAS = { ui: "ledger" };

function panel(item, span, withSfx, props = {}) {
  const { entry, kind } = item;
  const scope = entry.scope ? `<span class="scope">${escapeHtml(entry.scope)}</span>` : "";
  const pr = entry.pr ? ` <span class="pr">(#${entry.pr})</span>` : "";
  // The sound word sits in an impact frame: the tone corner of a panel, or,
  // on a splash slip, a panel of its own under the caption.
  const prop = entry.scope ?? entry.label?.toLowerCase().split(" ")[0] ?? "";
  const art = props[PROP_ALIAS[prop] ?? prop];
  const sfx =
    withSfx && KINDS[kind]
      ? `<span class="impact" aria-hidden="true" style="${seed(entry.text)}">` +
        (art ? `<span class="prop">${art}</span>` : "") +
        `<span class="sfx">${KINDS[kind].sfx}</span></span>`
      : "";
  return (
    `<li class="panel" data-kind="${kind}" data-size="${item.size}" data-span="${span}"${prop ? ` data-prop="${escapeHtml(prop)}"` : ""}>` +
    `<div class="caption">${scope}<p class="panel-text">${inline(entry.text)}${pr}</p></div>${sfx}</li>`
  );
}

// How much of a slip's height a section takes in the book: by its text, so a
// short line does not get the same panel as a long one.
const weight = (items) => items.reduce((n, it) => n + Math.max(1, it.entry.text.length / 90), 0).toFixed(2);

function pageHtml(release, pages, index, position, props) {
  const page = pages[index];
  const count = pages.length;
  const id = `${release.slug}-p${index + 1}`;
  const groups = [];
  for (const item of page.items) {
    const last = groups[groups.length - 1];
    if (last && last.section === item.section && last.kind === item.kind) last.items.push(item);
    else groups.push({ section: item.section, kind: item.kind, items: [item] });
  }
  const body = groups
    .map((g, gi) => {
      const span = spans(g.items);
      const panels = g.items.map((it, i) => panel(it, span[i], i === 0, props)).join("");
      if (g.kind === "intro") return `<ul class="panels" data-kind="intro">${panels}</ul>`;
      const section = release.sections[g.section];
      const kind = KINDS[g.kind] ?? { stamp: section.title.split(" ")[0] };
      const continued = index > 0 && gi === 0 && pages[index - 1].items.some((it) => it.section === g.section);
      return (
        `<div class="sec" data-kind="${g.kind}" style="--units:${weight(g.items)}">` +
        `<h3 class="vh">${escapeHtml(section.title)}</h3>` +
        `<span class="stamp cl-stamp" data-kind="${g.kind}" aria-hidden="true">${escapeHtml(kind.stamp)}${continued ? ' <span class="cont">cont.</span>' : ""}</span>` +
        `<ul class="panels">${panels}</ul></div>`
      );
    })
    .join("");
  const label = count > 1 ? ` aria-label="${escapeHtml(release.version)}, page ${index + 1} of ${count}"` : "";
  // A slip with one entry is a splash page, composed one of three ways (the
  // caption over the impact, under it, or inset in it), in turn down the book.
  const lone = page.items.length === 1 && page.items[0].kind !== "intro" ? page.items[0] : null;
  const splash = lone ? ` data-splash="${SPLASH[position % SPLASH.length]}"` : "";
  return `<section class="page leaf slip" id="${id}" data-page="${index + 1}" data-units="${page.units}"${splash}${label}>${body}</section>`;
}

// The kinds in a release with their counts, as stamps: the release's tally.
function tally(release) {
  const counts = new Map();
  for (const section of release.sections) {
    const word = (KINDS[section.kind] ?? { stamp: section.title.split(" ")[0] }).stamp;
    const key = `${section.kind}:${word}`;
    counts.set(key, (counts.get(key) ?? 0) + section.entries.length);
  }
  return [...counts].map(([key, n]) => {
    const [kind, word] = key.split(":");
    return `<li><span class="stamp cl-chip" data-kind="${kind}">${escapeHtml(word)}</span> <span class="tally-n">${n}</span></li>`;
  });
}

export function renderRelease(release, position = 0, props = {}) {
  const pages = paginate(release);
  const date = release.date
    ? `<p class="rel-date"><time datetime="${release.date}">${formatDate(release.date)}</time></p>`
    : "";
  const kinds = [...new Set(release.sections.map((s) => s.kind))];
  const marks = tally(release);
  return (
    `<article class="release" id="${release.slug}" aria-labelledby="${release.slug}-h" data-kind="${kinds[0] ?? "other"}">` +
    `<header class="rel-head"><h2 class="rel-version" id="${release.slug}-h" tabindex="-1" style="--fit:${fit(release.version)}">${escapeHtml(release.version)}</h2>${date}` +
    (marks.length ? `<ul class="rel-tally">${marks.join("")}</ul>` : "") +
    `</header>` +
    `<div class="rel-pages">${pages.map((_, i) => pageHtml(release, pages, i, position + i, props)).join("")}</div>` +
    `<p class="rel-foot"><a class="rel-link" href="${escapeHtml(release.releaseUrl)}">Release</a>` +
    `<button class="rel-next" type="button" hidden>Next</button></p>` +
    `</article>`
  );
}

// The index groups releases under the day they shipped, each with the
// stamps of the kinds of change it carries.
export function renderIndex(releases) {
  if (!releases.length) return `<p class="empty">No releases yet.</p>`;
  const days = [];
  for (const r of releases) {
    const last = days[days.length - 1];
    if (last && last.date === r.date) last.releases.push(r);
    else days.push({ date: r.date, releases: [r] });
  }
  return (
    `<ol class="index-list">` +
    days
      .map(
        (d) =>
          `<li class="index-day">` +
          (d.date ? `<h3 class="index-date"><time datetime="${d.date}">${formatDate(d.date)}</time></h3>` : "") +
          `<ol>` +
          d.releases
            .map((r) => {
              const kinds = [...new Map(r.sections.map((s) => [KINDS[s.kind]?.stamp ?? s.title.split(" ")[0], s.kind]))];
              const chips = kinds.map(([word, kind]) => ` <span class="stamp cl-chip" data-kind="${kind}">${escapeHtml(word)}</span>`).join("");
              return `<li><a href="#${r.slug}"><span class="index-v">${escapeHtml(r.version)}</span>${chips}</a></li>`;
            })
            .join("") +
          `</ol></li>`,
      )
      .join("") +
    `</ol>`
  );
}

// props: prop name to inline SVG markup, for the props that exist.
export function renderBook(releases, props = {}) {
  if (!releases.length) return `<p class="empty">No releases yet.</p>`;
  let position = 0;
  return releases
    .map((release) => {
      const html = renderRelease(release, position, props);
      position += paginate(release).length;
      return html;
    })
    .join("\n");
}

export function renderLatest(releases) {
  return releases[0] ? escapeHtml(releases[0].version) : "";
}

export function renderJsonLd(releases) {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        name: "Nuits Receipts changelog",
        url: PAGE_URL,
        inLanguage: "en",
        mainEntity: {
          "@type": "ItemList",
          itemListElement: releases.map((r, i) => ({
            "@type": "ListItem",
            position: i + 1,
            item: {
              "@type": "CreativeWork",
              name: r.version,
              ...(r.date ? { datePublished: r.date } : {}),
              url: `${PAGE_URL}#${r.slug}`,
              isBasedOn: r.releaseUrl,
            },
          })),
        },
      },
      {
        "@type": "SoftwareSourceCode",
        name: "Nuits Receipts",
        codeRepository: "https://github.com/bapspatil/nuits-receipts",
        ...(releases[0] ? { version: releases[0].version } : {}),
        license: "https://www.apache.org/licenses/LICENSE-2.0",
      },
    ],
  };
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

// Screentone: 3px squares on a 6px grid, the same cell as the dot-matrix ink
// print, in inkSoft from tokens.json. 25% is one square per cell, 50% two.
export function renderTones(inkSoft) {
  const tile = (rects) =>
    `url("data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='6' height='6' shape-rendering='crispEdges' fill='${inkSoft}'>${rects}</svg>`,
    )}")`;
  return (
    `<style>:root{--tone-25:${tile("<rect width='3' height='3'/>")};` +
    `--tone-50:${tile("<rect width='3' height='3'/><rect x='3' y='3' width='3' height='3'/>")}}</style>`
  );
}
