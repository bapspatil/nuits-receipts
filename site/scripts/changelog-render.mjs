// Shared pieces of the changelog page: escaping, dates, the inline markdown
// CHANGELOG.md uses, and the JSON-LD. Pure, so it can be tested without a
// build. The book itself is scripts/changelog-book.mjs.

export const SITE = "https://receipts.nuits.net";
export const PAGE_URL = `${SITE}/changelog/`;

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
              url: `${PAGE_URL}#${r.version}`,
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
