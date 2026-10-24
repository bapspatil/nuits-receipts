import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

// The bar and the footer carry the trader identification and the small print,
// which must be identical on every page. One file each, inlined at build time,
// so a legal line cannot be updated on one page and forgotten on another.
// Partials may include partials (the nav list sits in the bar twice and in the
// footer once), so expansion repeats until nothing is left to expand.
const expandPartials = (html: string, depth = 0): string => {
  if (depth > 4) throw new Error("partials nest more than 4 deep; does one include itself?");
  const out = html.replace(/<!-- partial:(\w+) -->/g, (_, name) =>
    readFileSync(resolve(import.meta.dirname, `src/partials/${name}.html`), "utf8"),
  );
  return out === html ? out : expandPartials(out, depth + 1);
};

const partials = (): Plugin => ({
  name: "partials",
  transformIndexHtml: (html) => expandPartials(html),
});

// Illustrations are inlined rather than linked: they paint with the HTML and
// without JavaScript, they cannot shift the layout when they arrive, and an
// <img> could neither take the token colours from CSS nor expose the strokes
// the draw-on and morph animations move.
const svgs = (): Plugin => ({
  name: "svgs",
  transformIndexHtml: (html) =>
    html.replace(/<!-- svg:(\w+) -->/g, (_, name) =>
      readFileSync(resolve(import.meta.dirname, `src/assets/svg/${name}.svg`), "utf8").trim(),
    ),
});

export default defineConfig({
  plugins: [partials(), svgs()],
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, "index.html"), privacy: resolve(import.meta.dirname, "privacy/index.html"), notFound: resolve(import.meta.dirname, "404.html") },
    },
  },
});
