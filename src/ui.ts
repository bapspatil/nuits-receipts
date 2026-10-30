import Papa from 'papaparse';
import { money, requireInput, type Receipt } from './domain';
import { eurValues, type EurValue } from './banking';
import type { Env } from './env';
import { config } from './config';
import { version } from '../package.json';
import { PALETTE, TOKENS_CSS } from './tokens';
import { feedback } from './events';
import { isReady, needsReview } from './flags';
import { LIST_DEFS, RECEIPTS_TODO, type View } from './worklist';
import { STATUS, STEP, type StepState } from './status';
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

export type NavKey = 'home' | 'receipts' | 'bank' | 'settings';
// Every page's place in the nav and its tab title, in one table, so the
// highlighted tab and the title can't drift apart: a page's title is its nav
// label. A page names itself with one of these keys and adds a detail (a
// month, a vendor) after the title.
export const PAGES = {
  home: { nav: 'home', title: 'Home' },
  // A receipt opened to check it, from To do.
  reviewItem: { nav: 'receipts', title: 'Receipts' },
  receipts: { nav: 'receipts', title: 'Receipts' },
  receipt: { nav: 'receipts', title: 'Receipts' },
  invoices: { nav: 'receipts', title: 'Receipts' },
  add: { nav: 'receipts', title: 'Receipts' },
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
export type PageOptions = { detail?: string; head?: string; style?: string; refresh?: number };
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
h1{font-family:var(--font-display);font-size:var(--text-2xl);line-height:1.15;font-weight:700;margin:0}
h2{font-size:var(--text-lg);line-height:1.2;font-weight:600;margin:0 0 var(--space-3)}
h3{font-size:var(--text-base);line-height:1.25;font-weight:600;margin:0 0 var(--space-2)}
p{margin:0 0 var(--space-3)}
code{font:500 .875em/1.4 var(--font-mono);background:var(--surface-sunken);padding:1px var(--space-2);border-radius:var(--radius-sm);overflow-wrap:anywhere}
pre{font:400 var(--text-xs)/1.5 var(--font-mono);background:var(--surface-sunken);padding:var(--space-3);overflow:auto;border-radius:var(--radius-sm);white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px}
main:focus{outline:none}header.top{border-bottom:1px solid var(--border);background:var(--surface-raised)}
.bar{max-width:var(--page-max);margin:auto;padding:0 var(--pad);display:flex;align-items:stretch;gap:var(--space-6);min-height:var(--nav-height)}
.brand{font:700 var(--text-lg)/1 var(--font-display);letter-spacing:-.01em;color:var(--text);text-decoration:none;display:flex;align-items:center;white-space:nowrap;min-height:44px}
nav.main ul{display:flex;gap:var(--space-1);list-style:none;margin:0;padding:0;height:100%}
nav.main li{display:flex}
nav.main a{display:flex;align-items:center;gap:var(--space-2);min-height:44px;padding:0 var(--space-3);text-decoration:none;font-size:var(--text-sm);font-weight:500;color:var(--text-muted);box-shadow:inset 0 -2px 0 transparent;white-space:nowrap}
nav.main a:hover{color:var(--text)}
nav.main a[aria-current=page]{color:var(--accent);font-weight:600;box-shadow:inset 0 -2px 0 var(--accent)}
.count{background:var(--danger);color:var(--text-on-accent);border-radius:var(--radius-pill);font:700 var(--text-xs)/1.4 var(--font-ui);padding:1px var(--space-2);font-variant-numeric:tabular-nums}
.sign-out{margin-left:auto;font-size:var(--text-sm);color:var(--text-muted);min-height:44px;display:flex;align-items:center}
main{flex:1;width:100%;max-width:var(--page-max);margin:auto;padding:var(--space-6) var(--pad) var(--space-7)}
footer.foot{margin-top:var(--space-5);padding:var(--space-4) max(var(--pad),calc((100% - var(--page-max)) / 2 + var(--pad))) var(--space-6);border-top:1px solid var(--border);background:var(--surface-raised);font-size:var(--text-xs);color:var(--text-muted);display:flex;flex-wrap:wrap;justify-content:space-between;gap:var(--space-1) var(--space-5)}
footer.foot p{max-width:70ch;margin:0}
footer.foot a{color:var(--text-muted)}
.head{display:flex;flex-wrap:wrap;align-items:end;justify-content:space-between;gap:var(--space-4);padding-bottom:var(--space-4);border-bottom:1px solid var(--text);margin-bottom:var(--space-5)}
.head.tight{align-items:center;justify-content:flex-start;gap:var(--space-3) var(--space-4)}
.lede{color:var(--text-muted);margin:0 0 var(--space-4);max-width:62ch}
.small,.muted,.hint{font-size:var(--text-sm);color:var(--text-muted);font-weight:400}
.warning{color:var(--danger);font-weight:600}
.months{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-1);flex:1 1 auto;min-width:0}
.months h1{order:-1;flex:1 1 12rem}
.months a{flex:none;padding:0 var(--space-3);min-height:44px;display:inline-flex;align-items:center;gap:var(--space-1);text-decoration:none;font-size:var(--text-sm);font-weight:500;color:var(--text-muted);background:var(--surface-raised);border:1px solid var(--border);border-radius:var(--radius-sm)}
.months a:hover{color:var(--text);border-color:var(--border-strong)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--space-2);min-height:var(--btn-height);padding:0 var(--space-4);border-radius:var(--radius-sm);font:600 var(--text-base)/1.2 var(--font-ui);text-decoration:none;border:1px solid var(--border-strong);cursor:pointer;text-align:center;background:var(--surface-raised);color:var(--text)}
.btn:hover{border-color:var(--text)}
.btn.primary{background:var(--btn-primary-bg);color:var(--btn-primary-text);border-color:var(--btn-primary-bg)}
.btn.primary:hover{background:var(--accent-hover);border-color:var(--accent-hover)}
.btn:disabled{cursor:not-allowed;color:var(--text-muted);background:var(--surface-sunken)}
.btn:active{transform:translateY(1px)}
.linkbtn{text-align:left;background:none;border:0;padding:0 var(--space-2);font:inherit;font-weight:600;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:.2em;color:var(--accent);cursor:pointer;min-height:44px}
a.linkbtn,.inline>a{display:inline-flex;align-items:center;min-height:44px}
.stamp,.tag{display:inline-flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm);font-weight:600;white-space:nowrap;vertical-align:middle}
.stamp::before,.tag.ok::before{content:"";width:8px;height:8px;flex:none;background:currentColor}
.stamp.needs,.stamp.missing{color:var(--danger)}
.stamp.muted,.tag{color:var(--text-muted)}
.stamp.muted::before{background:transparent;box-shadow:inset 0 0 0 1px currentColor}
.tag.ok{color:var(--success)}
a.tag{color:var(--accent);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:.2em}
.head .stamp{height:28px;padding:0 var(--space-3);border:1px solid currentColor;border-radius:var(--radius-sm);background:var(--danger-surface);font-size:var(--text-xs);font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.head .stamp::before{display:none}
.head .stamp.muted{background:var(--surface-sunken)}
.card{background:var(--surface-raised);border:1px solid var(--border);border-radius:var(--radius-sm);padding:var(--space-5);margin-bottom:var(--space-4)}
.card.active{border-top:3px solid var(--accent)}
.total{display:flex;justify-content:space-between;align-items:baseline;gap:var(--space-3);font:600 var(--text-xl)/1.1 var(--font-ui);font-variant-numeric:tabular-nums;margin-bottom:var(--space-2)}
.alert{background:var(--danger-surface);border:1px solid var(--danger);border-left-width:4px;border-radius:var(--radius-sm);padding:var(--space-2) var(--space-3);margin:0 0 var(--space-3)}
.alert p:last-child{margin:0}
.alert a{font-weight:600}
.banner{background:var(--surface-raised);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:var(--radius-sm);padding:var(--space-3) var(--space-4);margin:0 0 var(--space-4);font-size:var(--text-sm);font-weight:500}
.banner:empty{display:none}
label{display:grid;gap:var(--space-2);font-weight:600;font-size:var(--text-sm);align-content:start;min-width:0}
label.check{display:flex;gap:var(--space-2);align-items:center;min-height:44px;font-weight:500;font-size:var(--text-base)}
label.check input{width:22px;height:22px;min-height:0;margin:1px 0 0;flex:none;accent-color:var(--accent)}
input,select,textarea{font:400 var(--text-base)/1.3 var(--font-ui);min-height:var(--field-height);padding:var(--space-2) var(--space-3);border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--surface-raised);color:var(--text);width:100%;max-width:100%}
input:hover,select:hover,textarea:hover{border-color:var(--text)}
input[type=file]{padding:var(--space-2);cursor:pointer}
input[type=file]::file-selector-button{font:600 var(--text-sm)/1.2 var(--font-ui);color:var(--text);background:var(--surface-raised);border:1px solid var(--border-strong);border-radius:var(--radius-sm);padding:var(--space-2) var(--space-3);margin-right:var(--space-3);cursor:pointer}
input[type=file]:hover::file-selector-button{border-color:var(--text)}
input[aria-invalid=true],select[aria-invalid=true],textarea[aria-invalid=true]{border-color:var(--danger);box-shadow:inset 0 0 0 1px var(--danger)}
input[type=checkbox][aria-invalid=true],input[type=radio][aria-invalid=true]{outline:2px solid var(--danger);outline-offset:2px}
input::placeholder{color:var(--text-muted);opacity:1}
.ferr{color:var(--danger);font-weight:600;font-size:var(--text-sm);margin:var(--space-1) 0 0}
.fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--space-4);margin-bottom:var(--space-4)}
.fields .wide{grid-column:1/-1}
fieldset{border:1px solid var(--border);border-radius:var(--radius-sm);padding:var(--space-3) var(--space-4) var(--space-1);margin:0 0 var(--space-4);min-width:0}
legend{font-weight:600;font-size:var(--text-sm);padding:0 var(--space-2)}
details{background:var(--surface-raised);border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:var(--space-3)}
summary{cursor:pointer;font-weight:600;padding:var(--space-2) var(--space-4);min-height:44px;display:list-item}
summary::marker{color:var(--text-muted)}
summary:focus-visible{outline-offset:-2px}
details.more,details.add,details.filters{background:transparent}
details>.body{padding:var(--space-1) var(--space-4) var(--space-4)}
.scroll{overflow-x:auto;max-width:100%}
table{width:100%;border-collapse:collapse;background:var(--surface-raised)}
caption{text-align:left;font-weight:600;padding-bottom:var(--space-2)}
th,td{padding:var(--space-2) var(--space-3);text-align:left;border-bottom:1px solid var(--border);vertical-align:top}
thead th,th[scope=col]{background:var(--surface-sunken);font-size:var(--text-xs);color:var(--text-muted);font-weight:600;letter-spacing:.08em;text-transform:uppercase}
td.n,th.n{text-align:right;white-space:nowrap}
tfoot th,tfoot td{border-bottom:0;border-top:1px solid var(--text);font:600 var(--text-base)/1.2 var(--font-ui)}
.plain{list-style:none;margin:0;padding:0;display:grid;gap:var(--space-3)}
.list{list-style:none;margin:0 0 var(--space-3);padding:0;background:var(--surface-raised);border:1px solid var(--border)}
.list li{display:grid;align-items:baseline;grid-template-columns:minmax(0,1fr) auto;gap:0 var(--space-4);padding:var(--space-2) var(--space-4);border-bottom:1px solid var(--border);line-height:1.4}
.list li:last-child{border-bottom:0}
.list a{font-weight:600;display:inline-flex;align-items:center;min-height:44px}
.list .why{color:var(--danger);font-size:var(--text-sm);font-weight:600;grid-column:1}
.list .ok{color:var(--text-muted);font-size:var(--text-sm);grid-column:1}
.list .amt{text-align:right;font-weight:600;grid-row:1;grid-column:2;white-space:nowrap}
.chips{display:flex;gap:var(--space-2);flex-wrap:wrap;margin:0 0 var(--space-4);padding:0;list-style:none}
.chips a{display:inline-flex;align-items:center;min-height:44px;padding:0 var(--space-4);border:1px solid var(--border-strong);border-radius:var(--radius-sm);text-decoration:none;font-weight:600;font-size:var(--text-sm);color:var(--text);background:var(--surface-raised)}
.chips a[aria-current=page]{border-color:var(--accent);background:var(--accent);color:var(--text-on-accent)}
.held{margin:0 0 var(--space-5)}.held h2{margin:0 0 var(--space-1)}.held>.hint{margin:0 0 var(--space-3)}
.held .list li{display:block}.held .who,.held .subj{margin:0;overflow-wrap:anywhere}.held .btns{margin:var(--space-1) 0 0}.held details.more{margin:0}
.steps{list-style:none;margin:0 0 var(--space-4);padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));background:var(--surface-raised);border:1px solid var(--border)}
.steps li{border-left:1px solid var(--border);border-top:3px solid transparent}
.steps li:first-child{border-left:0}
.steps li.now{border-top-color:var(--accent)}
.steps li.done{border-top-color:var(--success)}
.steps a,.steps li>div{position:relative;display:grid;align-content:start;gap:var(--space-1);height:100%;min-height:var(--row-height);padding:var(--space-4);text-decoration:none;color:var(--text)}
.steps a:hover{background:var(--surface-page)}
.steps li>a>.vh,.steps li>div>.vh{position:static;width:auto;height:auto;overflow:visible;clip-path:none;font-size:var(--text-xs);font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)}
.steps li.now>a>.vh,.steps li.now>div>.vh{color:var(--accent)}
.steps li.done>a>.vh,.steps li.done>div>.vh{color:var(--success)}
.steps b{font:600 var(--text-lg)/1.2 var(--font-ui)}
.steps span:not(.vh){color:var(--text-muted);font-size:var(--text-sm);font-weight:600}.steps span.red{color:var(--danger)}
.steps a::after{content:"\\203A";position:absolute;top:var(--space-4);right:var(--space-4);color:var(--text-muted);font-weight:600}
.setup{margin:0 0 var(--space-5)}.setup h2{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-1) var(--space-3);margin:0 0 var(--space-2)}.setup h2 span{font-size:var(--text-sm);font-weight:600;color:var(--text-muted)}
.setup .steps{display:block;margin-bottom:var(--space-2)}
.setup .steps li,.setup .steps li:first-child{border-left:0;border-top:0;border-bottom:1px solid var(--border)}
.setup .steps li:last-child{border-bottom:0}
.setup .steps .vh{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.setup .steps a{display:grid;grid-template-columns:16px minmax(0,1fr) auto;column-gap:var(--space-3);row-gap:2px;align-items:center;height:auto;padding:var(--space-2) var(--space-4);min-height:var(--row-height)}
.setup .steps a::before{content:"";grid-row:1/3;width:12px;height:12px;border:2px solid var(--text-muted);border-radius:50%}
.setup .steps .now a::before{border-color:var(--accent)}
.setup .steps .done a::before{border-color:var(--success);background:var(--success)}
.setup .steps a::after{position:static;grid-row:1/3;grid-column:3;align-self:center}
.setup .steps b{grid-column:2;font:600 var(--text-base)/1.3 var(--font-ui)}
.setup .steps span:not(.vh){grid-column:2;font-weight:400}
.setup .steps .done b{font-weight:500;color:var(--text-muted)}
.setup .small a,.settings>.small a{display:inline-flex;align-items:center;min-height:44px}
.sentq{margin:var(--space-4) 0 0;padding-top:var(--space-3);border-top:1px solid var(--border)}.sentq h3{margin:0 0 var(--space-2)}.why strong{color:var(--text)}.why a{font-weight:600}
.next{margin:0 0 var(--space-5)}
.next .btn.primary{min-height:calc(var(--btn-height) + var(--space-1));padding:0 var(--space-5)}
.send .btns{margin:var(--space-3) 0}
.fixes>details.more{margin-top:var(--space-4)}
details.more>.body>p>a{display:inline-flex;align-items:center;min-height:44px}
details.more>.body .linkbtn{padding-inline:0;font-weight:400}
.crumbs{display:flex;align-items:center;gap:var(--space-2) var(--space-4);margin:0 0 var(--space-2);font-size:var(--text-sm)}.crumbs a,.crumbs .linkbtn{min-height:44px;display:inline-flex;align-items:center}.crumbs a+a,.crumbs .linkbtn{margin-left:auto;padding:0}
.head .amt{font:600 var(--text-lg)/1.2 var(--font-ui);margin-left:auto}
.fix h2{margin:0 0 var(--space-2)}.fix details.all,.fix details.note{margin:var(--space-3) 0 0}
.matchs{margin-top:var(--space-4)}.match .btn{margin-top:var(--space-2)}
.find{display:flex;gap:var(--space-2);align-items:center;margin:0 0 var(--space-4)}.find input{flex:1 1 auto;min-width:0}
.list.all .ok .stamp{margin-right:var(--space-1)}.list .who{font-weight:600;overflow-wrap:anywhere;min-width:0}
.work{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--space-6);align-items:start}
.doc{position:sticky;top:var(--space-4);background:var(--surface-sunken);border:1px solid var(--border);padding:var(--space-4)}
.doch{font-size:var(--text-xs);color:var(--text-muted);font-weight:600;letter-spacing:.08em;text-transform:uppercase;margin:0 0 var(--space-3)}
.frame{display:block;background:var(--frame-bg);padding:0;max-height:calc(100vh - 10rem);overflow:auto}
pre.paper{margin:0 0 var(--space-3);padding:var(--space-4);background:var(--surface-raised);border:1px solid var(--border);font:400 var(--text-sm)/1.6 var(--font-mono);max-height:calc(100vh - 14rem)}
.kv.sum{margin:var(--space-3) 0 0}.kv.sum>div{grid-template-columns:minmax(0,6rem) minmax(0,1fr);padding:var(--space-2) 0}
.grph{font-size:var(--text-base);margin:var(--space-4) 0 var(--space-2)}
.frame img{display:block;width:100%;height:auto;background:var(--surface-raised);border:1px solid var(--border)}
.flags{list-style:none;margin:0 0 var(--space-3);padding:0;background:var(--surface-raised);border:1px solid var(--border);border-radius:var(--radius-sm)}
.flag{border-left:3px solid var(--danger);padding:0 var(--space-4);border-bottom:1px solid var(--border)}
.flag:last-child{border-bottom:0}
.flag>.srow:last-child{border-bottom:0}
.flag.info,.flag.opt{border-left-color:var(--border-strong)}.flag.read{border-left-color:var(--border)}
.flag .srow>.sl .meta{flex-basis:100%}
.flag .fh{margin:0;padding:var(--space-2) 0 0;line-height:1.4}.flag.info .fh{padding-bottom:var(--space-2)}
.flag .fh .meta{display:block}
.flag .fx{padding:0 0 var(--space-2)}
.fix .srow{grid-template-columns:minmax(0,10rem) minmax(0,1fr);gap:var(--space-1) var(--space-4);padding:var(--space-2) 0}
.fix .sl .meta{line-height:1.35}
.match{background:var(--surface-raised);border:1px solid var(--border-strong);border-radius:var(--radius-sm);padding:var(--space-4);margin-bottom:var(--space-3)}
.sbar{position:sticky;bottom:0;z-index:4;background:var(--surface-raised);border-top:1px solid var(--border-strong);padding:var(--space-2);margin-top:var(--space-4);display:flex;flex-wrap:wrap;gap:var(--space-1) var(--space-4);align-items:center}
.sbar .prog{font-size:var(--text-sm);font-weight:600;white-space:nowrap}
.sbar>.btn:last-child{margin-left:auto}
.sbar>.linkbtn{padding:0 var(--space-2)}
.sbar>details{border:0;background:none;margin:0;border-radius:0}
.sbar>details>summary{font-size:var(--text-sm);font-weight:600;display:flex;align-items:center;min-height:44px;padding:0 var(--space-2);list-style:none;color:var(--text-muted)}
.sbar>details>summary::-webkit-details-marker{display:none}
.sbar>details>.body{position:absolute;left:0;right:0;bottom:100%;max-height:60vh;overflow:auto;background:var(--surface-raised);border:1px solid var(--border-strong);padding:var(--space-3) var(--space-4)}
.fix{padding-bottom:var(--space-4)}
html:has(.sbar){scroll-padding-bottom:7rem}
.pays-h{display:none}
.pays{list-style:none;margin:0 0 var(--space-5);padding:0;background:var(--surface-raised);border:1px solid var(--border)}
.pay{padding:0 var(--space-4);border-bottom:1px solid var(--border)}
.pay:last-child{border-bottom:0}
.pay.missing{box-shadow:inset 3px 0 var(--danger)}
.pay .line{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0 var(--space-4);align-items:baseline;min-height:var(--row-height);align-content:center;padding:var(--space-2) 0}
.pay .who{font-weight:600;min-width:0;overflow-wrap:anywhere}
.pay .amt{font-weight:600;text-align:right;white-space:nowrap}
.pay .meta{grid-column:1;display:flex;flex-wrap:wrap;align-items:center;gap:0 var(--space-3);color:var(--text-muted)}
.pay .st{display:inline-flex;flex-wrap:wrap;align-items:center;gap:0 var(--space-3)}.pay .meta a.tag{min-height:44px;margin:-12px 0;display:inline-flex;align-items:center}
.pay details{margin:var(--space-2) 0 0}
.pay .line>details.more{grid-column:2;grid-row:2;justify-self:end;border:0;background:none;margin:0}
.pay .line>details.more>summary{padding:0;font-size:var(--text-sm);color:var(--text-muted);display:flex;align-items:center}
.pay .line>details.more[open]{grid-column:1/-1;grid-row:3;justify-self:stretch}.pay .line>details.more>.body{padding:var(--space-1) 0 var(--space-2)}
.pay form{margin:0}
.pay>.fixrow,.pay>.none,.pay>.ferr{padding-bottom:var(--space-3)}
.fixrow{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2) var(--space-4);margin:var(--space-1) 0 0}.fixrow .none{margin:0;flex-basis:100%}
.pmatch{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2) var(--space-4)}.pmatch select,.pmatch input[list]{flex:1 1 14rem;min-width:0}
.likely{display:grid;gap:var(--space-2);margin:var(--space-2) 0 0;padding:var(--space-3) var(--space-4);border:1px solid var(--border);border-top:3px solid var(--accent);border-radius:var(--radius-sm);background:var(--surface-raised)}.likely__head{margin:0}.likely__why{margin:0;font-size:var(--text-sm);color:var(--text-muted)}.likely .btn{justify-self:start}.fixrow>.likely,.fixrow>.pmatch,.fixrow>details[open]{flex:1 1 100%;margin:0}.fixrow>details{flex:0 0 auto;margin:0;border:0;background:none}.fixrow>details>summary{display:inline-flex;align-items:center;padding:0 var(--space-2);color:var(--accent);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:.2em}.fixrow>details[open]>summary{margin-bottom:var(--space-2)}
.cmp{width:100%;border-collapse:collapse;font-size:var(--text-sm)}.cmp th,.cmp td{text-align:left;padding:var(--space-2) var(--space-3) var(--space-2) 0;border-bottom:1px solid var(--border);vertical-align:baseline;font-weight:400;background:none}.cmp thead th{font-size:var(--text-xs);font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)}.cmp tbody th{font-weight:500;color:var(--text-muted);width:5rem;text-transform:none;letter-spacing:0;font-size:var(--text-sm)}.cmp tbody tr:last-child th,.cmp tbody tr:last-child td{border-bottom:0}.cmp .diff{font-weight:700}.cmp .same{color:var(--success);font-weight:600}
.matchall{margin:0 0 var(--space-4);padding:var(--space-3) var(--space-4);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:var(--radius-sm);background:var(--surface-raised)}.matchall summary{font-weight:600}.matchall ul{list-style:none;margin:var(--space-2) 0;padding:0}.matchall li{padding:var(--space-2) 0;border-bottom:1px solid var(--border);font-size:var(--text-sm)}.matchall li:last-child{border-bottom:0}.matchall li span{display:block;color:var(--text-muted)}
.transfer{display:flex;flex-wrap:wrap;gap:var(--space-2);margin:var(--space-2) 0 0}.transfer select,.transfer input{flex:1 1 10rem;min-width:0}
.stmts{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2) var(--space-4)}.stmts details{flex-basis:100%}
.inline{display:flex;gap:var(--space-2) var(--space-4);align-items:center;flex-wrap:wrap;margin-top:var(--space-2)}
.inline form{display:inline}
.summary{display:flex;gap:var(--space-2) var(--space-4);flex-wrap:wrap;margin:0 0 var(--space-4);font-weight:600}
.summary .red{color:var(--danger)}
.csv{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2) var(--space-4);margin:var(--space-4) 0 0}.csv p{margin:0}
.wizard{list-style:none;display:flex;gap:var(--space-2) var(--space-4);flex-wrap:wrap;margin:0 0 var(--space-5);padding:0;counter-reset:w;font-weight:600;font-size:var(--text-sm);color:var(--text-muted)}
.wizard li{display:flex;align-items:center;gap:var(--space-2)}
.wizard li::before{counter-increment:w;content:counter(w);width:28px;height:28px;border-radius:var(--radius-sm);display:grid;place-items:center;border:1px solid var(--border-strong);background:var(--surface-raised)}
.wizard li[aria-current=step]{color:var(--text)}.wizard li[aria-current=step]::before{background:var(--accent);color:var(--text-on-accent);border-color:var(--accent)}
.wizard li.done::before{content:"\\2713";background:var(--success-surface);border-color:var(--success);color:var(--success)}
section.part{margin-bottom:var(--space-6)}
section.part>h2{padding-bottom:var(--space-2);border-bottom:1px solid var(--border);margin-bottom:var(--space-4)}
.settings{max-width:720px}
details.sect{background:var(--surface-raised);border:1px solid var(--border);border-top-width:0;border-radius:0;margin:0}
details.sect:first-child{border-top-width:1px}
details.sect>summary{display:flex;align-items:center;gap:var(--space-1) var(--space-4);flex-wrap:wrap;min-height:var(--row-height);padding:var(--space-2) var(--space-4);list-style:none}
details.sect>summary::-webkit-details-marker{display:none}
details.sect>summary::after{content:"\\203A";margin-left:auto;font-size:var(--text-xl);color:var(--text-muted);transition:transform .15s}
details.sect[open]>summary::after{transform:rotate(90deg)}
details.sect>summary h2{margin:0}
details.sect>summary .sum{color:var(--text-muted);font-weight:400;font-size:var(--text-sm);min-width:0;overflow-wrap:anywhere}
details.sect>.body{padding:var(--space-2) var(--space-4) var(--space-5);border-top:1px solid var(--border);scroll-margin-top:72px}
details.sect>.body>.banner,details.sect>.body>.warning,details.sect>.body>.alert{margin:0 0 var(--space-3)}
@supports selector(:has(a)){.setup-form .confirm{display:none}.setup-form .srow:has(:invalid) .confirm{display:flex}}
.rules>li>details{background:none;border:0;border-bottom:1px solid var(--border);border-radius:0;margin:0}.rules summary{font-weight:600;padding:var(--space-2) 0}
.add-row{margin:var(--space-3) 0}
.srow{display:grid;grid-template-columns:minmax(0,14rem) minmax(0,1fr);gap:var(--space-2) var(--space-5);padding:var(--space-3) 0;border-bottom:1px solid var(--border);align-items:start}
.rowlist>.srow:last-child{border-bottom:0}
.sl{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-1) var(--space-2);padding-top:var(--space-2);min-width:0}
.sl label,.flabel{display:inline;font-weight:600;font-size:var(--text-sm)}
.sl .meta{flex-basis:100%}
.sc{display:grid;gap:var(--space-2);min-width:0}
.sc>p{margin:0;max-width:64ch}
.sc.row{display:flex;align-items:center;justify-content:space-between;gap:var(--space-1) var(--space-4);flex-wrap:wrap}
.inline-edit{display:flex;gap:var(--space-2);align-items:center;margin:0}
.inline-edit input{flex:1;min-width:0}
.setup-form textarea{resize:vertical;min-height:64px}
.srow.bad input,.srow.bad textarea,.srow.bad select{border-color:var(--danger);box-shadow:inset 0 0 0 1px var(--danger)}
.meta{font-size:var(--text-sm);color:var(--text-muted);line-height:1.5}
.meta code{font-size:var(--text-xs);padding:1px var(--space-1)}
.meta .linkbtn,.sc .warning .linkbtn{min-height:44px;padding:0 var(--space-1)}
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
.kv{margin:0}
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
.srow,.fix .srow,.kv>div{grid-template-columns:minmax(0,1fr)}
.sl{padding-top:0}
}
.empty h2{margin:0 0 var(--space-3)}
.manifest{list-style:none;margin:0 0 var(--space-2);padding:var(--space-2) var(--space-3);background:var(--surface-sunken);border:1px solid var(--border);border-radius:var(--radius-sm);font:500 var(--text-sm)/1.55 var(--font-mono);overflow-x:auto}
.manifest li{white-space:nowrap}.manifest li+li{padding-left:2ch}.manifest .more{color:var(--text-muted)}
.btns{display:flex;gap:var(--space-2) var(--space-3);flex-wrap:wrap;align-items:center;margin:var(--space-3) 0 var(--space-2)}
.btns form{margin:0;display:flex;gap:var(--space-2) var(--space-3);flex-wrap:wrap;align-items:center}
ol.how{margin:var(--space-1) 0 var(--space-4);padding-left:var(--space-5)}ol.how li{margin:0 0 var(--space-2)}
.kinds{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--space-3);margin:0 0 var(--space-4)}
.kinds label{display:flex;gap:var(--space-3);align-items:flex-start;background:var(--surface-raised);border:1px solid var(--border-strong);border-radius:var(--radius-sm);padding:var(--space-4);font-size:var(--text-base);cursor:pointer}
.kinds label:has(input:checked){border-color:var(--accent);background:var(--surface-accent-quiet);box-shadow:inset 0 0 0 1px var(--accent)}
.kinds input{width:22px;height:22px;min-height:0;margin:var(--space-1) 0 0;flex:none;accent-color:var(--accent)}
.kinds .s{display:block;font-weight:400;font-size:var(--text-sm);color:var(--text-muted)}
.drop{display:grid;place-items:center;gap:var(--space-2);text-align:center;border:1px dashed var(--border-strong);border-radius:var(--radius-sm);background:var(--surface-raised);padding:var(--space-6) var(--space-4);margin:0 0 var(--space-4)}
.drop.over{border-color:var(--accent);background:var(--surface-accent-quiet)}
.drop input[type=file]{max-width:420px}
.queue{list-style:none;margin:0 0 var(--space-4);padding:0;display:grid;gap:var(--space-2)}
.queue li{display:flex;justify-content:space-between;gap:var(--space-3);background:var(--surface-raised);border:1px solid var(--border);border-radius:var(--radius-sm);padding:var(--space-2) var(--space-3);font-weight:600}
.queue li .st{font-weight:400;color:var(--text-muted)}.queue li.bad{border-left:3px solid var(--danger)}.queue li.bad .st{color:var(--danger)}
@media (min-width:720px){
.pays-h{display:grid;grid-template-columns:5.5rem minmax(0,1fr) 7rem 14rem 4rem;gap:0 var(--space-4);padding:var(--space-2) var(--space-4);background:var(--surface-sunken);border:1px solid var(--border);border-bottom:0;font-size:var(--text-xs);font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)}
.pays-h span:nth-child(3){text-align:right}
.pays-h+.pays{border-top:1px solid var(--border)}
.pay .line{grid-template-columns:5.5rem minmax(0,1fr) 7rem 14rem 4rem}
.pay .meta{display:contents}
.pay .when{grid-column:1;grid-row:1}
.pay .who{grid-column:2;grid-row:1}
.pay .amt{grid-column:3;grid-row:1}
.pay .st{grid-column:4;grid-row:1}
.pay .line>details.more{grid-column:5;grid-row:1;justify-self:end}
.pay .line>details.more[open]{grid-column:1/-1;grid-row:2}
}
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
.steps{grid-template-columns:minmax(0,1fr)}
.steps li,.steps li:first-child{border-left:0;border-top:0;border-bottom:1px solid var(--border);border-left:3px solid transparent}
.steps li:last-child{border-bottom:0}
.steps li.now{border-left-color:var(--accent)}.steps li.done{border-left-color:var(--success)}
.steps a,.steps li>div{grid-template-columns:minmax(0,1fr) auto;column-gap:var(--space-3);padding:var(--space-3) var(--space-4)}
.steps li>a>.vh,.steps li>div>.vh{grid-column:1/-1}
.steps a,.steps li>div{padding-right:var(--space-6)}
.steps a::after{top:50%;transform:translateY(-50%)}
.sbar{gap:var(--space-1) var(--space-2);margin-inline:calc(var(--pad) * -1);padding-inline:var(--pad)}
.sbar>.btn:last-child{flex:1 1 100%;margin-left:0}
.sbar .prog{flex:1 1 auto}
.fields{grid-template-columns:minmax(0,1fr)}
th,td{padding:var(--space-2)}
footer.foot{padding-top:var(--space-3);padding-bottom:var(--space-5)}
}
nav.tabs{display:none}
.seg ul{display:inline-flex;max-width:100%;gap:0;list-style:none;margin:0 0 var(--space-4);padding:0;background:var(--surface-raised);border:1px solid var(--border-strong);border-radius:var(--radius-sm);overflow:hidden}
.seg a{display:flex;align-items:center;min-height:44px;padding:0 var(--space-4);text-decoration:none;font-weight:600;font-size:var(--text-sm);color:var(--text-muted);white-space:nowrap}
.seg li+li a{border-left:1px solid var(--border-strong)}
.seg .num{font-weight:500;margin-left:var(--space-1)}
.seg a[aria-current=page]{background:var(--accent);color:var(--text-on-accent)}
@media (hover:hover){.seg a:not([aria-current]):hover{color:var(--text);background:var(--surface-page)}}
@media (max-width:879px){
html{scroll-padding-bottom:calc(var(--tabbar-height) + 88px)}
.sbar{position:sticky;bottom:var(--tabbar-height);margin-top:var(--space-3);margin-bottom:0}
body{padding-bottom:var(--tabbar-height)}
body.p-reviewItem{padding-bottom:0}body.p-reviewItem .sbar{bottom:0}
nav.main,.sign-out{display:none}
nav.tabs{display:block;position:fixed;left:0;right:0;bottom:0;z-index:5;background:var(--surface-raised);border-top:1px solid var(--border);padding:0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
nav.tabs ul{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));max-width:560px;margin:auto;padding:0;list-style:none}
nav.tabs a{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--space-1);min-height:3.5rem;padding:var(--space-2) var(--space-1) var(--space-1);text-decoration:none;color:var(--text-muted);font:500 var(--text-xs)/1.2 var(--font-ui);text-align:center;-webkit-tap-highlight-color:transparent}
nav.tabs a::before{content:"";position:absolute;top:-1px;left:0;right:0;height:2px;background:transparent}
nav.tabs a[aria-current=page]{color:var(--accent);font-weight:600}
nav.tabs a[aria-current=page]::before{background:var(--accent)}
nav.tabs a:active{background:var(--surface-page)}
nav.tabs a:focus-visible{outline-offset:-4px}
nav.tabs .ti{position:relative;display:flex}
nav.tabs svg{width:24px;height:24px}
nav.tabs .count{position:absolute;top:-5px;left:15px;padding:0 var(--space-1);line-height:1.3;box-shadow:0 0 0 2px var(--surface-raised)}
body.p-reviewItem nav.tabs{display:none}
body:has(input:not([type=checkbox],[type=radio],[type=file],[type=submit],[type=button]):focus,select:focus,textarea:focus) :is(nav.tabs,.sbar){display:none}
}
@media (max-width:879px) and (hover:hover){nav.tabs a:hover{color:var(--text)}}
.tools{display:flex;align-items:center;gap:var(--space-2) var(--space-4);flex-wrap:wrap;margin:0 0 var(--space-3)}.tools form{margin:0}
.list li:has(>.discard)>.why{align-self:center}
form.discard{grid-column:2;grid-row:2;justify-self:end;margin:0}
form.discard>.linkbtn{padding:0 0 0 var(--space-2);font-size:var(--text-sm);color:var(--text-muted);text-decoration:none}
details.discard{grid-column:2;grid-row:2;justify-self:end;border:0;background:none;margin:0}
details.discard>summary{padding:0 0 0 var(--space-2);font-size:var(--text-sm);color:var(--text-muted);display:flex;align-items:center;justify-content:flex-end;list-style:none}
details.discard>summary::-webkit-details-marker{display:none}
details.discard[open]{grid-column:1/-1;grid-row:3;justify-self:stretch}
details.discard>.body{padding:var(--space-1) 0 var(--space-2)}
.sbar>details.discard>.body{padding:var(--space-3) var(--space-4)}
.reasons{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center}
.chip{min-height:44px;padding:0 var(--space-4);border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--surface-raised);font:inherit;font-weight:600;font-size:var(--text-sm);color:var(--text);cursor:pointer}
.chip:hover,.chip:focus-visible{border-color:var(--text)}
.ask{margin:0 0 var(--space-2);font-weight:600;color:var(--danger)}
.banner.undo{display:flex;align-items:center;gap:var(--space-2);padding-top:0;padding-bottom:0;min-height:44px}.banner.undo form{margin-left:auto}
.pick{display:flex;align-items:center;gap:var(--space-3);min-height:44px;font-weight:600;overflow-wrap:anywhere}.pick input{width:20px;height:20px;flex:none;accent-color:var(--accent)}
.list.all li>form{grid-column:2;grid-row:2;justify-self:end}
[data-bulk-list]{counter-reset:bulk}
[data-bulk-list] .pick{min-width:44px;justify-content:center}
[data-bulk-list] .pick input[name=id]:checked{counter-increment:bulk}
[data-bulk-list] li:has(>.pick){position:relative;padding-left:var(--space-8)}
[data-bulk-list] li>.pick{position:absolute;left:var(--space-2);top:var(--space-2)}
[data-bulk-list] .pays-h{padding-left:var(--space-8)}
.bulktools{display:flex;align-items:center;gap:var(--space-3);padding-left:var(--space-2)}
.bulktools [hidden],.bulkbar [hidden]{display:none}
.bulkbar{display:none;position:sticky;bottom:0;z-index:4;flex-wrap:wrap;align-items:center;gap:var(--space-2) var(--space-3);margin:var(--space-3) 0;padding:var(--space-2) max(var(--space-4),env(safe-area-inset-right)) var(--space-2) max(var(--space-4),env(safe-area-inset-left));background:var(--surface-raised);border-top:1px solid var(--border);box-shadow:var(--shadow-raised)}
[data-bulk-list]:has(.pick input[name=id]:checked)+.bulkbar,.bulkbar[data-count]:not([data-count="0"]){display:flex}
html:has(.bulkbar[data-count]:not([data-count="0"])){scroll-padding-bottom:6rem}
.bulkcount{margin:0;flex:1 1 auto;min-height:44px;display:flex;align-items:center;gap:var(--space-3);font-weight:600}
.bulkbar:not([data-count]) [data-bulk-count]::before{content:counter(bulk) " selected"}
.bulkstatus{font-weight:400;color:var(--text-muted)}.bulkstatus:empty{display:none}.bulkstatus.bad{color:var(--danger);font-weight:600}
.bulkacts{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center}
.bulkbar summary{list-style:none}.bulkbar summary::-webkit-details-marker{display:none}
.bulkbar details{margin:0;border:0;background:none}.bulkbar details[open]{flex:1 1 100%}
.bulkbar details>.body{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center;padding:var(--space-2) 0}
.bulkbar .body>.ask{flex:1 1 100%;margin:0}
.bulkbar .btn.danger{color:var(--danger);border-color:var(--danger)}.bulkbar .btn.danger:hover{background:var(--danger-surface)}
.bulkbar progress{flex:1 1 100%;height:4px;accent-color:var(--accent)}
.bulkbar .chip{display:inline-flex;align-items:center;gap:var(--space-2)}.bulkbar .chip input{width:auto;min-height:0;margin:0;accent-color:var(--accent)}.bulkbar .chip:has(:checked){border-color:var(--text)}
.bulkfield{display:flex;flex-direction:column;gap:var(--space-1);flex:1 1 14rem;font-size:var(--text-sm);font-weight:600}
.is-pending{opacity:.5}
@media (max-width:879px){.bulkbar{bottom:var(--tabbar-height)}html:has(.bulkbar[data-count]:not([data-count="0"])){scroll-padding-bottom:calc(var(--tabbar-height) + 9rem)}}
.gone{margin:0 0 var(--space-4)}
@media (prefers-reduced-motion:no-preference){.btn,nav.main a,nav.tabs a,.seg a,.chips a{transition:background-color .15s,border-color .15s,color .15s}.is-pending{transition:opacity .15s}}`;
}
// The tab icon, the same file as site/public/favicon.svg. Served at /favicon.svg.
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="${PALETTE.paper}"/><path d="M5 2h14v19l-2.33-1.5L14.33 21 12 19.5 9.67 21l-2.34-1.5L5 21z" fill="${PALETTE.petrol900}"/><path d="M8 7h8M8 10.5h8M8 14h5" stroke="${PALETTE.paper}" stroke-width="1.6" stroke-linecap="round"/></svg>`;

const svg = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
const ICONS = {
  home: svg('<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>'),
  receipts: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6m-6 4h6m-6 4h3"/>'),
  bank: svg('<path d="M3 10 12 4l9 6"/><path d="M5 10v8m4.67-8v8m4.66-8v8M19 10v8M3 21h18"/>'),
  settings: svg('<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
};
const count = (n: number, what: string) =>
  n > 0 ? ` <span class="count">${n}<span class="vh"> ${what}</span></span>` : '';
const badges = (counts: Counts): Partial<Record<NavKey, string>> => ({
  receipts: count(counts.todo, 'to do'),
  bank: count(counts.missing, counts.missing === 1 ? 'missing a receipt' : 'missing receipts'),
});
const current = (on: boolean) => (on ? ' aria-current="page"' : '');

// One list for the wide header and the phone tab bar, so both always match.
export const NAV: readonly { key: NavKey; href: string; label: string }[] = [
  { key: 'home', href: '/', label: 'Home' },
  { key: 'receipts', href: '/receipts', label: 'Receipts' },
  { key: 'bank', href: '/payments', label: 'Bank' },
  { key: 'settings', href: '/settings', label: 'Settings' },
];

function nav(active: NavKey | undefined, counts: Counts): string {
  const badge = badges(counts);
  return `<nav class="main" aria-label="Main"><ul>${NAV.map(
    (t) => `<li><a href="${t.href}"${current(t.key === active)}>${t.label}${badge[t.key] ?? ''}</a></li>`,
  ).join('')}</ul></nav>`;
}
function tabs(active: NavKey | undefined, counts: Counts): string {
  const badge = badges(counts);
  return `<nav class="tabs" aria-label="Main"><ul>${NAV.map(
    (t) =>
      `<li><a href="${t.href}"${current(t.key === active)}><span class="ti">${ICONS[t.key]}${badge[t.key] ?? ''}</span>${t.label}</a></li>`,
  ).join('')}</ul></nav>`;
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
  return `<nav class="seg" aria-label="Receipts and invoices"><ul>${link('all', '/receipts?view=all', 'Receipts', counts.receipts)}${link('invoices', '/receipts?view=all&amp;kind=sales', 'Invoices', counts.invoices)}</ul></nav>`;
}
// The To do | All switch of a work list: two links, each with its count.
export function viewSwitch(href: (view: View) => string, counts: Record<View, number>, active: View): string {
  return `<ul class="chips" aria-label="View">${(['todo', 'all'] as const)
    .map(
      (v) =>
        `<li><a href="${escape(href(v))}" data-view="${v}" data-count="${counts[v]}"${current(v === active)}>${v === 'todo' ? 'To do' : 'All'} (${counts[v]})</a></li>`,
    )
    .join('')}</ul>`;
}
// The one Add button of the Receipts page; its label and target follow the open tab.
export function addButton(active: 'all' | 'invoices', primary: boolean): string {
  const [href, label] = active === 'invoices' ? ['/add?kind=sales', 'Add invoice'] : ['/add', 'Add receipt'];
  return `<a class="btn ${primary ? 'primary' : 'secondary'}" href="${href}">${label}</a>`;
}
// The words of a step marker, for screen readers: the same three everywhere.
export function stepWord(state: StepState): string {
  return `<span class="vh">${STEP[state]}: </span>`;
}
// The Access sign-out link, for the Settings page head on every screen size.
export function signOutLink(env: Env): string {
  return config(env).access ? '<a class="btn secondary" href="/cdn-cgi/access/logout">Sign out</a>' : '';
}

// ---------- A refused form, shown in place ----------
// The id of the message for the form (scope) that was refused.
export const errorId = (scope: string) => `e-${scope.replace(/[^a-z0-9]+/gi, '-')}`;
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
  return `<div class="banner undo" id="${BANNER_ID}" role="status"><span>${escape(said.text)}${link}</span><form method="post" action="${escape(said.undo.action)}">${fields}<button class="linkbtn">${escape(said.undo.label ?? 'Undo')}</button></form></div>`;
}

// Cross-document view transitions, opted into by the work lists and the receipt page only, since
// both documents of a navigation must carry the rule. Each row is named inline by rowAttrs:
// view-transition-name:auto, which would take the row's id, left the rows unanimated in Chrome 151.
// scroll-margin-top keeps the row a fragment lands on clear of the header. Off under reduced motion.
export const VIEW_TRANSITION_CSS = `@view-transition{navigation:auto}
@media (prefers-reduced-motion:reduce){@view-transition{navigation:none}}
::view-transition-group(*){animation-duration:.25s}
#${BANNER_ID}{view-transition-name:banner}.listhead{view-transition-name:listhead}.fixes{view-transition-name:fixes}
[data-row]{scroll-margin-top:calc(var(--nav-height) + var(--space-4))}
[data-row]:focus-visible{outline:2px solid var(--focus-ring);outline-offset:-2px}`;
// A list row the next action can land on: focusable by its #row- fragment, and described by the
// banner when the page has one, so a screen reader reads what happened with the row it lands on.
export const rowAttrs = (id: string) =>
  ` tabindex="-1"${saidNow() ? ` aria-describedby="${BANNER_ID}"` : ''}` +
  ` style="view-transition-name:r-${escape(id)}"`;

// Once per page however many bulk lists it has: the script binds every bar it finds.
const BULK_SCRIPT = '<script src="/assets/bulk.js" defer></script>';
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
  const heading = options.detail ? `${title} · ${options.detail}` : title;
  const said = saidNow();
  const event = said ? `${said.text.replace(/\.$/, '')} · ` : '';
  const head = options.head ?? pageHead(escape(heading));
  const counts = await navCounts(env);
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${options.refresh ? `<meta http-equiv="refresh" content="${options.refresh}">` : ''}<title>${escape(event + heading)} · ${escape(appName)}</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><style>${styles(basePath)}${options.style ?? ''}</style></head><body class="p-${view}"><a class="skip" href="#main">Skip to content</a><header class="top"><div class="bar"><a class="brand" href="/">${escape(appName)}</a>${nav(entry.nav, counts)}${signOut}</div></header>${tabs(entry.nav, counts)}<main id="main" tabindex="-1">${head}${failureSummary()}${feedbackBanner()}${body}${body.includes(' data-bulk-list=') ? BULK_SCRIPT : ''}</main><footer class="foot"><p class="notice">${escape(FOOTER_NOTICE)}</p><p>${release} · <a href="/help">Help</a></p></footer></body></html>`,
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
export function pageHead(title: string, aside = ''): string {
  return `<div class="head"><h1>${title}</h1>${aside}</div>`;
}
// The header of a month screen: the month is the h1, between its neighbours.
export function monthHead(path: string, selected: string, aside = ''): string {
  return `<div class="head">${monthSwitcher(path, selected)}${aside}</div>`;
}
// An empty state: one line and the single next step. HTML in.
export function emptyState(line: string, action = ''): string {
  return `<div class="card empty"><h2>${line}</h2>${action}</div>`;
}
// Quiet status for things that need nothing: muted text, a green word when it is done. The word
// says what happened. The square before it is a second cue: hollow when the app did it.
export function tag(label: string, ok = false): string {
  return `<span class="tag${ok ? ' ok' : ''}">${label}</span>`;
}
// Rarely used actions, behind one More per object. name says whose (for screen readers).
export function more(body: string, name = '', open = false): string {
  return `<details class="more"${open ? ' open' : ''}><summary${name ? ` aria-label="More for ${name}"` : ''}>More</summary><div class="body">${body}</div></details>`;
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
    `<div class="alert" role="alert"><p><strong>${escape(message)}</strong></p></div><div class="btns"><a class="btn primary" href="${escape(back)}">Go back</a><a class="linkbtn" href="/">Home</a></div>`,
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
  }: { hint?: string; attrs?: string; wide?: boolean; scope?: string } = {},
): string {
  const shown = scope ? kept(scope, name, value) : value;
  const tied = scope ? ` id="f-${escape(name)}"${ariaFor(scope, name)}` : '';
  return `<label${wide ? ' class="wide"' : ''}>${escape(label)}${hint ? ` <span class="hint">${escape(hint)}</span>` : ''}<input name="${escape(name)}" value="${escape(shown)}" type="${escape(type)}"${tied}${attrs}>${scope ? errorLine(scope, name) : ''}</label>`;
}
export function select(
  name: string,
  values: readonly string[],
  current: unknown = '',
  label = name.replaceAll('_', ' '),
  scope = '',
): string {
  const shown = scope ? kept(scope, name, current) : current;
  const tied = scope ? ` id="f-${escape(name)}"${ariaFor(scope, name)}` : '';
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
  return `<div class="months" role="group" aria-label="Month">${link(prev, `<span aria-hidden="true">‹</span>${label(prev)}`)}<h1>${escape(monthName(selected))}</h1>${link(next, `${label(next)}<span aria-hidden="true">›</span>`)}</div>`;
}
// A stamp only when the receipt needs you; quiet text otherwise, nothing when ready.
export function stamp(receipt: Pick<Receipt, 'status' | 'review_reasons_json'>, matched = false): string {
  if (needsReview(receipt)) return `<span class="stamp needs">${STATUS.needs}</span>`;
  if (receipt.status === 'pending' || receipt.status === 'processing') return tag(STATUS.reading);
  return matched ? tag(STATUS.matched, true) : '';
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
  return `<form action="/upload" method="post" enctype="multipart/form-data" class="upload">${kind === 'sales' ? '<input type="hidden" name="kind" value="sales">' : ''}<label>${kind === 'sales' ? 'Invoice' : 'Receipt'} (PDF or photo)<input required name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp"></label><div class="btns"><button class="btn ${primary ? 'primary' : 'secondary'}">Upload</button><a class="linkbtn" href="/add">Add several</a></div>${mail ? `<p class="small">${mail}</p>` : ''}</form>`;
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
