#!/usr/bin/env node
// Lucide icons in, src/icons.ts out: the path data of every icon the app draws,
// from the published lucide-static package, never by hand. src/ui.ts emits one
// hidden <svg> per page holding only the <symbol>s the page references.
//
//   bun run sprite            fetches lucide-static@1.65.0 with npm pack
//   node scripts/app-sprite.mjs <dir>   reads <dir>/<name>.svg instead
//
// To add an icon, add its Lucide name to ICONS below and run the script.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LUCIDE_VERSION = '1.65.0';

export const ICONS = [
  'arrow-left',
  'arrow-left-right',
  'badge-check',
  'ban',
  'banknote',
  'banknote-x',
  'calendar-clock',
  'check',
  'circle-plus',
  'chevron-left',
  'chevron-right',
  'chevrons-down',
  'chevrons-left',
  'chevrons-right',
  'circle-alert',
  'circle-check',
  'circle-dashed',
  'circle-dollar-sign',
  'circle-minus',
  'circle-slash',
  'circle-x',
  'cloud-upload',
  'copy',
  'copy-plus',
  'download',
  'ellipsis',
  'octagon-x',
  'repeat',
  'eraser',
  'external-link',
  'eye',
  'file-down',
  'files',
  'file-plus',
  'file-question-mark',
  'file-spreadsheet',
  'filter-x',
  'folder-input',
  'folder-output',
  'hourglass',
  'house',
  'import',
  'landmark',
  'link',
  'list',
  'list-checks',
  'list-todo',
  'loader-circle',
  'log-out',
  'mail',
  'mail-check',
  'merge',
  'pencil',
  'plug',
  'plus',
  'receipt',
  'receipt-text',
  'refresh-cw',
  'rotate-ccw',
  'save',
  'scan-line',
  'scan-text',
  'search',
  'send',
  'skip-forward',
  'sliders-horizontal',
  'square-check-big',
  'trash-2',
  'undo-2',
  'unlink',
  'unplug',
  'upload',
  'user-check',
  'user-x',
  'x',
];

// The markup inside an icon's <svg>, as lucide-static ships it.
export function inner(svg) {
  return svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/\s*\n\s*/g, '')
    .trim();
}

export function render(paths) {
  const body = ICONS.map((name) => `  ${JSON.stringify(name)}: ${JSON.stringify(paths[name])},`).join('\n');
  return `// Generated from lucide-static ${LUCIDE_VERSION} by scripts/app-sprite.mjs. Do not edit by hand.
// Lucide is ISC licensed (some icons derive from Feather, MIT); see NOTICE.
// Add an icon to scripts/app-sprite.mjs and run \`bun run sprite\`.

export const LUCIDE_VERSION = ${JSON.stringify(LUCIDE_VERSION)};

// Each icon's markup inside a 24 by 24 viewBox, drawn with a 2 px round stroke.
export const ICON_PATHS = {
${body}
} as const;

export type IconName = keyof typeof ICON_PATHS;

// The one way an icon is drawn: decorative, so it never speaks. The label beside it does.
export const icon = (name: IconName): string =>
  \`<svg class="i" aria-hidden="true" focusable="false"><use href="#i-\${name}"/></svg>\`;

// The hidden sprite of a page: a <symbol> for every icon its markup references, and no other.
export function sprite(html: string): string {
  const used = new Set([...html.matchAll(/<use href="#i-([a-z0-9-]+)"/g)].map((m) => m[1]));
  const symbols = (Object.keys(ICON_PATHS) as IconName[])
    .filter((name) => used.has(name))
    .map(
      (name) =>
        \`<symbol id="i-\${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\${ICON_PATHS[name]}</symbol>\`,
    );
  return symbols.length ? \`<svg hidden aria-hidden="true">\${symbols.join('')}</svg>\` : '';
}
`;
}

function sourceDir() {
  if (process.argv[2]) return process.argv[2];
  const work = mkdtempSync(join(tmpdir(), 'lucide-'));
  const pack = join(work, 'pack');
  const out = join(work, 'out');
  mkdirSync(pack);
  mkdirSync(out);
  execFileSync('npm', ['pack', `lucide-static@${LUCIDE_VERSION}`, '--pack-destination', pack], { stdio: 'ignore' });
  execFileSync('tar', ['xzf', join(pack, `lucide-static-${LUCIDE_VERSION}.tgz`), '-C', out]);
  return join(out, 'package', 'icons');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = sourceDir();
  const paths = Object.fromEntries(ICONS.map((name) => [name, inner(readFileSync(join(dir, `${name}.svg`), 'utf8'))]));
  writeFileSync('src/icons.ts', render(paths));
  execFileSync('npx', ['prettier', '--write', 'src/icons.ts'], { stdio: 'ignore' });
  console.log(`wrote src/icons.ts (${ICONS.length} icons)`);
}
