// Renders the changelog as an open manga book: one spread per release, the
// art on the left page and the notes on the right, newest first. Pure, like
// changelog-render.mjs: releases, the art config (changelog/art.json) and the
// art manifest (public/changelog-art/manifest.json) in, HTML strings out.
//
// Every spread is real HTML in the page. Only the newest is shown without
// JavaScript; the others are reachable by their #x.y.z anchor (CSS :target)
// and from the All releases list, so crawlers and readers without scripts get
// every word. Art for a hidden spread is loading="lazy", so the browser never
// fetches it until src/changelog.ts shows that spread.
import { KINDS, escapeHtml, formatDate, inline } from "./changelog-render.mjs";

export const ART_BASE = "/changelog-art/";
const MAX_BULLETS = 5;

const plain = (text) => text.replace(/`|\*\*/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

export const kindOf = (release) => release.sections[0]?.kind ?? "other";

export function titleOf(release, titles = {}) {
  if (titles[release.version]) return titles[release.version];
  const first = release.sections[0]?.entries[0]?.text ?? release.intro[0] ?? `Release ${release.version}`;
  let t = plain(first).replace(/\s*\(#\d+\)\s*$/, "").trim();
  if (t.length > 60) t = `${t.slice(0, 60).replace(/[\s,;:]+\S*$/, "")}...`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// The art a release gets: its strip when there is one, else the SLIP card for
// its kind of change.
export function artOf(release, art, manifest) {
  const strip = art.strips?.[release.version];
  if (strip && manifest.strips?.[release.version]) {
    return { type: "strip", name: `strip-${release.version}`, alt: strip.alt, overlay: strip.overlay ?? [], ...manifest.strips[release.version] };
  }
  const kind = kindOf(release);
  const mood = art.cards.byKind[kind] ?? art.cards.byKind.other;
  const sfx = art.cards.sfx[kind] ?? art.cards.sfx.other;
  return { type: "card", name: `card-${mood}`, mood, alt: art.cards.panels[mood].alt, sfx, ...manifest.cards[mood] };
}

// Phones get the 640 px strip; the book on a wide screen the full one. The
// same rule is in src/changelog.ts (artUrl), which prefetches neighbours.
export const SMALL_MEDIA = "(max-width: 63.99rem), (max-height: 37.49rem)";
function picture(a, eager) {
  const src = `${ART_BASE}${a.name}`;
  const loading = eager ? ` fetchpriority="high"` : ` loading="lazy"`;
  const small = a.small ? `<source type="image/avif" media="${SMALL_MEDIA}" srcset="${src}-${a.small}.avif"><source type="image/webp" media="${SMALL_MEDIA}" srcset="${src}-${a.small}.webp">` : "";
  return (
    `<picture class="art-pic">${small}` +
    `<source type="image/avif" srcset="${src}.avif">` +
    `<img class="art-img" src="${src}.webp" width="${a.width}" height="${a.height}" alt="${escapeHtml(a.alt)}" decoding="async"${loading} style="background-image:url(${a.blur})">` +
    `</picture>`
  );
}

// Overlay items over a strip, x and y in percent of the art (the item's
// centre), r in degrees, s a size factor, w a width in percent (bubbles).
// sfx: a crimson sound word. bubble: words for an empty speech bubble.
// tag: a small ink label on the art, like a panel caption.
const OVERLAY = new Set(["sfx", "bubble", "tag"]);
function overlay(items) {
  return items
    .filter((o) => OVERLAY.has(o.type) && o.text)
    .map((o) => {
      const style = [`--x:${o.x}%`, `--y:${o.y}%`, `--r:${o.r ?? 0}deg`, o.s ? `--s:${o.s}` : "", o.w ? `--w:${o.w}%` : ""].filter(Boolean).join(";");
      return `<span class="ov ov-${o.type}" style="${style}">${escapeHtml(o.text)}</span>`;
    })
    .join("");
}

function artPage(release, a, eager) {
  if (a.type === "strip") {
    return (
      `<figure class="page page-art" data-art="strip"><span class="art-box">${picture(a, eager)}` +
      (a.overlay.length ? `<span class="ov-layer" aria-hidden="true">${overlay(a.overlay)}</span>` : "") +
      `</span></figure>`
    );
  }
  // A one-panel card: the SLIP mood for the kind of change, the version set
  // big behind it and the sound word over the panel corner.
  return (
    `<figure class="page page-art" data-art="card" data-mood="${a.mood}">` +
    `<span class="card-v" aria-hidden="true">${escapeHtml(release.version)}</span>` +
    `<span class="card-frame">${picture(a, eager)}` +
    `<span class="ov-layer" aria-hidden="true"><span class="ov ov-sfx" style="--x:78%;--y:12%;--r:-8deg">${escapeHtml(a.sfx)}</span></span></span>` +
    `</figure>`
  );
}

function fullNotes(release) {
  const sections = release.sections
    .map(
      (s) =>
        `<h4 class="full-h">${escapeHtml(s.title)}</h4><ul class="full-list">` +
        s.entries
          .map((e) => {
            const scope = e.scope ? `<span class="scope">${escapeHtml(e.scope)}</span> ` : "";
            const pr = e.pr ? ` <span class="pr">(#${e.pr})</span>` : "";
            return `<li>${scope}${inline(e.text)}${pr}</li>`;
          })
          .join("") +
        `</ul>`,
    )
    .join("");
  const intro = release.intro.map((t) => `<p>${inline(t)}</p>`).join("");
  return (
    `<details class="full"><summary class="btn btn-primary">Read full notes</summary><div class="full-body">${intro}${sections}` +
    `<p><a href="${escapeHtml(release.releaseUrl)}">Release ${escapeHtml(release.version)} on GitHub</a></p></div></details>`
  );
}

// The copy-link action is an icon; "Copied" shows beside it after a click.
const LINK_ICON =
  `<svg class="icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L12 5.6M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;

export function renderSpread(release, index, art, manifest) {
  const a = artOf(release, art, manifest);
  const v = escapeHtml(release.version);
  const entries = release.sections.flatMap((s) => s.entries);
  const bullets = (entries.length ? entries : release.intro.map((text) => ({ text })))
    .slice(0, MAX_BULLETS)
    .map((e) => `<li>${inline(e.text.replace(/\s*\(#\d+\)\s*$/, ""))}</li>`)
    .join("");
  const more = entries.length > MAX_BULLETS ? `<p class="rel-more">and ${entries.length - MAX_BULLETS} more</p>` : "";
  const date = release.date ? `<time datetime="${release.date}">${formatDate(release.date)}</time>` : "";
  const kind = kindOf(release);
  const stamp = KINDS[kind]?.stamp ?? "Shipped";
  return (
    `<article class="spread" id="${v}" data-i="${index}" data-v="${v}" data-art="${ART_BASE}${a.name}"${a.small ? ` data-small="${a.small}"` : ""} data-thumb="${ART_BASE}${a.name}-thumb.webp" aria-labelledby="h-${v}"${index ? " hidden" : ""}>` +
    artPage(release, a, index === 0) +
    `<div class="page page-notes">` +
    `<header class="rel-head"><h2 class="rel-v" id="h-${v}" tabindex="-1"><span class="vh">Release </span>v${v}</h2>` +
    `<p class="rel-title">${escapeHtml(titleOf(release, art.titles))}</p>` +
    `<p class="rel-meta">${date}<span class="rel-kind" data-kind="${kind}">${escapeHtml(stamp)}</span></p></header>` +
    `<div class="rel-body"><ul class="rel-bullets">${bullets}</ul>${more}` +
    `<div class="rel-actions">${fullNotes(release)}` +
    `<button class="btn-quiet btn-copy" type="button" data-copy aria-label="Copy link" hidden>${LINK_ICON}<span class="copy-state" aria-live="polite"></span></button>` +
    `<a class="rel-all" href="#all" data-all>All releases</a></div>` +
    `<span class="shipped" aria-hidden="true"><span>Shipped</span><span class="shipped-v">${v}</span></span>` +
    `</div></div>` +
    `</article>`
  );
}

export function renderSpreads(releases, art, manifest) {
  if (!releases.length) return `<p class="empty">No releases yet.</p>`;
  return releases.map((r, i) => renderSpread(r, i, art, manifest)).join("\n");
}

// The version scrubber: a timeline along the foot of the book on wide
// screens, a sticky row of chips on phones. Oldest on the left, like the
// book, which opens on the newest at the right.
export function renderScrubber(releases) {
  const items = [...releases]
    .reverse()
    .map((r, i, all) => {
      const v = escapeHtml(r.version);
      const index = all.length - 1 - i;
      return `<li><a class="scrub-v" href="#${v}" data-i="${index}"${index === 0 ? ' aria-current="true"' : ""}>${v}</a></li>`;
    })
    .join("");
  return `<ol class="scrub-list">${items}</ol>`;
}

// Every release as plain text, newest first: the All releases drawer.
export function renderAll(releases) {
  if (!releases.length) return "";
  return (
    `<ol class="all-list">` +
    releases
      .map(
        (r) =>
          `<li><a href="#${escapeHtml(r.version)}"><span class="all-v">${escapeHtml(r.version)}</span>` +
          (r.date ? ` <time datetime="${r.date}">${formatDate(r.date)}</time>` : "") +
          `</a></li>`,
      )
      .join("") +
    `</ol>`
  );
}
