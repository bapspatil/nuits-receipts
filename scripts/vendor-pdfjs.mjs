#!/usr/bin/env node
// pdfjs-dist in, src/vendor/*.txt out: the two minified PDF.js builds the
// viewer serves from /assets/. A .txt file bundles as a Text module under
// wrangler's default rules, so every wrangler config, the public template, a
// private override and the tests, picks them up without a rules entry.
//
//   bun run vendor:pdfjs     after bumping pdfjs-dist in package.json
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

export const FILES = { 'pdf.min.mjs': 'pdf.txt', 'pdf.worker.min.mjs': 'pdf-worker.txt' };
const version = JSON.parse(readFileSync('node_modules/pdfjs-dist/package.json', 'utf8')).version;
for (const [from, to] of Object.entries(FILES))
  copyFileSync(`node_modules/pdfjs-dist/build/${from}`, `src/vendor/${to}`);
writeFileSync('src/vendor/pdfjs-version.ts', `export const PDFJS_VERSION = '${version}';\n`);
console.log(`src/vendor: PDF.js ${version}`);
