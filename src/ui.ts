import Papa from 'papaparse';
import { FIND_CSS, findSheet } from './find';
import { money, requireInput, type Receipt } from './domain';
import { eurValues, type EurValue } from './banking';
import type { Env } from './env';
import { config } from './config';
import { version } from '../package.json';
import { TOKENS_CSS } from './tokens';
import { THEME_COLOR, shortName } from './pwa';
import { feedback } from './events';
import { isReady, needsReview } from './flags';
import { LIST_DEFS, RECEIPTS_TODO, type View } from './worklist';
import { STEP, type StepState } from './status';
import { button, buttonLink, buttonSummary, statusMark } from './actions';
import { keysSheet } from './keys';
import { icon, sprite, type IconName } from './icons';
import { failureFor, kept, requestState } from './request';

export function escape(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
// Legal's footer line, on every page. The only disclaimer outside Settings > About. Keep word for word.
export const FOOTER_NOTICE =
  'Check every figure. Not tax or accounting advice. No warranty. Not affiliated with Cloudflare or any bank.';
// The one line at each accountant export (Home, Invoices). Keep word for word.
export const EXPORT_LINE = 'Check every row before sending this to your accountant.';
// Where the data lives, in Settings > About. Legal's wording, word for word.
// A public demo run by Nuits would swap this one line for
// 'Demo run by Nuits. Use sample files only.' (no demo mode exists).
export const DATA_LINE = "Runs in your own Cloudflare account. Nuits doesn't receive or store your data.";

// Bank rows that still need a receipt: outgoing, required, unlinked, from a complete import.
// Own-account transfers set receipt_required=0, so they never count.
export const MISSING_PAYMENTS =
  "FROM bank_transactions t JOIN imports i ON i.id=t.import_id WHERE i.status='complete' AND t.amount_minor<0 AND t.receipt_required=1 AND t.receipt_id IS NULL";

export type NavKey = 'home' | 'add' | 'receipts' | 'bank' | 'settings';
// Every page's place in the nav and its tab title, in one table, so the
// highlighted tab and the title can't drift apart: a page's title is its nav
// label. A page names itself with one of these keys and adds a detail (a
// month, a vendor) after the title.
export const PAGES = {
  home: { nav: 'home', title: 'Home' },
  // An archive file that is not a receipt: a document, a statement, a sent package.
  file: { nav: 'home', title: 'Home' },
  // A receipt opened to check it, from To do.
  reviewItem: { nav: 'receipts', title: 'Receipts' },
  receipts: { nav: 'receipts', title: 'Receipts' },
  receipt: { nav: 'receipts', title: 'Receipts' },
  invoices: { nav: 'receipts', title: 'Receipts' },
  add: { nav: 'add', title: 'Add' },
  bank: { nav: 'bank', title: 'Bank' },
  import: { nav: 'bank', title: 'Bank' },
  settings: { nav: 'settings', title: 'Settings' },
  // Help is linked from Settings, the footer and the setup checklist, not a tab.
  help: { title: 'Help' },
  // Errors keep the nav quiet: no tab is current.
  rejected: { title: "That didn't work" },
  failed: { title: 'Something went wrong' },
} as const satisfies Record<string, { nav?: NavKey; title: string }>;
export type PageKey = keyof typeof PAGES;
// detail: what this page is about, after the title. style: extra page CSS, appended to the shared sheet.
export type PageOptions = { detail?: string; title?: string; head?: string; style?: string; refresh?: number };
export type Counts = { todo: number; missing: number };

// Its own query, so a database without the inbound_mail table still counts.
async function heldTotal(env: Env): Promise<number> {
  try {
    return (await env.DB.prepare("SELECT count(*) n FROM inbound_mail WHERE state='held'").first<number>('n')) ?? 0;
  } catch {
    return 0;
  }
}
// The tab counts for this request. The router starts them as soon as a page
// request is signed in, so they load alongside the page's own queries.
export function navCounts(env: Env): Promise<Counts> {
  const state = requestState.getStore();
  if (!state) return countNav(env);
  return (state.counts ??= countNav(env));
}
async function countNav(env: Env): Promise<Counts> {
  try {
    // Held mail is its own query, so it runs alongside the batch instead of after it.
    const def = LIST_DEFS.receipts!;
    const open = def.open(env, RECEIPTS_TODO);
    const [[todo, missing], held] = await Promise.all([
      env.DB.batch<{ n: number }>([
        env.DB.prepare(`SELECT count(*) n FROM ${def.from} WHERE ${open.sql}`).bind(...open.binds),
        env.DB.prepare(`SELECT count(*) n ${MISSING_PAYMENTS}`),
      ]),
      heldTotal(env),
    ]);
    return {
      // The whole of Receipts To do: unknown-sender emails, receipts to check and overdue invoices.
      todo: (todo?.results[0]?.n ?? 0) + held,
      missing: missing?.results[0]?.n ?? 0,
    };
  } catch {
    // An error page must still render when the database is the problem.
    return { todo: 0, missing: 0 };
  }
}

// Inline CSS is not touched by the base-path rewriter, so font URLs carry the
// base path here. Tokens come from site/src/styles/theme.css.
function styles(base: string): string {
  const font = (name: string) => `url("${base}/assets/fonts/${name}.woff2?v=${version}") format("woff2")`;
  return `@font-face{font-family:"Bricolage";src:${font('bricolage')};font-weight:600 800;font-display:swap}
@font-face{font-family:"Instrument Sans";src:${font('instrument-sans')};font-weight:400 700;font-display:swap}
@font-face{font-family:"DM Mono";src:${font('dm-mono')};font-weight:400;font-display:swap}
@font-face{font-family:"DM Mono";src:${font('dm-mono-medium')};font-weight:500;font-display:swap}
${TOKENS_CSS}
:root{--pad:max(clamp(16px,4vw,32px),env(safe-area-inset-left),env(safe-area-inset-right))}
*,*::before,*::after{box-sizing:border-box}
button{font:inherit}
html{background:var(--surface-page);color:var(--text);font:400 var(--text-base)/1.5 var(--font-ui);font-variant-numeric:tabular-nums;-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;overflow-wrap:break-word}
a{color:var(--accent);text-underline-offset:.2em;text-decoration-thickness:1px}
a:hover{text-decoration-thickness:2px}
:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px;box-shadow:0 0 0 2px var(--surface-page)}
.skip{position:absolute;left:16px;top:8px}.skip:not(:focus){width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}.skip:focus{z-index:9;background:var(--surface-raised);padding:var(--space-2) var(--space-3);border:1px solid var(--border-strong)}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
h1,h2,h3{color:var(--text);text-wrap:balance}
p,li,dd{text-wrap:pretty}
h1{font-family:var(--font-display);font-size:var(--text-2xl);line-height:1.05;font-weight:800;letter-spacing:-.015em;margin:0}
h2{font-size:var(--text-lg);line-height:1.2;font-weight:600;margin:0 0 var(--space-3)}
h3{font-size:var(--text-base);line-height:1.25;font-weight:600;margin:0 0 var(--space-2)}
p{margin:0 0 var(--space-3)}
code{font:500 .875em/1.4 var(--font-mono);background:var(--surface-sunken);padding:1px var(--space-2);border-radius:var(--radius-sm);overflow-wrap:anywhere}
pre{font:400 var(--text-xs)/1.5 var(--font-mono);background:var(--surface-sunken);padding:var(--space-3);overflow:auto;border-radius:var(--radius-sm);white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px}
main:focus{outline:none}
.grain{position:fixed;inset:0;z-index:-1;pointer-events:none;background:url("${base}/assets/grain.svg")}
header.top,nav.tabs,.bulkbar,.banner,.seg a[aria-current=page]{background:var(--glass);-webkit-backdrop-filter:var(--glass-filter);backdrop-filter:var(--glass-filter);border:1px solid var(--glass-border);box-shadow:var(--shadow-glass-edge),var(--shadow-glass)}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){:root{--glass:var(--surface-raised);--glass-filter:none}}
@media (prefers-reduced-transparency:reduce){:root{--glass:var(--surface-raised);--glass-filter:none}}
@media (prefers-contrast:more){:root{--glass:var(--surface-raised);--glass-filter:none;--glass-border:var(--text);--shadow-glass-edge:0 0 0 transparent}}
.bar{display:flex;flex-direction:column;gap:var(--space-4);height:100%;padding:var(--space-5) var(--space-3) var(--space-4)}
.brand{font:800 var(--text-lg)/1 var(--font-display);letter-spacing:-.01em;color:var(--text);text-decoration:none;display:flex;align-items:center;white-space:nowrap;min-height:44px;padding:0 var(--space-3)}
nav.main ul{display:grid;gap:var(--space-1);list-style:none;margin:0;padding:0}
nav.main a{display:flex;align-items:center;gap:var(--space-3);min-height:44px;padding:0 var(--space-3);border-radius:var(--radius-sm);text-decoration:none;font-weight:500;color:var(--text);white-space:nowrap}
nav.main svg.i{color:var(--accent)}
nav.main a:hover{background:var(--surface-page)}
nav.main a[aria-current=page]{color:var(--accent);font-weight:600;background:var(--surface-accent-quiet)}
nav.main .count{margin-left:auto}
nav.main a.navadd{justify-content:center;box-shadow:inset 0 -2px 0 rgb(0 0 0/.28),0 1px 2px rgb(33 28 22/.2);margin:0 0 var(--space-3);background:var(--btn-primary-bg);color:var(--btn-primary-text);font-weight:600}nav.main a.navadd svg.i{color:currentColor}nav.main a.navadd:hover{background:var(--accent-hover)}nav.main a.navadd[aria-current=page]{box-shadow:0 0 0 2px var(--surface-raised),0 0 0 4px var(--accent)}
.count{display:inline-grid;place-items:center;min-width:26px;background:var(--accent);color:var(--text-on-accent);border-radius:var(--radius-pill);font:500 var(--text-xs)/1.5 var(--font-num);padding:0 var(--space-2)}
.sign-out{margin-top:auto;font-size:var(--text-sm);color:var(--text-muted);min-height:44px;display:flex;align-items:center;padding:0 var(--space-3)}
@media (min-width:880px){body{padding-left:calc(var(--sidebar-width) + 12px)}header.top{position:fixed;top:12px;bottom:12px;left:12px;z-index:6;width:var(--sidebar-width);border-radius:var(--radius-glass);overflow-y:auto}}
main{flex:1;width:100%;max-width:var(--page-max);margin:auto;padding:var(--space-6) var(--pad) var(--space-7)}
footer.foot{margin-top:var(--space-5);padding:var(--space-4) max(var(--pad),calc((100% - var(--page-max)) / 2 + var(--pad))) var(--space-6);border-top:1px solid var(--border);font-size:var(--text-xs);color:var(--text-muted);display:flex;flex-wrap:wrap;justify-content:space-between;gap:var(--space-1) var(--space-5)}
footer.foot p{max-width:70ch;margin:0}
footer.foot a{color:var(--text-muted)}
.head{display:flex;flex-wrap:wrap;align-items:end;justify-content:space-between;gap:var(--space-4);margin-bottom:var(--space-5)}
.head.tight{align-items:center;justify-content:flex-start;gap:var(--space-3) var(--space-4)}
.lede{color:var(--text-muted);margin:0 0 var(--space-4);max-width:62ch}
.small,.muted,.hint{font-size:var(--text-sm);color:var(--text-muted);font-weight:400}
.warning{color:var(--warn);font-weight:600}
.months{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-1);flex:1 1 auto;min-width:0}
.months h1{order:-1;flex:1 1 12rem}
.months a{flex:none;padding:0 var(--space-3);min-height:44px;display:inline-flex;align-items:center;gap:var(--space-1);text-decoration:none;font:500 var(--text-sm)/1 var(--font-num);color:var(--accent);border-radius:var(--radius-md)}
.months a:hover{background:var(--surface-sunken)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--space-2);min-height:var(--btn-height);padding:0 var(--space-4);border-radius:var(--radius-md);font:600 var(--text-base)/1.2 var(--font-ui);text-decoration:none;border:1px solid var(--border-strong);box-shadow:0 1px 0 var(--border-strong);cursor:pointer;text-align:center;background:var(--surface-field);color:var(--text)}
.btn svg.i{color:var(--accent)}
.btn:hover{border-color:var(--text);background:var(--surface-raised)}
.btn.primary{background:var(--btn-primary-bg);color:var(--btn-primary-text);border-color:var(--btn-primary-bg);box-shadow:inset 0 -2px 0 rgb(0 0 0/.28),0 1px 2px rgb(33 28 22/.2)}
.btn.primary:hover{background:var(--accent-hover);border-color:var(--accent-hover)}
.btn.primary svg.i,.btn.danger svg.i{color:inherit}
.btn:disabled{cursor:not-allowed;color:var(--text-muted);background:var(--surface-sunken);box-shadow:none}
.btn:active{transform:translateY(1px)}
.btn.ghost{background:none;border-color:transparent;box-shadow:none;color:var(--accent);padding-inline:var(--space-2)}
.btn.ghost:hover{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:.2em}
.btn.danger{background:var(--danger);color:var(--text-on-accent);border-color:var(--danger);box-shadow:inset 0 -2px 0 rgb(0 0 0/.25)}
.btn:disabled.ghost{background:none}
svg.i{width:1.15em;height:1.15em;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
summary.btn{list-style:none}summary.btn::-webkit-details-marker{display:none}
.inline>a{display:inline-flex;align-items:center;min-height:44px}
.stamp,.tag{display:inline-flex;align-items:center;gap:var(--space-1);white-space:nowrap;vertical-align:middle}
.stamp{padding:1px var(--space-2);border:1px solid color-mix(in srgb,currentColor 33%,transparent);border-radius:3px;font:500 var(--text-xs)/1.5 var(--font-num);letter-spacing:.06em;text-transform:uppercase}
.stamp svg.i{width:1.1em;height:1.1em}
.stamp.warn{color:var(--stamp-needs);background:var(--warn-surface)}.stamp.info{color:var(--info);background:var(--info-surface)}.stamp.ok{color:var(--stamp-ok);background:var(--success-surface)}
.stamp.muted{color:var(--text-muted);background:var(--surface-sunken)}
.tag{color:var(--text-muted);font-size:var(--text-sm)}
a.stamp,a.tag{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:.2em}
a.tag{color:var(--accent)}
.card{background:var(--surface-raised);border:1px solid var(--border);border-radius:var(--radius-lg);padding:var(--space-5);margin-bottom:var(--space-4)}
.card.active{border-top:3px solid var(--accent)}
.total h2{margin:0;font:inherit}.ready-phone{display:none}
.total{display:flex;justify-content:space-between;align-items:baseline;gap:var(--space-3);font:500 var(--text-xl)/1.1 var(--font-num);margin-bottom:var(--space-2)}
.alert{background:var(--danger-surface);color:var(--danger);border:1px solid var(--danger);border-radius:var(--radius-lg);padding:var(--space-2) var(--space-3);margin:0 0 var(--space-3)}
.alert[role=note]{background:var(--warn-surface);color:var(--warn);border-color:var(--warn)}
.alert p:last-child{margin:0}
.alert a{font-weight:600}
.banner{border-radius:var(--radius-glass);padding:var(--space-2) var(--space-4);margin:0 0 var(--space-4);font-weight:600;min-height:44px;display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-1) var(--space-2)}
.banner:empty{display:none}
label{display:grid;gap:var(--space-2);font-weight:600;font-size:var(--text-sm);align-content:start;min-width:0}
label.check{display:flex;gap:var(--space-2);align-items:center;min-height:44px;font-weight:500;font-size:var(--text-base)}
input,select,textarea{font:400 var(--text-base)/1.3 var(--font-ui);min-height:var(--field-height);padding:var(--space-2) var(--space-3);border:1px solid var(--border-strong);border-bottom:2px solid var(--text);border-radius:var(--radius-md) var(--radius-md) 0 0;background:var(--surface-field);color:var(--text);width:100%;max-width:100%}
input:hover,select:hover,textarea:hover{border-color:var(--text)}
input:focus,select:focus,textarea:focus{border-bottom-color:var(--accent)}
input[inputmode=decimal],input[type=number],input[type=date]{font-family:var(--font-num)}
input[type=checkbox]{appearance:none;-webkit-appearance:none;display:inline-grid;place-content:center;width:21px;height:21px;min-height:0;padding:0;margin:0;flex:none;border:1.5px solid var(--border-strong);border-radius:5px;background:var(--surface-field);cursor:pointer}
input[type=checkbox]:checked,input[type=checkbox]:indeterminate{background:var(--accent);border-color:var(--accent)}
input[type=checkbox]:checked::before{content:"";width:10px;height:5px;border:solid var(--text-on-accent);border-width:0 0 2px 2px;transform:translateY(-1px) rotate(-45deg)}
input[type=checkbox]:indeterminate::before{content:"";width:10px;height:2px;background:var(--text-on-accent)}
input[type=file]{padding:var(--space-2);border-bottom-width:1px;border-radius:var(--radius-md);cursor:pointer}
input[type=file]::file-selector-button{font:600 var(--text-sm)/1.2 var(--font-ui);color:var(--text);background:var(--surface-field);border:1px solid var(--border-strong);border-radius:var(--radius-md);padding:var(--space-2) var(--space-3);margin-right:var(--space-3);cursor:pointer}
input[type=file]:hover::file-selector-button{border-color:var(--text)}
input[aria-invalid=true],select[aria-invalid=true],textarea[aria-invalid=true]{border-color:var(--danger);box-shadow:inset 0 0 0 1px var(--danger)}
input[type=checkbox][aria-invalid=true],input[type=radio][aria-invalid=true]{outline:2px solid var(--danger);outline-offset:2px}
input::placeholder{color:var(--text-muted);opacity:1}
.ferr{color:var(--danger);font-weight:600;font-size:var(--text-sm);margin:var(--space-1) 0 0}
.fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--space-4);margin-bottom:var(--space-4)}
.fields .wide{grid-column:1/-1}
fieldset{border:1px solid var(--border);border-radius:var(--radius-lg);padding:var(--space-3) var(--space-4) var(--space-1);margin:0 0 var(--space-4);min-width:0}
legend{font-weight:600;font-size:var(--text-sm);padding:0 var(--space-2)}
details{background:var(--surface-raised);border:1px solid var(--border);border-radius:var(--radius-lg);margin-bottom:var(--space-3)}
summary{cursor:pointer;font-weight:600;padding:var(--space-2) var(--space-4);min-height:44px;display:list-item}
summary::marker{color:var(--text-muted)}
summary:focus-visible{outline-offset:-2px}
details.more,details.add,details.filters{background:transparent}
details>.body{padding:var(--space-1) var(--space-4) var(--space-4)}
.scroll{overflow-x:auto;max-width:100%}
table{width:100%;border-collapse:collapse;background:var(--surface-raised)}
.amt,td.n,th.n,.listhead,.prog,.bulkcount,.num{font-family:var(--font-num);font-weight:500}
caption{text-align:left;font-weight:600;padding-bottom:var(--space-2)}
th,td{padding:var(--space-2) var(--space-3);text-align:left;border-bottom:1px solid var(--border);vertical-align:top}
thead th,th[scope=col]{background:var(--surface-sunken);font:500 var(--text-xs)/1.4 var(--font-num);color:var(--text-muted);letter-spacing:.08em;text-transform:uppercase}
td.n,th.n{text-align:right;white-space:nowrap}
tfoot th,tfoot td{border-bottom:0;border-top:1px solid var(--text);font:500 var(--text-base)/1.2 var(--font-num)}
.plain{list-style:none;margin:0;padding:0;display:grid;gap:var(--space-3)}
.list{list-style:none;margin:0 0 var(--space-4);padding:0;background:var(--surface-raised);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-raised)}
.list a{font-weight:600;display:inline-flex;align-items:center;min-height:44px}
.row{position:relative;display:grid;grid-template-columns:24px minmax(0,1fr) auto;grid-template-areas:"pick body amt" "pick rs date" ". rx rx" ". ra ra";column-gap:var(--space-3);align-items:center;min-height:var(--row-height);padding:var(--space-3) var(--space-4)}
.row+.row::before,.rules>li+li::before{content:"";position:absolute;top:0;left:52px;right:0;border-top:1px solid var(--border)}
.list>li:first-child{border-radius:var(--radius-lg) var(--radius-lg) 0 0}.list>li:last-child{border-bottom-left-radius:var(--radius-lg);border-bottom-right-radius:var(--radius-lg)}
.row:has(>.pick input:checked){background:var(--surface-accent-quiet);box-shadow:inset 3px 0 0 var(--accent)}
.row>:not(.rb){position:relative;z-index:1}
.row>.pick{grid-area:pick;min-height:44px}
.row>.date{grid-area:date;justify-self:end;font:400 var(--text-sm)/1.3 var(--font-num);color:var(--text-muted);white-space:nowrap}
.rb{grid-area:body;min-width:0}
.rt{margin:0;font-weight:600;overflow-wrap:anywhere}
.list .rt a{display:inline;min-height:0;color:var(--text);text-decoration:none}
.rt a::after{content:"";position:absolute;inset:0}
.rt a:hover{text-decoration:underline}
.row .meta{margin:0}
.kind{font:500 var(--text-xs)/1 var(--font-num);text-transform:uppercase;letter-spacing:.08em;margin-right:var(--space-1)}
.rs{grid-area:rs;display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-1) var(--space-2);justify-self:start}
.row>.amt{grid-area:amt;justify-self:end;text-align:right;white-space:nowrap}
.ra{grid-area:ra;display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-1) var(--space-2)}
.ra form{margin:0}.ra details{margin:0;border:0;background:none}
.row:has(>.ra details[open]){z-index:2}
.ra details.more>.body{min-width:min(18rem,80vw);background:var(--surface-raised);border:1px solid var(--border-strong);border-radius:var(--radius-md);box-shadow:var(--shadow-glass);padding:var(--space-3)}
.rx{grid-area:rx;min-width:0}
.rules>li{position:relative;padding:0 var(--space-4)}
@media (min-width:880px){
.list{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto auto auto;column-gap:var(--space-4)}
.list>li{grid-column:1/-1}
.row{grid-template-columns:subgrid;grid-template-areas:"pick date body rs amt ra" ". . rx rx rx rx";column-gap:var(--space-4)}
.row>.date{justify-self:start}
.ra{justify-content:flex-end}
.ra details.more{position:relative}
.ra details.more>.body{position:absolute;right:0;top:100%}
}
.chips{display:flex;gap:var(--space-2);flex-wrap:wrap;margin:0 0 var(--space-4);padding:0;list-style:none}
.chips a{display:inline-flex;align-items:center;min-height:44px;padding:0 var(--space-4);border:1px solid var(--border-strong);border-style:dashed;border-radius:var(--radius-pill);text-decoration:none;font-weight:600;font-size:var(--text-sm);color:var(--text)}
.chips a[aria-current=page]{border-style:solid;border-color:var(--accent);background:var(--surface-accent-quiet);color:var(--accent)}
#unknown{margin:0 0 var(--space-5)}
.step>a::before,.step>div::before,.wizard>.step::before{content:"";flex:none;box-sizing:border-box;width:16px;height:16px;border:2px solid var(--text-muted);border-radius:50%}
.step.now>a::before,.step.now>div::before,.wizard>.step.now::before{border-color:var(--accent);background:var(--accent)}
.step.done>a::before,.step.done>div::before,.wizard>.step.done::before{content:"\\2713";border:0;color:var(--success);font:700 var(--text-base)/16px var(--font-ui);text-align:center}
.steps{list-style:none;margin:0 0 var(--space-4);padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--space-3)}
.steps>.step{background:var(--surface-raised);border:1px solid var(--border);border-radius:var(--radius-lg)}
.steps>.step.now{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.steps a,.steps li>div{position:relative;display:grid;grid-template-columns:16px minmax(0,1fr);align-content:start;column-gap:var(--space-3);row-gap:var(--space-1);height:100%;min-height:var(--row-height);padding:var(--space-4);border-radius:inherit;text-decoration:none;color:var(--text)}
.steps a::before,.steps li>div::before{grid-row:1/4;margin-top:var(--space-1)}
.steps a:hover{background:var(--surface-page)}
.steps li>a>.vh,.steps li>div>.vh{position:static;width:auto;height:auto;overflow:visible;clip-path:none;font:500 var(--text-xs)/1.4 var(--font-num);letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)}
.steps li.now>a>.vh,.steps li.now>div>.vh{color:var(--accent)}
.steps li.done>a>.vh,.steps li.done>div>.vh{color:var(--success)}
.steps b{font:600 var(--text-lg)/1.2 var(--font-ui)}
.steps span:not(.vh){color:var(--text-muted);font-size:var(--text-sm);font-weight:600}.steps span.red{color:var(--warn)}
.steps a::after{content:"\\203A";position:absolute;top:var(--space-4);right:var(--space-4);color:var(--text-muted);font-weight:600}
.setup{margin:0 0 var(--space-5)}.sethead{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-1) var(--space-3);margin:0 0 var(--space-2)}.sethead h2{margin:0}.sethead p{margin:0;font-size:var(--text-sm);font-weight:600;color:var(--text-muted)}
.setup .steps{display:block;margin-bottom:var(--space-2);background:var(--surface-raised);border:1px solid var(--border);border-radius:var(--radius-lg)}
.setup .steps>.step,.setup .steps>.step.now{border:0;border-radius:0;box-shadow:none;background:none}
.setup details.finished{background:none;border:0;margin:0 0 var(--space-2)}.setup details.finished>summary{display:flex;align-items:center;min-height:44px;padding:0 var(--space-2);font-size:var(--text-sm);font-weight:600;color:var(--text-muted)}.setup details.finished[open]>summary{margin-bottom:var(--space-1)}
.setup .steps>.step+.step{border-top:1px solid var(--border)}
.setup .steps .vh{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.setup .steps a{grid-template-columns:16px minmax(0,1fr) auto;row-gap:0;align-items:center;padding:var(--space-2) var(--space-4)}
.setup .steps a::before{grid-row:1/3;margin:0}
.setup .steps a::after{position:static;grid-row:1/3;grid-column:3;align-self:center}
.setup .steps b{grid-column:2;font:600 var(--text-base)/1.3 var(--font-ui)}
.setup .steps span:not(.vh){grid-column:2;font-weight:400}
.setup .steps .done b{font-weight:500;color:var(--text-muted)}
.setup .small a,.settings>.small a{display:inline-flex;align-items:center;min-height:44px}
.sentq{margin:var(--space-4) 0;padding-top:var(--space-3);border-top:1px solid var(--border)}.sentq h3{margin:0 0 var(--space-2)}.why strong{color:var(--text)}.why a{font-weight:600}
.next{margin:0 0 var(--space-5)}
.next .btn.primary{min-height:calc(var(--btn-height) + var(--space-1));padding:0 var(--space-5)}
.send .btns{margin:var(--space-3) 0}
.fixes>details.more{margin-top:var(--space-4)}
details.more>.body>p>a{display:inline-flex;align-items:center;min-height:44px}
details.more>.body .btn.ghost{padding-inline:0;font-weight:400}
.crumbs{display:flex;align-items:center;gap:var(--space-2) var(--space-4);margin:0 0 var(--space-2);font-size:var(--text-sm)}.crumbs a,.crumbs .btn{min-height:44px;display:inline-flex;align-items:center}.crumbs a+a,.crumbs .btn{margin-left:auto;padding:0}
.head .amt{font:600 var(--text-lg)/1.2 var(--font-ui);margin-left:auto}
.fix h2{margin:0 0 var(--space-2)}.fix details.all,.fix details.note{margin:var(--space-3) 0 0}
.matchs{margin-top:var(--space-4)}.match .btn{margin-top:var(--space-2)}
.find{display:flex;gap:var(--space-2);align-items:center;margin:0 0 var(--space-4)}.find input{flex:1 1 auto;min-width:0}
.work{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--space-6);align-items:start}
.doc{position:sticky;top:var(--space-4);background:var(--surface-sunken);border-radius:var(--radius-lg);padding:var(--space-4)}
.doch{font:500 var(--text-xs)/1.4 var(--font-num);color:var(--text-muted);letter-spacing:.1em;text-transform:uppercase;margin:0 0 var(--space-3)}
.frame{display:block;background:var(--frame-bg);padding:0;max-height:calc(100vh - 10rem);overflow:auto}
pre.paper{margin:0 0 var(--space-3);padding:var(--space-4);background:var(--surface-raised);border:1px solid var(--border);font:400 var(--text-sm)/1.6 var(--font-mono);max-height:calc(100vh - 14rem)}
.kv.sum{margin:var(--space-3) 0 0}.kv.sum>div{grid-template-columns:minmax(0,6rem) minmax(0,1fr);padding:var(--space-2) 0}
.grph{font-size:var(--text-base);margin:var(--space-4) 0 var(--space-2)}
.frame img{display:block;width:100%;height:auto;background:var(--surface-raised);border:1px solid var(--border)}
.flags{list-style:none;margin:0 0 var(--space-3);padding:0;display:grid;gap:var(--space-3)}
.flag{background:var(--surface-raised);border:1px solid var(--border);border-radius:var(--radius-lg);padding:0 var(--space-4)}
.flag.req{border-color:var(--warn);box-shadow:inset 0 0 0 1px var(--warn)}
.flag>.frow:last-child{border-bottom:0}
.flag .frow>.sl .meta{flex-basis:100%}
.flag.req [aria-invalid=true]{border-color:var(--warn);box-shadow:inset 0 0 0 1px var(--warn)}
.flag .fh{margin:0;padding:var(--space-2) 0 0;line-height:1.4}.flag.info .fh{padding-bottom:var(--space-2)}
.flag .fh .meta{display:block}
.flag .fx{padding:0 0 var(--space-2)}
.fix .frow{grid-template-columns:minmax(0,10rem) minmax(0,1fr);gap:var(--space-1) var(--space-4);padding:var(--space-2) 0}
.fix .sl .meta{line-height:1.35}
.match{background:var(--surface-raised);border:1px solid var(--border-strong);border-radius:var(--radius-lg);padding:var(--space-4);margin-bottom:var(--space-3)}
.sbar{position:sticky;bottom:var(--space-4);background:var(--surface-page);border:1px solid var(--border);border-top:1px solid var(--border-strong);z-index:4;border-radius:var(--radius-glass);padding:var(--space-2) var(--space-2) var(--space-2) var(--space-4);margin-top:var(--space-4);display:flex;flex-wrap:wrap;gap:var(--space-1) var(--space-2);align-items:center}
.sbar .btn,.bulkbar .btn,.banner .btn{border-radius:var(--radius-pill)}
.sbar .prog{font-size:var(--text-sm);white-space:nowrap}
.sbar>.btn:last-child{margin-left:auto}
.sbar>details{border:0;background:none;margin:0;border-radius:0}
.sbar>details>summary{font-size:var(--text-sm);font-weight:600;display:flex;align-items:center;min-height:44px;padding:0 var(--space-2);list-style:none;color:var(--text-muted)}
.sbar>details>summary::-webkit-details-marker{display:none}
.mgrp{display:grid;gap:var(--space-2);padding:var(--space-2) 0}.mgrp+.mgrp{border-top:1px solid var(--border)}.mgrp p{margin:0}.mgrp .mh{font:600 var(--text-xs)/1.4 var(--font-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted)}
.sbar>details>.body{position:absolute;left:0;right:0;bottom:100%;max-height:60vh;overflow:auto;background:var(--surface-raised);border:1px solid var(--border-strong);border-radius:var(--radius-lg);padding:var(--space-3) var(--space-4)}
.fix{padding-bottom:7rem}
html:has(.sbar){scroll-padding-bottom:7rem}
.rs a.tag{min-height:44px;margin:-12px 0;display:inline-flex;align-items:center}
.rx details{margin:var(--space-2) 0 0}.rx form{margin:0}.rx>.none{margin:var(--space-1) 0 0}
.fixrow{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2) var(--space-4);margin:var(--space-1) 0 0}.fixrow .none{margin:0;flex-basis:100%}
.pmatch{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2) var(--space-4)}.pmatch select,.pmatch input[list]{flex:1 1 14rem;min-width:0}
.likely{display:grid;gap:var(--space-2);margin:var(--space-2) 0 0;padding:var(--space-3) var(--space-4);border:1px dashed var(--border-strong);border-radius:var(--radius-sm);background:var(--surface-page)}.likely__head{margin:0}.likely__why{margin:0;font-size:var(--text-sm);color:var(--text-muted)}.likely .btn{justify-self:start}.fixrow>.likely,.fixrow>.pmatch,.fixrow>details[open]{flex:1 1 100%;margin:0}.fixrow>details{flex:0 0 auto;margin:0;border:0;background:none}.fixrow>details>summary{display:inline-flex;align-items:center;padding:0 var(--space-2);color:var(--accent);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:.2em}.fixrow>details[open]>summary{margin-bottom:var(--space-2)}
.cmp{width:100%;border-collapse:collapse;font-size:var(--text-sm)}.cmp th,.cmp td{text-align:left;padding:var(--space-2) var(--space-3) var(--space-2) 0;border-bottom:1px solid var(--border);vertical-align:baseline;font-weight:400;background:none}.cmp thead th{font-size:var(--text-xs);font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)}.cmp tbody th{font-weight:500;color:var(--text-muted);width:5rem;text-transform:none;letter-spacing:0;font-size:var(--text-sm)}.cmp tbody tr:last-child th,.cmp tbody tr:last-child td{border-bottom:0}.cmp .diff{font-weight:700}.cmp .same{color:var(--success);font-weight:600}
.matchall{margin:0 0 var(--space-4);padding:var(--space-3) var(--space-4);border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface-raised)}.matchall summary{font-weight:600}.matchall ul{list-style:none;margin:var(--space-2) 0;padding:0}.matchall li{padding:var(--space-2) 0;border-bottom:1px solid var(--border);font-size:var(--text-sm)}.matchall li:last-child{border-bottom:0}.matchall li span{display:block;color:var(--text-muted)}
.transfer{display:flex;flex-wrap:wrap;gap:var(--space-2);margin:var(--space-2) 0 0}.transfer select,.transfer input{flex:1 1 10rem;min-width:0}
.stmts{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2) var(--space-4)}.stmts details{flex-basis:100%}
.inline{display:flex;gap:var(--space-2) var(--space-4);align-items:center;flex-wrap:wrap;margin-top:var(--space-2)}
.inline form{display:inline}
.summary{display:flex;gap:var(--space-2) var(--space-4);flex-wrap:wrap;margin:0 0 var(--space-4);font-weight:600}
.summary .red{color:var(--warn)}
.csv{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2) var(--space-4);margin:var(--space-4) 0 0}.csv p{margin:0}
.wizard{list-style:none;display:flex;gap:var(--space-2) var(--space-4);flex-wrap:wrap;margin:0 0 var(--space-5);padding:0;font-weight:600;font-size:var(--text-sm);color:var(--text-muted)}
.wizard>.step{display:flex;align-items:center;gap:var(--space-2)}
.wizard>.step.now{color:var(--text)}
section.part{margin-bottom:var(--space-6)}
section.part>h2{padding-bottom:var(--space-2);border-bottom:1px solid var(--border);margin-bottom:var(--space-4)}
.settings{max-width:720px}
details.sect{background:var(--surface-raised);border:1px solid var(--border);border-top-width:0;border-radius:0;margin:0}
details.sect:first-child{border-top-width:1px;border-radius:var(--radius-lg) var(--radius-lg) 0 0}details.sect:last-child{border-radius:0 0 var(--radius-lg) var(--radius-lg)}
details.sect>summary{display:flex;align-items:center;gap:var(--space-1) var(--space-4);flex-wrap:wrap;min-height:var(--row-height);padding:var(--space-2) var(--space-4);list-style:none}
details.sect>summary::-webkit-details-marker{display:none}
details.sect>summary::after{content:"\\203A";margin-left:auto;font-size:var(--text-xl);color:var(--text-muted);transition:transform .15s}
details.sect[open]>summary::after{transform:rotate(90deg)}
details.sect>summary h2{margin:0}
details.sect>summary .sum{color:var(--text-muted);font-weight:400;font-size:var(--text-sm);min-width:0;overflow-wrap:anywhere}
details.sect>.body{padding:var(--space-2) var(--space-4) var(--space-5);border-top:1px solid var(--border);scroll-margin-top:72px}
details.sect>.body>.banner,details.sect>.body>.warning,details.sect>.body>.alert{margin:0 0 var(--space-3)}
@supports selector(:has(a)){.settings .confirm{display:none}.settings .frow:has(:invalid) .confirm{display:flex}}
.rules>li>details{background:none;border:0;border-radius:0;margin:0}.rules summary{font-weight:600;padding:var(--space-2)}
.add-row,.inline-edit.add-row{margin:var(--space-3) 0 var(--space-4)}
.frow{display:grid;grid-template-columns:minmax(0,14rem) minmax(0,1fr);gap:var(--space-2) var(--space-5);padding:var(--space-3) 0;border-bottom:1px solid var(--border);align-items:start}
.sl{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-1) var(--space-2);padding-top:var(--space-2);min-width:0}
.sl label,.flabel{display:inline;font-weight:600;font-size:var(--text-sm)}
.sl .meta{flex-basis:100%}
.sc{display:grid;gap:var(--space-2);min-width:0}
.sc>p{margin:0;max-width:64ch}
.inline-edit{display:flex;gap:var(--space-2);align-items:center;margin:0}
.inline-edit input{flex:1;min-width:0}
.settings textarea{resize:vertical;min-height:64px}
.sectpart,.setup-rows+h3,.setup-rows+.folds{margin-top:var(--space-5)}
.frow.bad input,.frow.bad textarea,.frow.bad select{border-color:var(--danger);box-shadow:inset 0 0 0 1px var(--danger)}
.meta{font-size:var(--text-sm);color:var(--text-muted);line-height:1.5}
.meta code{font-size:var(--text-xs);padding:1px var(--space-1)}
.meta .btn.ghost,.sc .warning .btn.ghost{min-height:44px;padding:0 var(--space-1)}
.confirm{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-1) var(--space-3)}
.confirm label.check{font-size:var(--text-sm);align-items:center}
details.why{display:inline-block;background:none;border:0;margin:0}
details.why[open]{display:block;flex-basis:100%}
.why>summary{display:inline-flex;align-items:center;min-height:44px;padding:0;list-style:none;font-size:var(--text-sm);color:var(--text-muted);text-decoration:underline;text-underline-offset:.2em}
.why>summary::-webkit-details-marker{display:none}
.why>p{font-size:var(--text-sm);color:var(--text-muted);border-left:3px solid var(--border);padding-left:var(--space-2);margin:var(--space-1) 0 0;max-width:64ch}
.why>form{margin:var(--space-3) 0}
details.add>.scroll{padding:0 var(--space-4) var(--space-4)}
details.group>summary{font:600 var(--text-base)/1.3 var(--font-ui)}
.kv{margin:0}.kv+h3{margin-top:var(--space-4)}
.kv>div{display:grid;grid-template-columns:minmax(0,14rem) minmax(0,1fr);gap:var(--space-1) var(--space-5);padding:var(--space-3) 0;border-bottom:1px solid var(--border)}
.kv>div:last-child{border-bottom:0}
.kv dt{font-weight:600}.kv dd{margin:0;min-width:0}
.cta{margin:var(--space-3) 0}
.parts{gap:var(--space-2)}
.parts li{display:flex;gap:var(--space-3);align-items:center}
.parts li>input{flex:1;min-width:0}
.parts label.check{white-space:nowrap;font-size:var(--text-sm)}
.save{display:flex;justify-content:flex-end;padding:var(--space-3) 0 var(--space-4)}
@media (max-width:899px){
.frow,.fix .frow,.kv>div{grid-template-columns:minmax(0,1fr)}
.sl{padding-top:0}
}
.empty h2{margin:0 0 var(--space-3)}
.manifest{list-style:none;margin:0 0 var(--space-2);padding:var(--space-2) var(--space-3);background:var(--surface-sunken);border:1px solid var(--border);border-radius:var(--radius-md);font:500 var(--text-sm)/1.55 var(--font-mono);overflow-x:auto}
.manifest li{white-space:nowrap}.manifest li+li{padding-left:2ch}.manifest .more{color:var(--text-muted)}
.btns{display:flex;gap:var(--space-2) var(--space-3);flex-wrap:wrap;align-items:center;margin:var(--space-3) 0 var(--space-2)}
.btns form{margin:0;display:flex;gap:var(--space-2) var(--space-3);flex-wrap:wrap;align-items:center}
ol.how{margin:var(--space-1) 0 var(--space-4);padding-left:var(--space-5)}ol.how li{margin:0 0 var(--space-2)}
.kinds{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--space-3);margin:0 0 var(--space-4)}
.kinds label{display:flex;gap:var(--space-3);align-items:flex-start;background:var(--surface-raised);border:1px solid var(--border-strong);border-radius:var(--radius-lg);padding:var(--space-4);font-size:var(--text-base);cursor:pointer}
.kinds label:has(input:checked){border-color:var(--accent);background:var(--surface-accent-quiet);box-shadow:inset 0 0 0 1px var(--accent)}
.kinds input{width:22px;height:22px;min-height:0;margin:var(--space-1) 0 0;flex:none;accent-color:var(--accent)}
.kinds .s{display:block;font-weight:400;font-size:var(--text-sm);color:var(--text-muted)}
.drop{display:grid;place-items:center;gap:var(--space-2);text-align:center;border:1px dashed var(--border-strong);border-radius:var(--radius-lg);background:var(--surface-raised);padding:var(--space-6) var(--space-4);margin:0 0 var(--space-4)}
.drop.over{border-color:var(--accent);background:var(--surface-accent-quiet)}
.drop input[type=file]{max-width:420px}
.queue{list-style:none;margin:0 0 var(--space-4);padding:0;display:grid;gap:var(--space-2)}
.queue li{display:flex;justify-content:space-between;gap:var(--space-3);background:var(--surface-raised);border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-2) var(--space-3);font-weight:600}
.queue li .st{font-weight:400;color:var(--text-muted)}.queue li.bad{border-left:3px solid var(--danger)}.queue li.bad .st{color:var(--danger)}
@media (max-width:960px){.work{grid-template-columns:minmax(0,1fr)}.doc{position:static}.frame,pre.paper{max-height:min(40vh,18rem)}.doc{padding:var(--space-3)}}
@media (max-width:720px){
.cmp thead{display:none}.cmp,.cmp tbody{display:block}.cmp tbody tr{display:grid;grid-template-columns:4rem minmax(0,1fr) auto;gap:0 var(--space-2);padding:var(--space-1) 0;border-bottom:1px solid var(--border)}.cmp tbody tr:last-child{border-bottom:0}.cmp tbody th,.cmp tbody td{padding:0;border:0;width:auto}.cmp tbody th{grid-column:1;grid-row:1/3}.cmp td:nth-child(2){grid-column:2;grid-row:1;min-width:0}.cmp td:nth-child(3){grid-column:2;grid-row:2;min-width:0}.cmp td:nth-child(4){grid-column:3;grid-row:1;text-align:right}.cmp td[data-l]::before{content:attr(data-l) " ";color:var(--text-muted)}.cmp td.dup{display:none}.likely .btn{justify-self:stretch}.likely__head{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}.likely{padding:var(--space-2) var(--space-3)}
}
@media (max-width:640px){
.save .btn{width:100%}
table.stack,table.stack tbody,table.stack tr,table.stack td{display:block;width:100%}
table.stack thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
table.stack tr{padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border)}
table.stack td{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:var(--space-1) var(--space-3);padding:var(--space-1) 0;border:0;text-align:right}
table.stack td::before{content:attr(data-label);color:var(--text-muted);font-size:var(--text-sm);font-weight:600;text-align:left}
table.stack td.lead{font-weight:600;font-size:var(--text-base);text-align:left}table.stack td.lead::before{content:none}
table.stack td.lead a{min-height:44px;display:inline-flex;align-items:center}
main{padding-top:var(--space-4);padding-bottom:var(--space-6)}.head{margin-bottom:var(--space-4)}
.chips{margin-bottom:var(--space-3)}
.card{padding:var(--space-4) var(--space-3)}.flag{padding:0 var(--space-3)}
.next .btn,.empty .btn.primary{width:100%}
.steps{grid-template-columns:minmax(0,1fr);gap:var(--space-2)}
.steps a,.steps li>div{padding:var(--space-3) var(--space-6) var(--space-3) var(--space-4)}
.steps a::after{top:50%;transform:translateY(-50%)}
.sbar{gap:var(--space-1) var(--space-2)}
.sbar>.btn:last-child{flex:1 1 100%;margin-left:0}
.sbar .prog{flex:1 1 auto}
.fields{grid-template-columns:minmax(0,1fr)}
th,td{padding:var(--space-2)}
footer.foot{padding-top:var(--space-3);padding-bottom:var(--space-5)}
}
nav.tabs{display:none}
.seg{margin:0 0 var(--space-4)}.seg ul{display:inline-flex;vertical-align:top;max-width:100%;gap:var(--space-1);list-style:none;margin:0;padding:var(--space-1);background:var(--surface-sunken);border-radius:12px}
.seg a{display:flex;align-items:center;min-height:40px;padding:0 var(--space-4);border:1px solid transparent;border-radius:var(--radius-sm);text-decoration:none;font-weight:500;font-size:var(--text-sm);color:var(--text);white-space:nowrap}
.seg .num{color:var(--text-muted);font-size:var(--text-xs);margin-left:var(--space-1)}
.seg a[aria-current=page]{color:var(--accent);font-weight:600}
@media (hover:hover){.seg a:not([aria-current]):hover{background:var(--surface-page)}}
@media (max-width:879px){
.ready-desktop{display:none}.ready-phone{display:block}.ready-summary{margin:0 0 var(--space-2);font-family:var(--font-num)}.ready-phone .btns{display:grid}.ready-phone .btns .btn{width:100%}.ready-phone details{margin-top:var(--space-2)}
.fix{padding-bottom:11rem}html:has(.sbar){scroll-padding-bottom:calc(var(--tabbar-height) + 11rem)}
body.p-bank .row{grid-template-columns:24px minmax(0,1fr) minmax(0,auto);grid-template-areas:"pick body amt" "pick rs ra" ". date date" ". rx rx"}.p-bank .row>.amt{white-space:normal;overflow-wrap:anywhere}.p-bank .rs{grid-column:2/4;grid-row:2;flex-wrap:nowrap;min-width:0;padding-right:var(--space-7)}.p-bank .ra{grid-column:3;grid-row:2}.p-bank .ra{justify-self:end}.p-bank .ra details.more>.body{min-width:0;width:min(18rem,calc(100vw - 4rem));position:absolute;right:0;top:100%}.p-bank .ra summary span{display:none}
html{scroll-padding-bottom:calc(var(--tabbar-height) + 88px)}
.sbar{position:sticky;bottom:var(--tabbar-height);margin-top:var(--space-3);margin-bottom:0}
body{padding-bottom:var(--tabbar-height)}
body.p-reviewItem{padding-bottom:0}body.p-reviewItem .sbar{bottom:calc(var(--kb,0px) + var(--space-2) + env(safe-area-inset-bottom))}body.p-receipt .sbar{bottom:max(var(--kb,0px),var(--tabbar-height))}
header.top{display:none}
nav.main,.sign-out{display:none}
nav.tabs{display:block;position:fixed;left:max(10px,env(safe-area-inset-left));right:max(10px,env(safe-area-inset-right));bottom:calc(10px + env(safe-area-inset-bottom));z-index:5;border-radius:32px;padding:0 var(--space-1)}
nav.tabs ul{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));max-width:560px;margin:auto;padding:0;list-style:none}
nav.tabs a{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--space-1);min-height:64px;border-radius:28px;padding:var(--space-2) var(--space-1) var(--space-1);text-decoration:none;color:var(--text-muted);font:500 var(--text-xs)/1.2 var(--font-ui);text-align:center;-webkit-tap-highlight-color:transparent}
nav.tabs a[aria-current=page]{color:var(--accent);font-weight:600}
nav.tabs a:active{background:var(--surface-accent-quiet)}
nav.tabs a:focus-visible{outline-offset:-4px}
nav.tabs .ti{position:relative;display:flex}
nav.tabs svg{width:24px;height:24px}
nav.tabs .tabadd .ti{place-items:center;width:48px;height:32px;margin:calc(var(--space-1) * -1) 0;border-radius:16px;background:var(--accent);color:var(--text-on-accent)}nav.tabs .tabadd{color:var(--text)}
nav.tabs .count{position:absolute;z-index:1;top:-5px;left:15px;min-width:20px;padding:0 var(--space-1);line-height:1.3;box-shadow:0 0 0 2px var(--surface-raised)}
body.p-reviewItem nav.tabs{display:none}
body:has(input:not([type=checkbox],[type=radio],[type=file],[type=submit],[type=button]):focus,select:focus,textarea:focus) :is(nav.tabs,.sbar){display:none}
}
@media (max-width:879px) and (hover:hover){nav.tabs a:hover{color:var(--text)}}
.tools{display:flex;align-items:center;gap:var(--space-2) var(--space-4);flex-wrap:wrap;margin:0 0 var(--space-3)}.tools form{margin:0}
form.discard{margin:0}
form.discard>.btn{font-size:var(--text-sm);color:var(--text-muted)}
details.discard{border:0;background:none;margin:0}
details.discard>summary{padding:0 0 0 var(--space-2);font-size:var(--text-sm);color:var(--text-muted);display:flex;align-items:center;justify-content:flex-end;list-style:none}
details.discard>summary::-webkit-details-marker{display:none}
details.discard>.body{padding:var(--space-1) 0 var(--space-2)}
.sbar>details.discard>.body{padding:var(--space-3) var(--space-4)}
.reasons{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center}
.chip{min-height:44px;padding:0 var(--space-4);border:1px dashed var(--border-strong);border-radius:var(--radius-pill);background:none;font:inherit;font-weight:600;font-size:var(--text-sm);color:var(--text);cursor:pointer}
.chip:hover,.chip:focus-visible{border-color:var(--text)}
.ask{margin:0 0 var(--space-2);font-weight:600;color:var(--danger)}
.banner.undo{color:var(--success);padding-block:var(--space-1);padding-right:var(--space-1)}.banner.undo form{margin-left:auto}
.pick{display:flex;align-items:center;justify-content:center;gap:var(--space-3);min-height:44px;font-weight:600;overflow-wrap:anywhere}
[data-bulk-list]{counter-reset:bulk}
[data-bulk-list] .pick input[name=id]:checked{counter-increment:bulk}
.bulktools{display:flex;align-items:center;gap:var(--space-3);margin:0 0 var(--space-2);padding-left:var(--space-4)}
.bulktools [hidden],.bulkbar [hidden]{display:none}
.bulkbar{display:none;position:sticky;bottom:var(--space-5);z-index:4;flex-wrap:wrap;align-items:center;gap:var(--space-2) var(--space-3);width:fit-content;max-width:100%;margin:var(--space-3) auto;padding:var(--space-2) var(--space-2) var(--space-2) var(--space-5);border-radius:var(--radius-glass)}
[data-bulk-list]:has(.pick input[name=id]:checked)+.bulkbar,.bulkbar[data-count]:not([data-count="0"]){display:flex}
html:has(.bulkbar[data-count]:not([data-count="0"])){scroll-padding-bottom:6rem}
.bulkcount{margin:0;flex:1 1 auto;min-height:44px;display:flex;align-items:center;gap:var(--space-3)}
.bulkbar:not([data-count]) [data-bulk-count]::before{content:counter(bulk) " selected"}
.bulkstatus{font-weight:400;color:var(--text-muted)}.bulkstatus:empty{display:none}.bulkstatus.bad{color:var(--danger);font-weight:600}
.bulkacts{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center}
.bulkbar summary{list-style:none}.bulkbar summary::-webkit-details-marker{display:none}
.bulkbar details{margin:0;border:0;background:none}.bulkbar details[open]{flex:1 1 100%}
.bulkbar details>.body{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center;padding:var(--space-2) 0}
.bulkbar .body>.ask{flex:1 1 100%;margin:0}
.bulkbar progress{flex:1 1 100%;height:4px;accent-color:var(--accent)}
.bulkbar .chip{display:inline-flex;align-items:center;gap:var(--space-2)}.bulkbar .chip input{width:auto;min-height:0;margin:0;accent-color:var(--accent)}.bulkbar .chip:has(:checked){border-color:var(--text)}
.bulkfield{display:flex;flex-direction:column;gap:var(--space-1);flex:1 1 14rem;font-size:var(--text-sm);font-weight:600}
.is-pending{opacity:.5}
@media (max-width:879px){.bulkbar{bottom:var(--tabbar-height);width:auto}html:has(.bulkbar[data-count]:not([data-count="0"])){scroll-padding-bottom:calc(var(--tabbar-height) + 9rem)}}
.gone{margin:0 0 var(--space-4)}
@media (prefers-reduced-motion:no-preference){.btn,nav.main a,nav.tabs a,.seg a,.chips a{transition:background-color .15s,border-color .15s,color .15s}.is-pending{transition:opacity .15s}}`;
}
// The paper's 5% grain, from the Mix mockup. A file, not a data: URL, since the page CSP allows
// images from 'self' only. Served at /assets/grain.svg.
export const GRAIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .3 0 0 0 0 .25 0 0 0 0 .15 0 0 0 .05 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;

const NAV_ICONS = {
  home: 'house',
  add: 'plus',
  receipts: 'receipt',
  bank: 'landmark',
  settings: 'sliders-horizontal',
} as const satisfies Record<NavKey, IconName>;
const count = (n: number, what: string) =>
  n > 0 ? ` <span class="count">${n}<span class="vh"> ${what}</span></span>` : '';
const badges = (counts: Counts): Partial<Record<NavKey, string>> => ({
  receipts: count(counts.todo, 'to do'),
  bank: count(counts.missing, counts.missing === 1 ? 'missing a receipt' : 'missing receipts'),
});
const current = (on: boolean) => (on ? ' aria-current="page"' : '');

// One list for the desktop sidebar and the phone tab bar, so both always match.
export const NAV: readonly { key: NavKey; href: string; label: string }[] = [
  { key: 'home', href: '/', label: 'Home' },
  { key: 'receipts', href: '/receipts', label: 'Receipts' },
  { key: 'bank', href: '/payments', label: 'Bank' },
  { key: 'settings', href: '/settings', label: 'Settings' },
];
// Add is in both bars on every page, the same button in the same place: first in the sidebar,
// the middle of the phone's tab bar. From Invoices it opens with Invoices you sent picked.
export const addHref = (view: PageKey) => (view === 'invoices' ? '/add?kind=sales' : '/add');

function nav(active: NavKey | undefined, counts: Counts, add: string): string {
  const badge = badges(counts);
  return `<nav class="main" aria-label="Main"><a class="navadd" href="${add}"${current(active === 'add')}>${icon(NAV_ICONS.add)}Add</a><ul>${NAV.map(
    (t) =>
      `<li><a href="${t.href}"${current(t.key === active)}>${icon(NAV_ICONS[t.key])}${t.label}${badge[t.key] ?? ''}</a></li>`,
  ).join('')}</ul></nav>`;
}
function tabs(active: NavKey | undefined, counts: Counts, add: string): string {
  const badge = badges(counts);
  const tab = (t: { key: NavKey; href: string; label: string }) =>
    `<li><a href="${t.href}"${current(t.key === active)}${t.key === 'add' ? ' class="tabadd"' : ''}><span class="ti">${icon(NAV_ICONS[t.key])}${badge[t.key] ?? ''}</span><span>${t.label}</span></a></li>`;
  const all = [...NAV.slice(0, 2), { key: 'add' as const, href: add, label: 'Add' }, ...NAV.slice(2)];
  return `<nav class="tabs" aria-label="Main"><ul>${all.map(tab).join('')}</ul></nav>`;
}

// Receipts and Invoices are two tabs of one page, always shown, each with its
// count. One Add button follows the open tab. The month carries across.
export type TabCounts = { receipts: number; invoices: number };
export async function tabCounts(env: Env, selected: string | null): Promise<TabCounts> {
  // The same month each list uses: a receipt by its date or arrival, an invoice by its date.
  const count = (kind: string, dated: string) =>
    env.DB.prepare(
      `SELECT count(*) n FROM receipts WHERE kind='${kind}' AND duplicate_of IS NULL AND discarded_at IS NULL${selected ? ` AND substr(${dated},1,7)=?` : ''}`,
    ).bind(...(selected ? [selected] : []));
  const [receipts, invoices] = await env.DB.batch<{ n: number }>([
    count('expense', 'coalesce(issue_date,received_at)'),
    count('sales', 'issue_date'),
  ]);
  return { receipts: receipts?.results[0]?.n ?? 0, invoices: invoices?.results[0]?.n ?? 0 };
}
export function receiptsTabs(counts: TabCounts, active: 'all' | 'invoices', month: string | null = null): string {
  const link = (key: 'all' | 'invoices', href: string, label: string, n: number) =>
    `<li><a href="${href}${month ? `&amp;month=${month}` : ''}"${current(key === active)}>${label} <span class="num">${n}</span></a></li>`;
  // Receipts, all of them, are a folder of the archive on Home.
  return `<nav class="seg" aria-label="Receipts and invoices"><ul>${link('all', '/?in=kind:expense', 'Receipts', counts.receipts)}${link('invoices', '/receipts?view=all&amp;kind=sales', 'Invoices', counts.invoices)}</ul></nav>`;
}
// The To do | All switch of a work list: two links, each with its count.
export function viewSwitch(href: (view: View) => string, counts: Record<View, number>, active: View): string {
  return `<nav class="seg" aria-label="View"><ul>${(['todo', 'all'] as const)
    .map(
      (v) =>
        `<li><a href="${escape(href(v))}" data-view="${v}" data-count="${counts[v]}"${current(v === active)}>${v === 'todo' ? 'To do' : 'All'} (${counts[v]})</a></li>`,
    )
    .join('')}</ul></nav>`;
}
// The words of a step marker, for screen readers: the same three everywhere.
export function stepWord(state: StepState): string {
  return `<span class="vh">${STEP[state]}: </span>`;
}
// The Access sign-out link, for the Settings page head on every screen size.
export function signOutLink(env: Env): string {
  return config(env).access ? buttonLink('signOut', '/cdn-cgi/access/logout') : '';
}

// ---------- A refused form, shown in place ----------
// The id of the message for the form (scope) that was refused.
export const errorId = (scope: string) => `e-${scope.replace(/[^a-z0-9]+/gi, '-')}`;
// The id of a control in a form that shares its control names with others on the page (one rule
// form per rule), so the id carries the form's scope.
export const fieldId = (scope: string, name: string) => `f-${scope.replace(/[^a-z0-9]+/gi, '-')}-${name}`;
// aria on a control, when the refusal named it: invalid, and described by the message.
export function ariaFor(scope: string, name: string): string {
  return failureFor(scope)?.field === name ? ` aria-invalid="true" aria-describedby="${errorId(scope)}"` : '';
}
// The message under a control or form. name picks the control it names; '' means the
// refusal named none; leave it out to show the message whichever control it named.
export function errorLine(scope: string, name?: string): string {
  const failure = failureFor(scope);
  if (!failure || (name !== undefined && name !== (failure.field ?? ''))) return '';
  return `<p class="ferr" id="${errorId(scope)}">${escape(failure.message)}</p>`;
}
// Why one payment's match was refused, under its form.
export const matchError = (tx: string) => errorLine(`match:${tx}`);
// The receipt the person chose before a refusal, else the fallback.
export const chosenReceipt = (tx: string): string => String(kept(`match:${tx}`, 'receipt_id', ''));

// Said once at the top of the page, with a link to the control at fault.
function failureSummary(): string {
  const failure = requestState.getStore()?.failure;
  if (!failure) return '';
  const target = failure.target ?? (failure.field ? `f-${failure.field}` : '');
  const link = target ? ` <a href="#${escape(target)}">Go to it</a>` : '';
  return `<div class="alert" role="alert"><p><strong>Nothing was saved.</strong> ${escape(failure.message)}${link}</p></div>`;
}

const BANNER_ID = 'banner';
const saidNow = () => {
  const params = requestState.getStore()?.params;
  return (params && feedback(params)) || null;
};
// The one status banner: what the last action did, with a next step or an Undo.
function feedbackBanner(): string {
  const said = saidNow();
  if (!said) return '';
  const link = said.link ? ` <a href="${escape(said.link.href)}">${escape(said.link.label)}</a>` : '';
  if (!said.undo) return `<p class="banner" id="${BANNER_ID}" role="status">${escape(said.text)}${link}</p>`;
  const fields = Object.entries(said.undo.fields)
    .map(([k, v]) => `<input type="hidden" name="${escape(k)}" value="${escape(v)}">`)
    .join('');
  return `<div class="banner undo" id="${BANNER_ID}" role="status"><span>${escape(said.text)}${link}</span><form method="post" action="${escape(said.undo.action)}">${fields}${button('undo', { label: said.undo.label })}</form></div>`;
}

// Cross-document view transitions, opted into by the work lists and the receipt page only, since
// both documents of a navigation must carry the rule. Each row is named inline by rowAttrs:
// view-transition-name:auto, which would take the row's id, left the rows unanimated in Chrome 151.
// Nothing is sticky at the top (the nav is a sidebar or a bottom tab bar), so a row a fragment lands
// on keeps 72px above it, the old bar's height plus space-4. Off under reduced motion.
export const VIEW_TRANSITION_CSS = `@view-transition{navigation:auto}
@media (prefers-reduced-motion:reduce){@view-transition{navigation:none}}
::view-transition-group(*){animation-duration:.25s}
#${BANNER_ID}{view-transition-name:banner}.listhead{view-transition-name:listhead}.fixes{view-transition-name:fixes}
[data-row]{scroll-margin-top:72px}
[data-row]:focus-visible{outline:2px solid var(--focus-ring);outline-offset:-2px}
form[aria-busy=true] .btn:disabled{cursor:progress}`;
// The shortcuts sheet and quick find open on every page, so their rules are in every page's styles.
const SHEET_CSS = `.keys-sheet{border:1px solid var(--border-strong);border-radius:var(--radius-lg);background:var(--surface-raised);color:var(--text);padding:var(--space-5);max-width:min(30rem,calc(100vw - 2rem))}
.keys-sheet::backdrop{background:rgba(0,0,0,.35)}
.keys-sheet header{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3)}.keys-sheet header h2{margin:0}.keys-sheet header form{margin:0}
.keys-sheet h2{margin:0 0 var(--space-3)}.keys-sheet h3{margin:var(--space-4) 0 var(--space-2)}
.keys-list{margin:0}.keys-list>div{display:flex;gap:var(--space-4);align-items:baseline;padding:var(--space-1) 0}
.keys-list dt{flex:0 0 5.5rem}.keys-list dd{margin:0}
kbd{font:500 var(--text-sm)/1.4 var(--font-mono);background:var(--surface-sunken);border:1px solid var(--border-strong);border-radius:var(--radius-sm);padding:0 var(--space-2)}
.keys-sheet form{margin-top:var(--space-4)}
@media (min-width:48rem){.keys-sheet:not(.qfind){width:min(56rem,calc(100vw - 2rem));max-width:56rem}.keys-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 var(--space-5)}}
${FIND_CSS}`;

// A list row the next action can land on: focusable by its #row- fragment, and described by the
// banner when the page has one, so a screen reader reads what happened with the row it lands on.
export const rowAttrs = (id: string) =>
  ` tabindex="-1"${saidNow() ? ` aria-describedby="${BANNER_ID}"` : ''}` +
  ` style="view-transition-name:r-${escape(id)}"`;

// Once per page however many bulk lists it has: the script binds every bar it finds.
const BULK_SCRIPT = '<script src="/assets/bulk.js" defer></script>';
// On a phone the keyboard covers the bottom of the page, and with it the bar that holds Approve.
// The script writes the keyboard's height to --kb, and the bar sits above it.
const KEYBOARD_SCRIPT = '<script src="/assets/keyboard.js" defer></script>';
// Shortcuts and the pending cue, on every page, once.
const KEYS_SCRIPT = '<script src="/assets/keys.js" defer></script><script src="/assets/find.js" defer></script>';
export const KEYBOARD_JS = `(() => {
  const vv = window.visualViewport;
  if (!vv) return;
  const set = () => document.documentElement.style.setProperty('--kb', Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) + 'px');
  vv.addEventListener('resize', set);
  vv.addEventListener('scroll', set);
  set();
})();
`;
export async function page(
  view: PageKey,
  body: string,
  status: number,
  env: Env,
  options: PageOptions = {},
): Promise<Response> {
  const { appName, sourceRepository, access, basePath } = config(env);
  const signOut = access ? '<a href="/cdn-cgi/access/logout" class="sign-out">Sign out</a>' : '';
  const release = sourceRepository
    ? `<a href="${escape(sourceRepository)}/releases/tag/v${version}">${escape(appName)} v${version}</a>`
    : `${escape(appName)} v${version}`;
  const entry: { nav?: NavKey; title: string } = PAGES[view];
  const { title } = entry;
  const heading = options.title ?? (options.detail ? `${title} · ${options.detail}` : title);
  const said = saidNow();
  const event = said ? `${said.text.replace(/\.$/, '')} · ` : '';
  const head = options.head ?? pageHead(escape(heading));
  const counts = await navCounts(env);
  const markup = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content">${options.refresh ? `<meta http-equiv="refresh" content="${options.refresh}">` : ''}<title>${escape(event + heading)} · ${escape(appName)}</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials"><meta name="theme-color" content="${THEME_COLOR}"><meta name="apple-mobile-web-app-title" content="${escape(shortName(appName))}"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="default"><style>${styles(basePath)}${SHEET_CSS}${options.style ?? ''}</style></head><body class="p-${view}"><div class="grain"></div><a class="skip" href="#main">Skip to content</a><header class="top"><div class="bar"><a class="brand" href="/">${escape(appName)}</a>${nav(entry.nav, counts, addHref(view))}${signOut}</div></header>${tabs(entry.nav, counts, addHref(view))}<main id="main" tabindex="-1">${head}${failureSummary()}${feedbackBanner()}${body}${body.includes(' data-bulk-list=') ? BULK_SCRIPT : ''}${view === 'reviewItem' || view === 'receipt' ? KEYBOARD_SCRIPT : ''}${KEYS_SCRIPT}</main><footer class="foot"><p class="notice">${escape(FOOTER_NOTICE)}</p><p>${release} · <a href="/help">Help</a></p></footer>${keysSheet()}${findSheet()}SPRITE<script src="/assets/app.js" defer></script></body></html>`;
  return new Response(
    markup.replace('SPRITE', () => sprite(markup)),
    {
      status: requestState.getStore()?.failure?.status ?? status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // The rules live in a file, not an inline script.
        'Speculation-Rules': `"${basePath}/assets/speculation-rules.json"`,
      },
    },
  );
}
// Chrome and Edge fetch a tab as the pointer rests on it (or on press, on a
// phone), so the page is often loaded by the time the click lands. Only the
// tab bars, which are plain reads; other browsers ignore the header.
export const SPECULATION_RULES = JSON.stringify({
  prefetch: [
    {
      where: {
        and: [{ selector_matches: 'nav.main a, nav.tabs a' }, { not: { selector_matches: '[aria-current=page]' } }],
      },
      eagerness: 'moderate',
    },
  ],
});

// The page header: the title and at most one action. No kicker, no subtitle. HTML in.
// back: where a screen without a tab goes back to. The installed app has no browser back or address
// bar, so such a screen names its way out: its list, or Home.
export function pageHead(title: string, aside = '', back?: { href: string; label: string }): string {
  const crumb = back ? `<div class="crumbs"><a href="${escape(back.href)}">\u2039 ${escape(back.label)}</a></div>` : '';
  return `${crumb}<div class="head"><h1>${title}</h1>${aside}</div>`;
}
export const BACK_HOME = { href: '/', label: 'Home' };
export const BACK_BANK = { href: '/payments', label: 'Bank' };
// The header of a month screen: the month is the h1, between its neighbours.
export function monthHead(path: string, selected: string, aside = ''): string {
  return `<div class="head">${monthSwitcher(path, selected)}${aside}</div>`;
}
// An empty state: one line and the single next step. HTML in.
export function emptyState(line: string, action = ''): string {
  return `<div class="card empty"><h2>${line}</h2>${action}</div>`;
}
// Quiet words beside a row's one status: a transfer, money in, who set a payment aside.
export function tag(label: string): string {
  return `<span class="tag">${label}</span>`;
}
// Rarely used actions, behind one More per object. name says whose (for screen readers).
export function more(body: string, name = '', open = false): string {
  return `<details class="more"${open ? ' open' : ''}>${buttonSummary('more', { attrs: name ? ` aria-label="More for ${name}"` : '' })}<div class="body">${body}</div></details>`;
}
export type Chip = { href: string; label: string; count?: number; current: boolean };
// Filter chips that filter something: a chip whose count is 0 or the whole
// list goes (unless it is the current one), and the row goes when fewer than 2 remain.
// The first chip is "All", whose count is the whole.
export function chipRow(label: string, chips: readonly Chip[]): string {
  const total = chips[0]?.count;
  const shown = chips.filter(
    (c, i) => i === 0 || c.current || c.count === undefined || (c.count > 0 && c.count !== total),
  );
  if (shown.length < 2) return '';
  return `<ul class="chips" aria-label="${label}">${shown
    .map(
      (c) =>
        `<li><a href="${c.href}"${c.current ? ' aria-current="page"' : ''}>${escape(c.label)}${c.count === undefined ? '' : ` (${c.count})`}</a></li>`,
    )
    .join('')}</ul>`;
}

// InputError and 500 responses, inside the layout. Status and message are unchanged.
export function errorPage(env: Env, status: number, message: string, back: string): Promise<Response> {
  const view = status >= 500 ? 'failed' : 'rejected';
  return page(
    view,
    `<div class="alert" role="alert"><p><strong>${escape(message)}</strong></p></div><div class="btns">${buttonLink('back', back, { tone: 'primary' })}${buttonLink('home', '/')}</div>`,
    status,
    env,
  );
}

// A labelled field. The label wraps the control, so no ids are needed.
// scope ties the control to a form that can be refused: it shows what was typed,
// is marked when it was at fault, and carries its message.
export function input(
  name: string,
  value: unknown = '',
  type = 'text',
  label = name.replaceAll('_', ' '),
  {
    hint = '',
    attrs = '',
    wide = false,
    scope = '',
    id = '',
  }: { hint?: string; attrs?: string; wide?: boolean; scope?: string; id?: string } = {},
): string {
  const shown = scope ? kept(scope, name, value) : value;
  const tied = scope ? ` id="${escape(id || `f-${name}`)}"${ariaFor(scope, name)}` : '';
  return `<label${wide ? ' class="wide"' : ''}>${escape(label)}${hint ? ` <span class="hint">${escape(hint)}</span>` : ''}<input name="${escape(name)}" value="${escape(shown)}" type="${escape(type)}"${tied}${attrs}>${scope ? errorLine(scope, name) : ''}</label>`;
}
export function select(
  name: string,
  values: readonly string[],
  current: unknown = '',
  label = name.replaceAll('_', ' '),
  scope = '',
  id = '',
): string {
  const shown = scope ? kept(scope, name, current) : current;
  const tied = scope ? ` id="${escape(id || `f-${name}`)}"${ariaFor(scope, name)}` : '';
  return `<label>${escape(label)}<select name="${escape(name)}"${tied}>${values.map((v) => `<option${v === shown ? ' selected' : ''}>${escape(v)}</option>`).join('')}</select>${scope ? errorLine(scope, name) : ''}</label>`;
}
// Configured products, plus the current value when it is no longer configured,
// so historical rows stay visible and are never silently recategorised.
export function productOptions(env: Env, current: unknown = ''): { id: string; label: string }[] {
  const options: { id: string; label: string }[] = [...config(env).products];
  if (typeof current === 'string' && current && !options.some((p) => p.id === current))
    options.unshift({ id: current, label: `${current} (not configured)` });
  return options;
}
export function productLabel(env: Env, id: string): string {
  return productOptions(env, id).find((p) => p.id === id)?.label ?? id;
}
export function productSelect(
  env: Env,
  name: string,
  current: unknown = '',
  label = name.replaceAll('_', ' '),
  extra = '',
): string {
  return `<label>${escape(label)}<select name="${escape(name)}"${extra}>${productOptions(env, current)
    .map((p) => `<option value="${escape(p.id)}"${p.id === current ? ' selected' : ''}>${escape(p.label)}</option>`)
    .join('')}</select></label>`;
}

export function month(value: string | null): string {
  const result = value ?? new Date().toISOString().slice(0, 7);
  requireInput(/^\d{4}-(0[1-9]|1[0-2])$/.test(result), 'Invalid month');
  return result;
}
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export function monthName(selected: string, withYear = true): string {
  const name = MONTHS[Number(selected.slice(5, 7)) - 1]!;
  return withYear ? `${name} ${selected.slice(0, 4)}` : name;
}
export function shiftMonth(selected: string, by: number): string {
  const index = Number(selected.slice(0, 4)) * 12 + Number(selected.slice(5, 7)) - 1 + by;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}
// "3 Oct 2026". Unparseable input is shown as given.
export function day(value: string | null | undefined, withYear = true): string {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const name = MONTHS[Number(match[2]) - 1]?.slice(0, 3) ?? match[2];
  return `${Number(match[3])} ${name}${withYear ? ' ' + match[1] : ''}`;
}
// "4 Sep", with the year only when it isn't this one.
export function shortDay(value: string): string {
  return day(value, value.slice(0, 4) !== new Date().toISOString().slice(0, 4));
}
// "EUR 82.07", currency code first like the export.
export function amount(minor: number | bigint | null, currency: string | null = 'EUR'): string {
  if (minor === null) return 'no amount';
  return `${escape(currency ?? '')} ${money(minor, currency ?? 'EUR')}`.trim();
}
export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}
export function monthSwitcher(path: string, selected: string): string {
  // The name keeps the visible "Aug" and adds the year, so it says what the
  // link shows (WCAG 2.5.3) and the arrows stay out of it.
  const label = (m: string) => `${monthName(m, false).slice(0, 3)}<span class="vh"> ${m.slice(0, 4)}</span>`;
  const link = (m: string, text: string) =>
    `<a href="${escape(`${path}${path.includes('?') ? '&' : '?'}month=${m}`)}">${text}</a>`;
  const prev = shiftMonth(selected, -1),
    next = shiftMonth(selected, 1);
  return `<div class="months" role="group" aria-label="Month">${link(prev, `${icon('chevron-left')}${label(prev)}`)}<h1>${escape(monthName(selected))}</h1>${link(next, `${label(next)}${icon('chevron-right')}`)}</div>`;
}
// A stamp when the receipt needs you or is being read, Matched once it is paired, nothing when ready.
export function stamp(receipt: Pick<Receipt, 'status' | 'review_reasons_json'>, matched = false): string {
  if (needsReview(receipt)) return statusMark('needs');
  if (receipt.status === 'pending' || receipt.status === 'processing') return statusMark('reading');
  return matched ? statusMark('matched') : '';
}

// Expense receipts dated in the month. Sales invoices have salesMonthRows().
export async function monthRows(env: Env, selected: string): Promise<Receipt[]> {
  return (
    await env.DB.prepare(
      "SELECT * FROM receipts WHERE kind='expense' AND substr(issue_date,1,7)=? AND duplicate_of IS NULL AND discarded_at IS NULL ORDER BY issue_date,id",
    )
      .bind(selected)
      .all<Receipt>()
  ).results;
}
// Sales invoices issued in the month.
export async function salesMonthRows(env: Env, selected: string): Promise<Receipt[]> {
  return (
    await env.DB.prepare(
      "SELECT * FROM receipts WHERE kind='sales' AND substr(issue_date,1,7)=? AND duplicate_of IS NULL AND discarded_at IS NULL ORDER BY issue_date,invoice_number,id",
    )
      .bind(selected)
      .all<Receipt>()
  ).results;
}
// Everything dated in the month that the month package and "sent" cover.
export async function documentRows(env: Env, selected: string): Promise<Receipt[]> {
  const [rows, sales] = await Promise.all([monthRows(env, selected), salesMonthRows(env, selected)]);
  return [...rows, ...sales];
}
export function uploadForm(receiptAddress = '', primary = false, kind: 'expense' | 'sales' = 'expense'): string {
  const mail = receiptAddress ? `Or forward to <code>${escape(receiptAddress)}</code>` : '';
  return `<form action="/upload" method="post" enctype="multipart/form-data" class="upload">${kind === 'sales' ? '<input type="hidden" name="kind" value="sales">' : ''}<label>${kind === 'sales' ? 'Invoice' : 'Receipt'} (PDF or photo)<input required name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp"></label><div class="btns">${button('upload', { tone: primary ? 'primary' : 'secondary' })}${buttonLink('addMany', '/add')}</div>${mail ? `<p class="small">${mail}</p>` : ''}</form>`;
}
export function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}
export const EXPORT_COLUMNS = [
  'date',
  'vendor',
  'invoice_no',
  'net',
  'vat_rate',
  'vat',
  'total',
  'currency',
  'eur_total',
  'product',
  'type',
  'original_id',
  'original_link',
  'matched_bank_transaction',
  'needs_review',
  'review_reasons',
  'eur_source',
  'fx_rate_date',
  'matched_account_id',
  'matched_account_name',
] as const;
// One export row, in EXPORT_COLUMNS order. The month package index reuses it.
export function exportRow(r: Receipt, eur: EurValue, origin: string): unknown[] {
  return [
    r.issue_date,
    csvCell(r.vendor),
    csvCell(r.invoice_number),
    money(r.net_minor, r.currency ?? 'EUR'),
    r.vat_rate_bps === null ? '' : (r.vat_rate_bps / 100).toFixed(2),
    money(r.vat_minor, r.currency ?? 'EUR'),
    money(r.total_minor, r.currency ?? 'EUR'),
    r.currency,
    money(eur.minor),
    csvCell(r.product),
    r.expense_type,
    r.id,
    `${origin}/originals/${r.id}`,
    eur.transaction,
    !isReady(r),
    csvCell(r.review_reasons_json),
    eur.source,
    eur.rateDate,
    csvCell(eur.accountId),
    csvCell(eur.accountName),
  ];
}
export const SALES_COLUMNS = [
  'date',
  'invoice_no',
  'client',
  'client_country',
  'client_vat_id',
  'vat_treatment',
  'net',
  'vat_rate',
  'vat',
  'total',
  'currency',
  'eur_total',
  'due_date',
  'reference',
  'paid_on',
  'paid_how',
  'matched_bank_transaction',
  'original_id',
  'original_link',
  'needs_review',
  'review_reasons',
  'eur_source',
] as const;
// One sales invoice row, in SALES_COLUMNS order.
export function salesRow(r: Receipt, eur: EurValue, origin: string): unknown[] {
  const paid = eur.bookingDate;
  return [
    r.issue_date,
    csvCell(r.invoice_number),
    csvCell(r.client),
    r.client_country,
    csvCell(r.client_vat_id),
    r.vat_treatment,
    money(r.net_minor, r.currency ?? 'EUR'),
    r.vat_rate_bps === null ? '' : (r.vat_rate_bps / 100).toFixed(2),
    money(r.vat_minor, r.currency ?? 'EUR'),
    money(r.total_minor, r.currency ?? 'EUR'),
    r.currency,
    money(eur.minor),
    r.due_date,
    csvCell(r.reference_number),
    paid ?? r.paid_outside_on,
    paid ? 'bank' : r.paid_outside_on ? csvCell(r.paid_outside_note) : '',
    eur.transaction,
    r.id,
    `${origin}/originals/${r.id}`,
    !isReady(r),
    csvCell(r.review_reasons_json),
    eur.source,
  ];
}
export async function exportSalesCsv(env: Env, selected: string, origin: string): Promise<Response> {
  const rows = await salesMonthRows(env, selected);
  const eurs = await eurValues(env, rows);
  const data = rows.map((r, i) => salesRow(r, eurs[i]!, origin));
  return new Response(csvText(SALES_COLUMNS, data), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${config(env).exportPrefix}-sales-${selected}.csv"`,
    },
  });
}
// Spreadsheets open UTF-8 CSVs correctly only with a byte order mark.
export function csvText(fields: readonly string[], data: unknown[][]): string {
  return '﻿' + Papa.unparse({ fields: [...fields], data });
}
export async function exportCsv(env: Env, selected: string, origin: string): Promise<Response> {
  const rows = await monthRows(env, selected);
  const eurs = await eurValues(env, rows);
  const data = rows.map((r, i) => exportRow(r, eurs[i]!, origin));
  return new Response(csvText(EXPORT_COLUMNS, data), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${config(env).exportPrefix}-${selected}.csv"`,
    },
  });
}
