#!/usr/bin/env node
// Builds native.html, paper.html and mix.html from one data set and one set of markup
// functions, so the directions differ only in tokens and CSS. It also
// measures every declared text/background pair and writes the contrast tables
// into README.md between the <!-- contrast:NAME --> markers.
//
// Usage: node docs/app-v4/mockups/build.mjs <lucide-static>/icons
// Get the icons with `npm pack lucide-static` in a temp dir and untar it.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES } from './themes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const iconDir = process.argv[2];
if (!iconDir || !existsSync(join(iconDir, 'check.svg'))) {
  console.error('usage: node build.mjs <lucide-static>/icons');
  process.exit(2);
}

// One icon per meaning. Actions first, then statuses, then navigation.
const ICONS = {
  check: 'check',
  x: 'x',
  'undo-2': 'undo-2',
  link: 'link',
  unlink: 'unlink',
  ban: 'ban',
  'file-question-mark': 'file-question-mark',
  'scan-text': 'scan-text',
  'folder-input': 'folder-input',
  banknote: 'banknote',
  download: 'download',
  'mail-check': 'mail-check',
  upload: 'upload',
  import: 'import',
  'trash-2': 'trash-2',
  'external-link': 'external-link',
  'user-check': 'user-check',
  'user-x': 'user-x',
  'skip-forward': 'skip-forward',
  ellipsis: 'ellipsis',
  pencil: 'pencil',
  'chevrons-down': 'chevrons-down',
  search: 'search',
  'list-checks': 'list-checks',
  'circle-alert': 'circle-alert',
  'loader-circle': 'loader-circle',
  mail: 'mail',
  'calendar-clock': 'calendar-clock',
  'circle-dashed': 'circle-dashed',
  'circle-check': 'circle-check',
  home: 'house',
  receipt: 'receipt',
  landmark: 'landmark',
  'sliders-horizontal': 'sliders-horizontal',
  'chevron-left': 'chevron-left',
  'chevron-right': 'chevron-right',
  'chevron-down': 'chevron-down',
};

const sprite = () => {
  const symbols = Object.entries(ICONS).map(([id, file]) => {
    const src = readFileSync(join(iconDir, `${file}.svg`), 'utf8');
    const inner = src
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/^[\s\S]*?<svg[^>]*>/, '')
      .replace(/<\/svg>\s*$/, '')
      .replace(/\s*\n\s*/g, '')
      .trim();
    return `<symbol id="i-${id}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</symbol>`;
  });
  return `<svg hidden xmlns="http://www.w3.org/2000/svg"><!-- Lucide icons, ISC licence, lucide-static 1.65.0 -->${symbols.join('')}</svg>`;
};

const icon = (id) => {
  if (!ICONS[id]) throw new Error(`no icon ${id}`);
  return `<svg class="i" aria-hidden="true" focusable="false"><use href="#i-${id}"/></svg>`;
};

// The ACTIONS registry the plan describes: one label and one icon per action.
const ACTIONS = {
  approve: ['Approve', 'check'],
  discard: ['Discard', 'x'],
  undo: ['Undo', 'undo-2'],
  match: ['Match', 'link'],
  unmatch: ['Unmatch', 'unlink'],
  exempt: ['Not a purchase', 'ban'],
  needs: ['Needs a receipt', 'file-question-mark'],
  reread: ['Read again', 'scan-text'],
  move: ['Move to invoices', 'folder-input'],
  paid: ['Mark paid', 'banknote'],
  zip: ['Download ZIP', 'download'],
  sent: ['Mark as sent', 'mail-check'],
  upload: ['Upload', 'upload'],
  importStmt: ['Import statement', 'import'],
  delete: ['Delete', 'trash-2'],
  original: ['Open original', 'external-link'],
  allow: ['Allow', 'user-check'],
  ignore: ['Ignore', 'user-x'],
  skip: ['Skip', 'skip-forward'],
  more: ['More', 'ellipsis'],
  edit: ['Edit', 'pencil'],
  showMore: ['Show 50 more', 'chevrons-down'],
  search: ['Search', 'search'],
  start: ['Start checking', 'list-checks'],
  matchAll: ['Match all', 'link'],
};

const btn = (key, tone = 'secondary', { label, extra = '', size = '' } = {}) => {
  const [l, i] = ACTIONS[key];
  return `<button type="button" class="btn ${tone}${size ? ` ${size}` : ''}" data-act="${key}"${extra}>${icon(i)}<span>${label ?? l}</span></button>`;
};

// One status registry: one word, one tone, one icon per state.
const STATUS = {
  needs: ['Needs you', 'warn', 'circle-alert'],
  reading: ['Reading', 'info', 'loader-circle'],
  sender: ['New sender', 'info', 'mail'],
  overdue: ['Overdue', 'warn', 'calendar-clock'],
  missing: ['Missing', 'warn', 'circle-dashed'],
};
const badge = (k) => {
  const [word, tone, i] = STATUS[k];
  return `<span class="badge ${tone}">${icon(i)}${word}</span>`;
};

const money = (n) => {
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `<span class="amt"><span class="cur">EUR</span> ${n < 0 ? '-' : ''}${s}</span>`;
};

// Busy month: September 2026, a small Helsinki studio. 132 to do.
const TODO = { total: 132, receipts: 124, senders: 5, invoices: 3 };
const RECEIPTS = [
  { id: 'r1', kind: 'receipt', title: 'Verkkokauppa.com', meta: 'Total unsure', date: '18 Sep', amount: 89.9, status: 'needs', picked: true },
  { id: 'r2', kind: 'receipt', title: 'K-Citymarket Ruoholahti', meta: 'VAT missing', date: '17 Sep', amount: 64.32, status: 'needs', picked: true },
  { id: 'm1', kind: 'sender', title: 'noreply@hsl.fi', meta: 'Email from a sender you have not allowed. 1 attachment.', date: '17 Sep', status: 'sender' },
  { id: 'r3', kind: 'receipt', title: 'Neste Espoo Kehä III', meta: 'Date unclear', date: '16 Sep', amount: 72.18, status: 'needs', picked: true },
  { id: 'i1', kind: 'invoice', title: 'Kahvila Pohjoinen Oy', meta: 'Invoice 2026-041. Due 14 Sep, 16 days late.', date: '31 Aug', amount: 1240, status: 'overdue' },
  { id: 'r4', kind: 'receipt', title: 'Adobe Systems Software Ireland', meta: 'Currency unclear', date: '15 Sep', amount: 71.99, status: 'needs' },
  { id: 'r5', kind: 'reading', title: 'Scan 14 Sep.pdf', meta: 'Uploaded. Reading the text.', date: '14 Sep', status: 'reading' },
  { id: 'r6', kind: 'receipt', title: 'VR Matkalippu Helsinki to Turku', meta: 'Seller missing', date: '12 Sep', amount: 38.6, status: 'needs' },
  { id: 'r7', kind: 'receipt', title: 'Elisa Oyj', meta: 'VAT missing', date: '11 Sep', amount: 29.9, status: 'needs' },
  { id: 'r8', kind: 'receipt', title: 'Puuilo Vantaa', meta: 'Total unsure', date: '9 Sep', amount: 112.45, status: 'needs' },
];

const BANK = [
  { id: 'b1', date: '3 Sep', title: 'K-MARKET KALLIO HELSINKI', meta: 'Card 4417', amount: -23.45, likely: ['K-Market Kallio, 3 Sep, EUR 23.45', 'Same amount and date.'] },
  { id: 'b2', date: '5 Sep', title: 'ZOOM.US 888-799-9666', meta: 'Card 4417', amount: -15.99 },
  { id: 'b3', date: '8 Sep', title: 'ELISA OYJ', meta: 'E-invoice', amount: -29.9, likely: ['Elisa Oyj, 11 Sep, EUR 29.90', 'Same amount, 3 days apart.'] },
  { id: 'b4', date: '10 Sep', title: 'MOBILEPAY ANTTI VIRTANEN', meta: 'Transfer', amount: -40 },
  { id: 'b5', date: '12 Sep', title: 'GOOGLE *WORKSPACE', meta: 'Card 4417', amount: -13.8, likely: ['Google Workspace, 1 Sep, EUR 13.80', 'Same amount and seller.'] },
  { id: 'b6', date: '15 Sep', title: 'RAVINTOLA SAVOY', meta: 'Card 4417', amount: -186.4 },
  { id: 'b7', date: '19 Sep', title: 'POSTI OY', meta: 'Card 4417', amount: -9.9, likely: ['Posti, 19 Sep, EUR 9.90', 'Same amount and date.'] },
  { id: 'b8', date: '22 Sep', title: 'CLAS OHLSON KAMPPI', meta: 'Card 4417', amount: -54.95, likely: ['Clas Ohlson, 22 Sep, EUR 54.95', 'Same amount and date.'] },
];
const BANK_TODO = { total: 23, likely: 8 };

const NAV = [
  ['home', 'Home', 'home'],
  ['receipts', 'Receipts', 'receipt'],
  ['bank', 'Bank', 'landmark'],
  ['settings', 'Settings', 'sliders-horizontal'],
];
const nav = (active) => `<nav class="appnav" aria-label="Main">
  <a class="brand" href="#">Nuits Receipts</a>
  <ul>${NAV.map(
    ([k, label, i]) =>
      `<li><a href="#"${k === active ? ' aria-current="page"' : ''}>${icon(i)}<span class="lbl">${label}</span>${
        k === 'receipts' ? `<span class="count">${TODO.total}<span class="vh"> to do</span></span>` : ''
      }</a></li>`,
  ).join('')}</ul>
</nav>`;

const seg = (n, label) => `<div class="seg" role="group" aria-label="${label}">
  <a href="#" aria-current="page">To do <span class="n">${n}</span></a><a href="#">All</a>
</div>`;

const pick = (id, on) =>
  `<input class="pick" type="checkbox" aria-label="Select"${on ? ' checked' : ''} data-row="${id}">`;

const receiptRow = (r) => {
  const acts = {
    receipt: btn('approve', 'secondary', { size: 'sm' }) + btn('discard', 'ghost', { size: 'sm' }),
    reading: btn('discard', 'ghost', { size: 'sm' }),
    sender: btn('allow', 'secondary', { size: 'sm' }) + btn('ignore', 'ghost', { size: 'sm' }),
    invoice: btn('paid', 'secondary', { size: 'sm' }) + btn('more', 'ghost', { size: 'sm' }),
  }[r.kind];
  const kindWord = { receipt: 'Receipt', reading: 'Receipt', sender: 'Held mail', invoice: 'Sales invoice' }[r.kind];
  return `<li class="row${r.picked ? ' is-picked' : ''}" id="row-${r.id}">
  ${pick(r.id, r.picked)}
  <span class="date">${r.date}</span>
  <div class="body"><a class="title" href="#">${r.title}</a><p class="meta"><span class="kind">${kindWord}</span> ${r.meta}</p></div>
  ${badge(r.status)}
  ${r.amount == null ? '<span class="amt none" aria-hidden="true"></span>' : money(r.amount)}
  <div class="acts">${acts}</div>
</li>`;
};

const bankRow = (r) => `<li class="row${r.likely ? ' has-likely' : ''}" id="row-${r.id}">
  ${pick(r.id, false)}
  <span class="date">${r.date}</span>
  <div class="body"><span class="title">${r.title}</span><p class="meta">${r.meta}</p></div>
  ${r.likely ? `<p class="likely">${icon('receipt')}<span><b>Likely receipt:</b> ${r.likely[0]}. <span class="why">${r.likely[1]}</span></span></p>` : ''}
  ${badge('missing')}
  ${money(r.amount)}
  <div class="acts">${btn('match', 'secondary', { size: 'sm' })}${btn('exempt', 'ghost', { size: 'sm' })}${btn('more', 'ghost', { size: 'sm' })}</div>
</li>`;

const screenReceipts = () => `<div class="app" data-screen="receipts">
${nav('receipts')}
<main>
  <header class="pagehead">
    <h1>Receipts</h1>
    ${seg(TODO.total, 'View')}
    <div class="headacts">${btn('start', 'primary', { label: `Start checking (${TODO.receipts})` })}</div>
  </header>
  <div class="banner" role="status">${icon('circle-check')}<p>Approved 14 receipts.</p>${btn('undo', 'ghost', { size: 'sm' })}</div>
  <div class="listtools">
    <label class="selall"><input class="pick" type="checkbox" aria-label="Select all ${TODO.total}"><span>Select all</span></label>
    <button type="button" class="chip" aria-haspopup="listbox">${icon('calendar-clock')}<span>Any month</span>${icon('chevron-down')}</button>
    <p class="tally">${TODO.receipts} receipts, ${TODO.senders} new senders, ${TODO.invoices} overdue invoices</p>
  </div>
  <div class="colhead" aria-hidden="true"><span></span><span>Date</span><span>Item</span><span>Status</span><span class="r">Amount</span><span></span></div>
  <ul class="rows" data-list="receipts">
    ${RECEIPTS.map(receiptRow).join('\n')}
  </ul>
  <p class="mocknote">40 more rows like these</p>
  <footer class="listfoot"><p><b>50</b> of ${TODO.total} to do</p>${btn('showMore', 'secondary')}</footer>
  <div class="bulkbar" role="region" aria-label="Selected">
    <p><b>3</b> selected</p>
    ${btn('approve', 'onbar-primary')}${btn('discard', 'onbar')}
  </div>
</main>
</div>`;

const doc = () => `<figure class="doc" aria-label="Receipt image">
  <div class="slip">
    <p class="s-h">VERKKOKAUPPA.COM OYJ</p>
    <p class="s-c">Tyynenmerenkatu 11, 00220 Helsinki<br>Y-tunnus 1510466-2</p>
    <p class="s-c">18.09.2026 14:32 &nbsp; Kassa 07</p>
    <hr>
    <p class="s-l"><span>Näyttövarsi Ergotron LX</span><span>89,90</span></p>
    <p class="s-l"><span>1 kpl</span><span></span></p>
    <hr>
    <p class="s-l s-t"><span>YHTEENSÄ EUR</span><span class="smudge">89,90</span></p>
    <p class="s-l"><span>ALV 25,5 %</span><span class="smudge">18,27</span></p>
    <p class="s-l"><span>Veroton</span><span>71,63</span></p>
    <hr>
    <p class="s-c">Kortti **** 4417 &nbsp; Hyväksytty</p>
    <p class="s-c">Kuitti 1048-77213</p>
    <p class="s-c">KIITOS KÄYNNISTÄ</p>
  </div>
  <figcaption>${btn('original', 'secondary', { size: 'sm' })}</figcaption>
</figure>`;

const readField = (k, v) => `<div class="rf"><dt>${k}</dt><dd>${v}</dd></div>`;

const screenReview = () => `<div class="app" data-screen="review">
${nav('receipts')}
<main>
  <header class="pagehead reviewhead">
    <a class="back" href="#">${icon('chevron-left')}<span>To do</span></a>
    <h1>Verkkokauppa.com</h1>
    ${badge('needs')}
    <div class="stepper"><a class="iconbtn" href="#" aria-label="Previous" title="Previous">${icon('chevron-left')}</a><p><b>3</b> of ${TODO.receipts}</p><a class="iconbtn" href="#" aria-label="Next" title="Next">${icon('chevron-right')}</a></div>
  </header>
  <div class="split">
    ${doc()}
    <form class="fields" onsubmit="return false">
      <section class="group need">
        <h2>2 fields to fill</h2>
        <div class="field">
          <label for="f-total">Total</label>
          <div class="inwrap"><input id="f-total" class="input" inputmode="decimal" value="89.90" aria-describedby="h-total"><span class="unit">EUR</span></div>
          <p class="hint" id="h-total">${icon('circle-alert')}Read as 89.90 or 39.90. Check the receipt.</p>
        </div>
        <div class="field">
          <label for="f-vat">VAT amount</label>
          <div class="inwrap"><input id="f-vat" class="input" inputmode="decimal" placeholder="0.00" aria-describedby="h-vat"><span class="unit">EUR</span></div>
          <p class="hint quiet" id="h-vat">Enter 0 if the receipt has no VAT.</p>
        </div>
      </section>
      <section class="group read">
        <div class="grouphead"><h2>Read from the receipt</h2>${btn('edit', 'ghost', { size: 'sm' })}</div>
        <dl>
          ${readField('Seller', 'Verkkokauppa.com Oyj')}
          ${readField('Date', '18 Sep 2026')}
          ${readField('Before VAT', '<span class="amt"><span class="cur">EUR</span> 71.63</span>')}
          ${readField('VAT rate', '25.5 %')}
          ${readField('Receipt number', '1048-77213')}
          ${readField('Kind', 'Equipment')}
        </dl>
      </section>
      <div class="actionbar">
        <p class="pos"><b>3</b> of ${TODO.receipts}</p>
        <div class="ab-acts">${btn('more', 'ghost')}${btn('discard', 'ghost')}${btn('skip', 'secondary')}${btn('approve', 'primary')}</div>
      </div>
    </form>
  </div>
</main>
</div>`;

const screenBank = () => `<div class="app" data-screen="bank">
${nav('bank')}
<main>
  <header class="pagehead bankhead">
    <h1>Bank</h1>
    <div class="month"><a class="iconbtn" href="#" aria-label="August 2026" title="August 2026">${icon('chevron-left')}</a><p>September 2026</p><a class="iconbtn" href="#" aria-label="October 2026" title="October 2026">${icon('chevron-right')}</a></div>
    ${seg(BANK_TODO.total, 'View')}
    <div class="headacts">${btn('importStmt', 'secondary')}${btn('matchAll', 'primary', { label: `Match all (${BANK_TODO.likely})` })}</div>
  </header>
  <p class="lede"><b>${BANK_TODO.total}</b> payments need a receipt. <b>${BANK_TODO.likely}</b> have a likely one.</p>
  <div class="colhead" aria-hidden="true"><span></span><span>Date</span><span>Paid to</span><span>Status</span><span class="r">Amount</span><span></span></div>
  <ul class="rows" data-list="bank">
    ${BANK.map(bankRow).join('\n')}
  </ul>
  <p class="mocknote">15 more rows like these</p>
  <footer class="listfoot"><p><b>${BANK_TODO.total}</b> of ${BANK_TODO.total} to do</p></footer>
</main>
</div>`;

const specimen = () => `<div class="specimen">
  <h2>Controls</h2>
  <div class="sp-row">
    ${seg(TODO.total, 'Segmented control')}
    <button type="button" class="chip">${icon('calendar-clock')}<span>Any month</span>${icon('chevron-down')}</button>
    <label class="sp-input"><span class="vh">Text input</span><input class="input" value="Kahvila Pohjoinen"></label>
  </div>
  <div class="sp-row">
    ${btn('approve', 'primary')}${btn('skip', 'secondary')}${btn('more', 'ghost')}${btn('delete', 'danger', { label: 'Delete forever' })}
  </div>
  <div class="sp-row">
    ${['needs', 'missing', 'overdue', 'reading', 'sender'].map(badge).join('')}
    <div class="banner err" role="alert">${icon('circle-alert')}<p>That file is not a CSV.</p></div>
  </div>
  <h2>One icon per action</h2>
  <ul class="iconkey">${Object.keys(ACTIONS)
    .filter((k) => !['matchAll', 'showMore'].includes(k))
    .map((k) => `<li>${icon(ACTIONS[k][1])}<span>${ACTIONS[k][0]}</span></li>`)
    .join('')}<li>${icon('chevrons-down')}<span>Show more</span></li></ul>
</div>`;

const SCREENS = [
  ['receipts', '1. Receipts, To do', screenReceipts],
  ['review', '2. Receipt review', screenReview],
  ['bank', '3. Bank, To do', screenBank],
];

const MOTION_JS = `
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const VERB = { approve: 'Approved', discard: 'Discarded', match: 'Matched', exempt: 'Marked not a purchase:', allow: 'Allowed', paid: 'Marked paid:' };
document.addEventListener('click', (e) => {
  const b = e.target.closest('.row .btn');
  if (!b || !VERB[b.dataset.act]) return;
  const row = b.closest('.row');
  const name = row.querySelector('.title').textContent;
  const banner = row.closest('main').querySelector('.banner p');
  if (banner) banner.textContent = VERB[b.dataset.act] + ' ' + name + '.';
  const next = row.nextElementSibling;
  const done = () => { row.remove(); next?.querySelector('.title')?.focus(); };
  if (reduce.matches) return done();
  row.style.setProperty('--h', row.offsetHeight + 'px');
  row.classList.add('is-leaving');
  row.addEventListener('animationend', (ev) => { if (ev.animationName === 'row-collapse') done(); });
});
document.addEventListener('change', (e) => {
  if (!e.target.matches('.row .pick')) return;
  const row = e.target.closest('.row');
  row.classList.toggle('is-picked', e.target.checked);
  const main = row.closest('main');
  const bar = main.querySelector('.bulkbar b');
  if (bar) bar.textContent = main.querySelectorAll('.row .pick:checked').length;
});
const u = new URL(location.href);
if (u.searchParams.has('phone')) {
  const wrap = document.createElement('div');
  wrap.className = 'phoneframe';
  const f = document.createElement('iframe');
  f.title = 'Phone width';
  f.src = location.pathname + '?inner';
  wrap.append(f);
  document.body.replaceChildren(wrap);
}
if (u.searchParams.has('inner')) document.documentElement.classList.add('inner');
`;

const page = (name, theme) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${theme.title}: Nuits Receipts v4 mockup</title>
<style>
${theme.fontFaces}
${theme.css}
</style>
</head>
<body>
${sprite()}
<div class="mockbar">
  <p><b>${theme.title}</b> mockup, UX v4. Static, busy September 2026.</p>
  <p class="mb-links"><a href="?">Desktop</a> <a href="?phone">Phone, 390 px</a> ${Object.entries(THEMES)
    .filter(([k]) => k !== name)
    .map(([k, t]) => `<a href="${k}.html">${t.title}</a>`)
    .join(' ')}</p>
</div>
${SCREENS.map(([id, label, fn]) => `<section class="screen" id="s-${id}" aria-label="${label}"><p class="mocklabel">${label}</p>\n${fn()}\n</section>`).join('\n')}
<section class="screen" id="s-specimen" aria-label="Controls"><p class="mocklabel">4. Controls, statuses and icons</p>${specimen()}</section>
<script>${MOTION_JS}</script>
</body>
</html>
`;

// --- contrast ---------------------------------------------------------------
const lum = (hex) => {
  const v = hex.replace('#', '').match(/../g).map((h) => parseInt(h, 16) / 255);
  const c = v.map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const NEED = { text: 4.5, large: 3, ui: 3 };

let failed = 0;
const tables = {};
for (const [name, theme] of Object.entries(THEMES)) {
  const c = theme.colors;
  const rows = theme.pairs.map(([fg, bg, kind, use]) => {
    if (!c[fg] || !c[bg]) throw new Error(`${name}: unknown colour ${fg} or ${bg}`);
    const r = ratio(c[fg], c[bg]);
    const ok = r >= NEED[kind];
    if (!ok) failed++;
    return `| ${use} | \`${fg}\` ${c[fg]} | \`${bg}\` ${c[bg]} | ${kind === 'text' ? 'Text 4.5' : kind === 'large' ? 'Large 3' : 'UI 3'} | ${r.toFixed(2)} | ${ok ? 'Pass' : 'FAIL'} |`;
  });
  tables[name] = ['| Use | Foreground | Background | Needs | Ratio | Result |', '| --- | --- | --- | --- | --- | --- |', ...rows].join('\n');
  writeFileSync(join(here, `${name}.html`), page(name, theme));
  console.log(`${name}.html: ${theme.pairs.length} pairs measured`);
}

const readme = join(here, 'README.md');
if (existsSync(readme)) {
  let md = readFileSync(readme, 'utf8');
  for (const [name, t] of Object.entries(tables)) {
    md = md.replace(
      new RegExp(`(<!-- contrast:${name} -->)[\\s\\S]*?(<!-- /contrast:${name} -->)`),
      `$1\n${t}\n$2`,
    );
  }
  writeFileSync(readme, md);
}
if (failed) {
  console.error(`${failed} pairs below WCAG AA`);
  process.exit(1);
}
console.log('every pair passes WCAG AA');
