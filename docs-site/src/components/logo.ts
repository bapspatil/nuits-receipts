/**
 * The Nuits Receipts mark, drawn once for the header, the docs layout
 * (Logo.astro) and the social cards (src/pages/og/_card.ts). It is the receipt
 * glyph from the marketing site's favicon, on its 24 x 24 grid.
 */
export const logo = {
  width: 24,
  height: 24,
  /** The receipt body, filled with the text colour. */
  paths: ["M5 2h14v19l-2.33-1.5L14.33 21 12 19.5 9.67 21l-2.34-1.5L5 21z"],
  /** The text lines, stroked in the surface colour. */
  cutouts: "M8 7h8M8 10.5h8M8 14h5",
};
