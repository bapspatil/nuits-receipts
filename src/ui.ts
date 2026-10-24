import Papa from 'papaparse';
import { money, requireInput, type Receipt } from './domain';
import { eurValue } from './banking';
import type { Env } from './env';
import { config } from './config';
import { version } from '../package.json';
import { PALETTE, TOKENS_CSS } from './tokens';
import { feedback } from './events';
import { requestState } from './request';

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

export type NavKey = 'home' | 'review' | 'receipts' | 'bank' | 'settings';
// Every page's place in the nav and its tab title, in one table, so the
// highlighted tab and the title can't drift apart: a page's title is its nav
// label. A page names itself with one of these keys and adds a detail (a
// month, a vendor) after the title.
export const PAGES = {
  home: { nav: 'home', title: 'Home' },
  review: { nav: 'review', title: 'Review' },
  reviewItem: { nav: 'review', title: 'Review' },
  receipts: { nav: 'receipts', title: 'Receipts' },
  receipt: { nav: 'receipts', title: 'Receipts' },
  invoices: { nav: 'receipts', title: 'Receipts' },
  add: { nav: 'receipts', title: 'Receipts' },
  bank: { nav: 'bank', title: 'Bank' },
  import: { nav: 'bank', title: 'Bank' },
  settings: { nav: 'settings', title: 'Settings' },
  // Errors keep the nav quiet: no tab is current.
  rejected: { title: "That didn't work" },
  failed: { title: 'Something went wrong' },
} as const satisfies Record<string, { nav?: NavKey; title: string }>;
export type PageKey = keyof typeof PAGES;
// detail: what this page is about, after the title. style: extra page CSS, appended to the shared sheet.
export type PageOptions = { detail?: string; head?: string; style?: string };
export type Counts = { review: number; missing: number; invoices: boolean };

// Its own query, so a database without the inbound_mail table still counts.
async function heldTotal(env: Env): Promise<number> {
  try {
    return (await env.DB.prepare("SELECT count(*) n FROM inbound_mail WHERE state='held'").first<number>('n')) ?? 0;
  } catch {
    return 0;
  }
}
export async function navCounts(env: Env): Promise<Counts> {
  try {
    const [review, missing, sales] = await env.DB.batch<{ n: number }>([
      env.DB.prepare(
        "SELECT count(*) n FROM receipts WHERE status='needs_review' AND duplicate_of IS NULL AND discarded_at IS NULL",
      ),
      env.DB.prepare(`SELECT count(*) n ${MISSING_PAYMENTS}`),
      env.DB.prepare("SELECT count(*) n FROM (SELECT 1 FROM receipts WHERE kind='sales' LIMIT 1)"),
    ]);
    return {
      // Unknown-sender emails wait in Review too.
      review: (review?.results[0]?.n ?? 0) + (await heldTotal(env)),
      missing: missing?.results[0]?.n ?? 0,
      // The Invoices you sent view appears once invoice email is set up or an invoice exists.
      invoices: !!config(env).invoicesAddress || (sales?.results[0]?.n ?? 0) > 0,
    };
  } catch {
    // An error page must still render when the database is the problem.
    return { review: 0, missing: 0, invoices: !!config(env).invoicesAddress };
  }
}

// Inline CSS is not touched by the base-path rewriter, so font URLs carry the
// base path here. Tokens come from site/src/styles/theme.css.
function styles(base: string): string {
  const font = (name: string) => `url("${base}/assets/fonts/${name}.woff2?v=${version}") format("woff2")`;
  return `@font-face{font-family:"Bricolage";src:${font('bricolage')};font-weight:600 800;font-display:swap}
@font-face{font-family:"Instrument Sans";src:${font('instrument-sans')};font-weight:400 600;font-display:swap}
${TOKENS_CSS}
:root{--pad:max(clamp(16px,4vw,48px),env(safe-area-inset-left),env(safe-area-inset-right))}
*,*::before,*::after{box-sizing:border-box}
html{background:var(--surface-page);color:var(--text);font:400 var(--text-base)/1.5 var(--font-ui);-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;overflow-wrap:break-word}
a{color:var(--text);text-underline-offset:.18em}
:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px;box-shadow:0 0 0 2px var(--surface-page)}
.skip{position:absolute;left:-9999px;top:8px}.skip:focus{left:16px;z-index:9;background:var(--surface-raised);padding:var(--space-2) var(--space-3);border:1.5px solid var(--border-strong)}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.num,td.n,.amt{font-variant-numeric:tabular-nums}
h1,h2,h3{font-family:var(--font-display);color:var(--text)}
h1{font-size:var(--text-2xl);line-height:1.15;font-weight:750;letter-spacing:-.02em;margin:0}
h2{font-size:var(--text-lg);line-height:1.2;font-weight:700;margin:0 0 var(--space-3)}
h3{font-size:1.0625rem;line-height:1.25;font-weight:700;margin:0 0 var(--space-2)}
p{margin:0 0 var(--space-3)}
code{font:500 .875em/1.4 var(--font-mono);background:var(--surface-sunken);padding:var(--space-1) var(--space-2);border-radius:var(--radius-sm);overflow-wrap:anywhere}
pre{font:400 var(--text-xs)/1.5 var(--font-mono);background:var(--surface-sunken);padding:var(--space-3);overflow:auto;border-radius:var(--radius-sm);white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px}
header.top{border-bottom:1px solid var(--border-strong);background:var(--surface-page)}
.bar{max-width:960px;margin:auto;padding:0 var(--pad);display:flex;align-items:center;gap:var(--space-5);min-height:var(--nav-height)}
.brand{font:750 1.2rem/1 var(--font-display);letter-spacing:-.02em;text-decoration:none;display:flex;gap:var(--space-2);align-items:center;white-space:nowrap;min-height:44px}
.brand svg{width:18px;height:18px;flex:none}
nav.main ul{display:flex;gap:var(--space-1);list-style:none;margin:0;padding:0}
nav.main a{display:flex;align-items:center;gap:var(--space-2);min-height:44px;padding:var(--space-1) var(--space-3) 0;text-decoration:none;font-weight:600;color:var(--text-muted);border-bottom:3px solid transparent;white-space:nowrap}
nav.main a:hover{color:var(--text);border-bottom-color:var(--border)}
nav.main a[aria-current=page]{color:var(--text);border-bottom-color:var(--border-strong)}
.count{background:var(--danger);color:var(--surface-raised);border-radius:var(--radius-pill);font:700 var(--text-xs)/1.4 var(--font-ui);padding:1px var(--space-2);font-variant-numeric:tabular-nums}
.sign-out{margin-left:auto;font-size:var(--text-sm);color:var(--text-muted);min-height:44px;display:flex;align-items:center}
main{flex:1;width:100%;max-width:960px;margin:auto;padding:var(--space-5) var(--pad) var(--space-7)}
footer.foot{width:100%;max-width:960px;margin:auto;padding:var(--space-5) var(--pad) var(--space-7);border-top:1px solid var(--border);font-size:var(--text-sm);color:var(--text-muted)}
footer.foot p{max-width:70ch;margin:0 0 var(--space-2)}
footer.foot a{color:var(--text-muted)}
.head{display:flex;flex-wrap:wrap;align-items:end;justify-content:space-between;gap:var(--space-4);margin-bottom:var(--space-5)}
.head.tight{align-items:center;justify-content:flex-start}
.lede{color:var(--text-muted);margin:0 0 var(--space-4);max-width:62ch}
.small,.muted,.hint{font-size:var(--text-sm);color:var(--text-muted);font-weight:400}
.warning{color:var(--danger);font-weight:600}
.months{display:flex;align-items:center;gap:var(--space-1);min-width:0}
.months h1{padding:0 var(--space-1)}
.months a{flex:none;padding:0 var(--space-3);min-height:44px;display:inline-flex;align-items:center;text-decoration:none;font-weight:600;color:var(--text-muted);border-radius:var(--radius-pill)}
.months a:hover{background:var(--surface-raised);color:var(--text)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--space-2);min-height:var(--btn-height);padding:0 var(--space-5);border-radius:var(--radius-pill);font:600 var(--text-base)/1.1 var(--font-ui);text-decoration:none;border:1.5px solid var(--border-strong);cursor:pointer;text-align:center;background:transparent;color:var(--text)}
.btn.primary{background:var(--btn-primary-bg);color:var(--btn-primary-text);min-height:calc(var(--btn-height) + var(--space-1));padding:0 var(--space-5)}
.btn.primary:hover{background:var(--accent-hover)}
.btn.secondary:hover{background:var(--surface-raised)}
.btn:active{transform:translateY(1px)}
.linkbtn{text-align:left;background:none;border:0;padding:0 var(--space-2);font:inherit;font-weight:600;text-decoration:underline;text-underline-offset:.18em;color:var(--text);cursor:pointer;min-height:44px}
a.linkbtn,.inline>a{display:inline-flex;align-items:center;min-height:44px}
.stamp{display:inline-block;font:800 var(--text-xs)/1 var(--font-display);letter-spacing:.08em;text-transform:uppercase;padding:var(--space-2) var(--space-2) var(--space-1);border:2px solid currentColor;border-radius:var(--radius-md);white-space:nowrap;vertical-align:middle}
.head .stamp{transform:rotate(-2deg)}
.stamp.needs{color:var(--stamp-needs);background:var(--surface-raised)}
.stamp.missing{background:var(--stamp-missing);color:var(--surface-raised);border-color:var(--stamp-missing)}
.stamp.muted{color:var(--text-muted);border-color:var(--text-muted);background:var(--surface-raised)}
.tag{display:inline-flex;align-items:center;gap:var(--space-1);font-size:var(--text-sm);font-weight:600;color:var(--text-muted);white-space:nowrap}
.tag.ok::before{content:"\\2713";color:var(--stamp-ok)}
.card{background:var(--surface-raised);border:1px solid var(--border);border-radius:var(--radius-sm);padding:var(--space-5);margin-bottom:var(--space-4)}
.card.active{border-color:var(--border-strong);box-shadow:var(--shadow-raised)}
.card.quiet{background:transparent;border-style:dashed}
.rule{border:0;border-top:1.5px dashed var(--border);margin:var(--space-4) 0}
.total{display:flex;justify-content:space-between;align-items:baseline;gap:var(--space-3);font:750 var(--text-xl)/1.1 var(--font-display);font-variant-numeric:tabular-nums;margin-bottom:var(--space-2)}
.alert{background:var(--danger-surface);border:1px solid var(--danger);border-left-width:4px;border-radius:var(--radius-sm);padding:var(--space-2) var(--space-3);margin:0 0 var(--space-3)}
.alert p:last-child{margin:0}
.banner{background:var(--success-surface);border:1px solid var(--border-strong);border-radius:var(--radius-sm);padding:var(--space-3) var(--space-4);margin:0 0 var(--space-4);font-weight:600}
.banner:empty{display:none}
label{display:grid;gap:var(--space-2);font-weight:600;font-size:var(--text-sm);align-content:start;min-width:0}
label.check{display:flex;gap:var(--space-2);align-items:center;min-height:44px;font-weight:500;font-size:.9375rem}
label.check input{width:22px;height:22px;min-height:0;margin:1px 0 0;flex:none;accent-color:var(--accent)}
input,select,textarea{font:400 var(--text-base)/1.3 var(--font-ui);min-height:var(--field-height);padding:var(--space-2) var(--space-3);border:1.5px solid var(--text-muted);border-radius:var(--radius-sm);background:var(--surface-raised);color:var(--text);width:100%;max-width:100%}
input[type=file]{padding:var(--space-2)}
input[aria-invalid=true]{border-color:var(--danger);border-width:2px}
.fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--space-4);margin-bottom:var(--space-4)}
.fields .wide{grid-column:1/-1}
fieldset{border:1px dashed var(--border);border-radius:var(--radius-sm);padding:var(--space-3) var(--space-4) var(--space-1);margin:0 0 var(--space-4);min-width:0}
legend{font-weight:600;font-size:var(--text-sm);padding:0 var(--space-2)}
details{background:var(--surface-raised);border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:var(--space-3)}
summary{cursor:pointer;font-weight:600;padding:var(--space-2) var(--space-4);min-height:44px;display:list-item}
summary::marker{color:var(--text-muted)}
summary:focus-visible{outline-offset:-2px}
details.more{background:transparent;border-style:dashed}
details>.body{padding:var(--space-1) var(--space-4) var(--space-4)}
details.tech{background:transparent;border-style:dashed}
.folds details{margin:0;border-radius:0;border-top-width:0}
.folds details:first-child{border-top-width:1px;border-radius:var(--radius-sm) var(--radius-sm) 0 0}
.folds details:last-child{border-radius:0 0 var(--radius-sm) var(--radius-sm)}
.scroll{overflow-x:auto;max-width:100%}
table{width:100%;border-collapse:collapse;background:var(--surface-raised)}
caption{text-align:left;font-weight:700;padding-bottom:var(--space-2)}
th,td{padding:var(--space-2) var(--space-3);text-align:left;border-bottom:1px solid var(--border);vertical-align:top}
thead th,th[scope=col]{font-size:var(--text-sm);color:var(--text-muted);font-weight:600}
td.n,th.n{text-align:right;white-space:nowrap}
tfoot th,tfoot td{border-bottom:0;border-top:1.5px solid var(--border-strong);font:750 var(--text-lg)/1.2 var(--font-display)}
.plain{list-style:none;margin:0;padding:0;display:grid;gap:var(--space-3)}
.bank-more{margin-top:var(--space-6)}
.list{list-style:none;margin:0 0 var(--space-3);padding:0;border-top:1px solid var(--border)}
.list li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0 var(--space-4);padding:var(--space-2) 0;border-bottom:1px solid var(--border);line-height:1.4}
.list a{font-weight:600;display:inline-flex;align-items:center;min-height:44px}
.list .why{color:var(--danger);font-size:var(--text-sm);grid-column:1}
.list .ok{color:var(--text-muted);font-size:var(--text-sm);grid-column:1}
.list .amt{text-align:right;font-weight:600;grid-row:1;grid-column:2;white-space:nowrap}
.chips{display:flex;gap:var(--space-2);flex-wrap:wrap;margin:0 0 var(--space-4);padding:0;list-style:none}
.chips a{display:inline-flex;align-items:center;min-height:44px;padding:0 var(--space-4);border:1px solid var(--text-muted);border-radius:var(--radius-pill);text-decoration:none;font-weight:600;font-size:.9375rem;background:var(--surface-raised)}
.chips a[aria-current=page]{border-color:var(--border-strong);background:var(--accent);color:var(--text-on-accent)}
.held{margin:0 0 var(--space-5)}.held h2,.recent h2{margin:0 0 var(--space-1)}.held>.hint,.recent>.hint{margin:0 0 var(--space-3)}
.held .list li{display:block}.held .who,.held .subj{margin:0;overflow-wrap:anywhere}.held .btns{margin:var(--space-1) 0 0}.held details.more{margin:0}
.steps{list-style:none;margin:0 0 var(--space-4);padding:0;border-top:1px solid var(--border)}
.steps li{border-bottom:1px solid var(--border)}
.steps a,.steps li>div{display:flex;align-items:center;gap:var(--space-3);min-height:var(--row-height);padding:var(--space-2) 0;text-decoration:none;color:var(--text)}
.steps a::before,.steps li>div::before{content:"";flex:none;width:16px;height:16px;border-radius:50%;border:2px solid var(--text-muted);font:700 var(--text-xs)/12px var(--font-ui);text-align:center}
.steps .now a::before,.steps .now>div::before{background:var(--accent);border-color:var(--border-strong)}
.steps .done a::before,.steps .done>div::before{content:"\\2713";background:var(--success-surface);border-color:var(--border-strong);color:var(--text)}
.steps b{font:700 var(--text-lg)/1.2 var(--font-display);flex:1}
.steps span{color:var(--text-muted);font-weight:600}.steps span.red{color:var(--danger)}
.steps a::after{content:"›";color:var(--text-muted);font-weight:600}
.next{margin:0 0 var(--space-4)}.send .btns{margin:var(--space-3) 0}.dated{margin:var(--space-4) 0 0}.dated a{display:inline-flex;align-items:center;min-height:44px}
.checks li:first-child a.btn{justify-self:start;margin:var(--space-1) 0}
.fixes>details.more{margin-top:var(--space-4)}
.crumbs{display:flex;align-items:center;gap:var(--space-2) var(--space-4);margin:0 0 var(--space-2)}.crumbs a,.crumbs .linkbtn{min-height:44px;display:inline-flex;align-items:center}.crumbs .linkbtn{margin-left:auto;padding:0}
.head .amt{font:700 1.25rem/1.2 var(--font-ui);margin-left:auto}
.fix h2{margin:0 0 var(--space-2)}.fix details.all,.fix details.note{margin:var(--space-3) 0 0}
.matchs{margin-top:var(--space-4)}.match .btn{margin-top:var(--space-2)}
input::placeholder{color:var(--text-muted);opacity:1}
.find{display:flex;gap:var(--space-2);align-items:center;margin:0 0 var(--space-4)}.find input{flex:1 1 auto;min-width:0}
.list.all .ok .stamp{font-size:var(--text-xs);padding:var(--space-1) var(--space-2) var(--space-1);margin-right:var(--space-1)}.list .who{font-weight:600;overflow-wrap:anywhere;min-width:0}
.work{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:var(--space-6);align-items:start}
.doc{position:sticky;top:16px}
.frame{display:block;background:var(--frame-bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:var(--space-4);max-height:calc(100vh - 120px);overflow:auto}
.frame img{display:block;width:100%;height:auto;background:var(--surface-raised);box-shadow:var(--shadow-raised)}
.flags{list-style:none;margin:0 0 var(--space-3);padding:0;background:var(--surface-raised);border:1px solid var(--border);border-radius:var(--radius-sm)}
.flag{border-left:3px solid var(--danger);padding:0 var(--space-4);border-bottom:1px solid var(--border)}
.flag:last-child{border-bottom:0}
.flag>.srow:last-child{border-bottom:0}
.flag.info{border-left-color:var(--text-muted)}
.flag .fh{margin:0;padding:var(--space-2) 0 0;line-height:1.4}.flag.info .fh{padding-bottom:var(--space-2)}
.flag .fh .meta{display:block}
.flag .fx{padding:0 0 var(--space-2)}
.fix .srow{grid-template-columns:minmax(0,11rem) minmax(0,1fr);gap:var(--space-1) var(--space-4);padding:var(--space-2) 0}
.fix .sl .meta{line-height:1.35}
.match{background:var(--surface-raised);border:1.5px dashed var(--text-muted);border-radius:var(--radius-sm);padding:var(--space-4) var(--space-4);margin-bottom:var(--space-3)}
.actions{border-top:1px solid var(--border-strong);padding:var(--space-3) 0 0;margin-top:var(--space-3);display:flex;gap:var(--space-2) var(--space-4);align-items:center;flex-wrap:wrap}
.pays{list-style:none;margin:0 0 var(--space-5);padding:0}
.pay{padding:var(--space-2) 0;border-bottom:1px solid var(--border)}
.pay.missing{box-shadow:inset 4px 0 var(--danger);padding-left:var(--space-4)}
.pay .line{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0 var(--space-4);align-items:baseline;min-height:44px;align-content:center}
.pay .who{font-weight:600;min-width:0;overflow-wrap:anywhere}
.pay .amt{font-weight:700;text-align:right;white-space:nowrap}
.pay .meta{grid-column:1;color:var(--text-muted);font-size:var(--text-sm)}
.pay .meta .stamp{font-size:var(--text-xs);padding:var(--space-1) var(--space-2);margin-left:var(--space-1)}.pay .meta a.tag{display:inline-flex;align-items:center;min-height:44px;margin:-12px 0}
.pay details{margin:var(--space-2) 0 0}
.pay .line>details.more{grid-column:2;grid-row:2;justify-self:end;border:0;background:none;margin:0}
.pay .line>details.more>summary{padding:0;font-size:var(--text-sm);color:var(--text-muted);display:flex;align-items:center}
.pay .line>details.more[open]{grid-column:1/-1;grid-row:3;justify-self:stretch}.pay .line>details.more>.body{padding:var(--space-1) 0 var(--space-2)}
.pay form{margin:0}
.fixrow{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2) var(--space-4);margin:var(--space-2) 0 0}.fixrow .none{margin:0;flex-basis:100%}
.pmatch{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2) var(--space-4)}.pmatch select{flex:1 1 14rem;min-width:0}.pmatch .check{margin:0}
.transfer{display:flex;flex-wrap:wrap;gap:var(--space-2);margin:var(--space-2) 0 0}.transfer select,.transfer input{flex:1 1 10rem;min-width:0}
.stmts{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2) var(--space-4)}.stmts details{flex-basis:100%}
.inline{display:flex;gap:var(--space-2) var(--space-4);align-items:center;flex-wrap:wrap;margin-top:var(--space-2)}
.inline form{display:inline}
.summary{display:flex;gap:var(--space-2) var(--space-4);flex-wrap:wrap;margin:0 0 var(--space-4);font-weight:600}
.summary .red{color:var(--danger)}
.csv{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2) var(--space-4);margin:var(--space-4) 0 0}.csv p{margin:0}
.wizard{list-style:none;display:flex;gap:var(--space-2);flex-wrap:wrap;margin:0 0 var(--space-5);padding:0;counter-reset:w;font-weight:600;font-size:.9375rem;color:var(--text-muted)}
.wizard li{display:flex;align-items:center;gap:var(--space-2)}
.wizard li::before{counter-increment:w;content:counter(w);width:28px;height:28px;border-radius:50%;display:grid;place-items:center;border:1.5px solid var(--text-muted)}
.wizard li[aria-current=step]{color:var(--text)}.wizard li[aria-current=step]::before{background:var(--accent);color:var(--text-on-accent);border-color:var(--border-strong)}
.wizard li.done::before{content:"\\2713";background:var(--success-surface);border-color:var(--border-strong);color:var(--text)}
section.part{margin-bottom:var(--space-6)}
section.part>h2{padding-bottom:var(--space-2);border-bottom:1px solid var(--border-strong);margin-bottom:var(--space-4)}
.settings{max-width:720px}
details.sect{background:transparent;border:0;border-bottom:1px solid var(--border);border-radius:0;margin:0}
details.sect:first-child{border-top:1px solid var(--border)}
details.sect>summary{display:flex;align-items:center;gap:var(--space-1) var(--space-4);flex-wrap:wrap;min-height:var(--row-height);padding:var(--space-2) 0;list-style:none}
details.sect>summary::-webkit-details-marker{display:none}
details.sect>summary::after{content:"\\203A";margin-left:auto;font-size:1.25rem;color:var(--text-muted);transition:transform .15s}
details.sect[open]>summary::after{transform:rotate(90deg)}
details.sect>summary h2{margin:0}
details.sect>summary .sum{color:var(--text-muted);font-weight:400;font-size:var(--text-sm);min-width:0;overflow-wrap:anywhere}
details.sect>.body{padding:0 0 var(--space-5);scroll-margin-top:72px}
details.sect>.body>.banner,details.sect>.body>.warning,details.sect>.body>.alert{margin:0 0 var(--space-3)}
details.sect[open] .save .btn{background:var(--accent);color:var(--text-on-accent);border-color:var(--border-strong)}
@supports selector(:has(a)){.setup-form .confirm{display:none}.setup-form .srow:has(:invalid) .confirm{display:flex}}
.rules>li>details{background:none;border:0;border-bottom:1px solid var(--border);border-radius:0;margin:0}.rules summary{font-weight:600;padding:var(--space-2) 0}
.add-row{margin:var(--space-3) 0}
.sect .card{padding:var(--space-1) var(--space-5);margin-bottom:var(--space-3)}
.srow{display:grid;grid-template-columns:minmax(0,14rem) minmax(0,1fr);gap:var(--space-2) var(--space-5);padding:var(--space-3) 0;border-bottom:1px solid var(--border);align-items:start}
.rowlist>.srow:last-child{border-bottom:0}
.sl{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-1) var(--space-2);padding-top:var(--space-2);min-width:0}
.sl label,.flabel{display:inline;font-weight:600;font-size:.9375rem}
.sl .meta{flex-basis:100%}
.sc{display:grid;gap:var(--space-2);min-width:0}
.sc>p{margin:0;max-width:64ch}
.sc.row{display:flex;align-items:center;justify-content:space-between;gap:var(--space-1) var(--space-4);flex-wrap:wrap}
.inline-edit{display:flex;gap:var(--space-2);align-items:center;margin:0}
.inline-edit input{flex:1;min-width:0}
.setup-form textarea{resize:vertical;min-height:64px}
.srow.bad input,.srow.bad textarea,.srow.bad select{border-color:var(--danger);border-width:2px}
.meta{font-size:var(--text-sm);color:var(--text-muted);line-height:1.5}
.meta code{font-size:var(--text-xs);padding:1px var(--space-1)}
.meta .linkbtn,.sc .warning .linkbtn{min-height:44px;padding:0 var(--space-1)}
.confirm{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-1) var(--space-3)}
.confirm label.check{font-size:var(--text-sm);align-items:center}
details.why{display:inline-block;background:none;border:0;margin:0}
details.why[open]{display:block;flex-basis:100%}
.why>summary{display:inline-flex;align-items:center;min-height:44px;padding:0;list-style:none;font-size:var(--text-sm);color:var(--text-muted);text-decoration:underline;text-underline-offset:.18em}
.why>summary::-webkit-details-marker{display:none}
.why>p{font-size:var(--text-sm);color:var(--text-muted);border-left:3px solid var(--border);padding-left:var(--space-2);margin:var(--space-1) 0 0;max-width:64ch}
.why>form{margin:var(--space-3) 0}
details.add{background:transparent;border-style:dashed}
details.add>.scroll{padding:0 var(--space-4) var(--space-4)}
details.group>summary{font:750 1.0625rem/1.3 var(--font-display)}
.kv{margin:0}
.kv>div{display:grid;grid-template-columns:minmax(0,14rem) minmax(0,1fr);gap:var(--space-1) var(--space-5);padding:var(--space-3) 0;border-bottom:1px solid var(--border)}
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
.manifest{list-style:none;margin:0 0 var(--space-2);padding:var(--space-2) var(--space-3);background:var(--surface-sunken);border:1.5px dashed var(--border);border-radius:var(--radius-sm);font:500 var(--text-sm)/1.55 var(--font-mono);overflow-x:auto}
.manifest li{white-space:nowrap}.manifest li+li{padding-left:2ch}.manifest .more{color:var(--text-muted)}
.btns{display:flex;gap:var(--space-2) var(--space-3);flex-wrap:wrap;align-items:center;margin:var(--space-3) 0 var(--space-2)}
.btns form{margin:0;display:flex;gap:var(--space-2) var(--space-3);flex-wrap:wrap;align-items:center}
ol.how{margin:var(--space-1) 0 var(--space-4);padding-left:var(--space-5)}ol.how li{margin:0 0 var(--space-2)}
.kinds{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--space-3);margin:0 0 var(--space-4)}
.kinds label{display:flex;gap:var(--space-3);align-items:flex-start;background:var(--surface-raised);border:1.5px solid var(--border);border-radius:var(--radius-sm);padding:var(--space-4) var(--space-4);font-size:var(--text-base);cursor:pointer}
.kinds label:has(input:checked){border-color:var(--border-strong);box-shadow:var(--shadow-raised)}
.kinds input{width:22px;height:22px;min-height:0;margin:var(--space-1) 0 0;flex:none;accent-color:var(--accent)}
.kinds .s{display:block;font-weight:400;font-size:var(--text-sm);color:var(--text-muted)}
.drop{display:grid;place-items:center;gap:var(--space-2);text-align:center;border:2px dashed var(--text-muted);border-radius:var(--radius-sm);background:var(--surface-raised);padding:var(--space-6) var(--space-4);margin:0 0 var(--space-4)}
.drop.over{border-color:var(--border-strong);background:var(--success-surface)}
.drop input[type=file]{max-width:420px}
.queue{list-style:none;margin:0 0 var(--space-4);padding:0;display:grid;gap:var(--space-2)}
.queue li{display:flex;justify-content:space-between;gap:var(--space-3);background:var(--surface-raised);border:1px solid var(--border);border-radius:var(--radius-sm);padding:var(--space-2) var(--space-3);font-weight:600}
.queue li .st{font-weight:400;color:var(--text-muted)}.queue li.bad{border-left:4px solid var(--danger)}.queue li.bad .st{color:var(--danger)}
@media (max-width:960px){.work{grid-template-columns:minmax(0,1fr)}.doc{position:static}.frame{max-height:none;width:120px;padding:var(--space-1)}.frame img{max-height:120px;object-fit:contain}}
@media (max-width:640px){
.save .btn{width:100%}
table.stack,table.stack tbody,table.stack tr,table.stack td{display:block;width:100%}
table.stack thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
table.stack tr{padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border)}
table.stack td{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:var(--space-1) var(--space-3);padding:var(--space-1) 0;border:0;text-align:right}
table.stack td::before{content:attr(data-label);color:var(--text-muted);font-size:var(--text-sm);font-weight:600;text-align:left}
table.stack td.lead{font-weight:600;font-size:1.0625rem;text-align:left}table.stack td.lead::before{content:none}
table.stack td.lead a{min-height:44px;display:inline-flex;align-items:center}
h1{font-size:var(--text-xl)}
main{padding-top:var(--space-4);padding-bottom:var(--space-6)}.head{margin-bottom:var(--space-4)}footer.foot{padding:var(--space-4) var(--pad) var(--space-5)}
.chips{margin-bottom:var(--space-3)}
.card{padding:var(--space-4) var(--space-3)}.flag{padding:0 var(--space-3)}
.next .btn,.actions .btn.primary,.empty .btn.primary{width:100%}
.fields{grid-template-columns:minmax(0,1fr)}
th,td{padding:var(--space-2)}
}
nav.tabs{display:none}
.seg ul{display:inline-flex;max-width:100%;gap:var(--space-1);list-style:none;margin:0 0 var(--space-4);padding:var(--space-1);background:var(--surface-raised);border:1px solid var(--border);border-radius:var(--radius-pill)}
.seg a{display:flex;align-items:center;min-height:44px;padding:0 var(--space-4);border-radius:var(--radius-pill);text-decoration:none;font-weight:600;font-size:.9375rem;color:var(--text-muted);white-space:nowrap}
.seg a[aria-current=page]{background:var(--accent);color:var(--text-on-accent)}
@media (hover:hover){.seg a:not([aria-current]):hover{color:var(--text);background:var(--surface-page)}}
@media (max-width:879px){
html{scroll-padding-bottom:calc(var(--tabbar-height) + 88px)}
.fix .actions{position:sticky;bottom:var(--tabbar-height);z-index:4;background:var(--surface-page);padding:var(--space-2) 0;margin:var(--space-3) 0 0}
body{padding-bottom:var(--tabbar-height)}
.bar{min-height:3rem}
nav.main,.sign-out{display:none}
nav.tabs{display:block;position:fixed;left:0;right:0;bottom:0;z-index:5;background:var(--surface-page);border-top:1px solid var(--border-strong);padding:0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
nav.tabs ul{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));max-width:560px;margin:auto;padding:0;list-style:none}
nav.tabs a{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--space-1);min-height:3.5rem;padding:var(--space-2) var(--space-1) var(--space-1);text-decoration:none;color:var(--text-muted);font:600 var(--text-xs)/1.2 var(--font-ui);text-align:center;-webkit-tap-highlight-color:transparent}
nav.tabs a::before{content:"";position:absolute;top:-1px;left:22%;right:22%;height:3px;background:transparent}
nav.tabs a[aria-current=page]{color:var(--text);font-weight:750}
nav.tabs a[aria-current=page]::before{background:var(--accent)}
nav.tabs a:active{background:var(--surface-raised)}
nav.tabs a:focus-visible{outline-offset:-4px}
nav.tabs .ti{position:relative;display:flex}
nav.tabs svg{width:24px;height:24px}
nav.tabs .count{position:absolute;top:-5px;left:15px;padding:0 var(--space-1);line-height:1.3;box-shadow:0 0 0 2px var(--surface-page)}
body:has(input:not([type=checkbox],[type=radio],[type=file],[type=submit],[type=button]):focus,select:focus,textarea:focus) :is(nav.tabs,.fix .actions){display:none}
}
@media (max-width:879px) and (hover:hover){nav.tabs a:hover{color:var(--text)}}
.tools{display:flex;align-items:center;gap:var(--space-2) var(--space-4);flex-wrap:wrap;margin:0 0 var(--space-3)}.tools form{margin:0}.tools .select{margin-left:auto}
.list li:has(>details.discard)>.why{align-self:center}
details.discard{grid-column:2;grid-row:2;justify-self:end;border:0;background:none;margin:0}
details.discard>summary{padding:0 0 0 var(--space-2);font-size:var(--text-sm);color:var(--text-muted);display:flex;align-items:center;justify-content:flex-end;list-style:none}
details.discard>summary::-webkit-details-marker{display:none}
details.discard[open]{grid-column:1/-1;grid-row:3;justify-self:stretch}
details.discard>.body{padding:var(--space-1) 0 var(--space-2)}
.fixes>details.discard{margin:var(--space-3) 0 0}.fixes>details.discard>summary{justify-content:flex-start;padding:0;font-size:var(--text-base);font-weight:600;text-decoration:underline;text-underline-offset:.18em;color:var(--text)}
.reasons{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center}
.chip{min-height:44px;padding:0 var(--space-4);border:1px solid var(--text-muted);border-radius:var(--radius-pill);background:var(--surface-raised);font:inherit;font-weight:600;font-size:.9375rem;color:var(--text);cursor:pointer}
.chip:hover,.chip:focus-visible{border-color:var(--border-strong)}
.ask{margin:0 0 var(--space-2);font-weight:600;color:var(--danger)}
.banner.undo{display:flex;align-items:center;gap:var(--space-2);padding-top:0;padding-bottom:0;min-height:44px}.banner.undo form{margin-left:auto}
.pick{display:flex;align-items:center;gap:var(--space-3);min-height:44px;font-weight:600;overflow-wrap:anywhere}.pick input{width:20px;height:20px;flex:none}
.bulk .bar{position:sticky;bottom:var(--tabbar-height);z-index:4;background:var(--surface-page);padding:var(--space-2) 0;display:flex;gap:var(--space-2) var(--space-4);align-items:center;flex-wrap:wrap;border-top:1px solid var(--border)}
.bulk .bar details.discard>summary{display:none}.bulk .bar details.discard>.body{padding:0}
.list.all li>form{grid-column:2;grid-row:2;justify-self:end}
.gone{margin:0 0 var(--space-4)}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}.btn,nav.main a,nav.tabs a,.seg a,.chips a{transition:background-color .15s,border-color .15s,color .15s}}`;
}
// The tab icon, the same file as site/public/favicon.svg. Served at /favicon.svg.
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="${PALETTE.paper}"/><path d="M5 2h14v19l-2.33-1.5L14.33 21 12 19.5 9.67 21l-2.34-1.5L5 21z" fill="${PALETTE.ink}"/><path d="M8 7h8M8 10.5h8M8 14h5" stroke="${PALETTE.paper}" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const BRAND_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M2 1h12v14l-2-1.3L10 15l-2-1.3L6 15l-2-1.3L2 15zM4.5 4v1.4h7V4zm0 3v1.4h7V7zm0 3v1.4H9V10z"/></svg>';

const svg = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
const ICONS = {
  home: svg('<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>'),
  review: svg('<path d="M9 3h6v4H9z"/><path d="M15 5h3v16H6V5h3"/><path d="m9 14 2 2 4-4"/>'),
  receipts: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6m-6 4h6m-6 4h3"/>'),
  bank: svg('<path d="M3 10 12 4l9 6"/><path d="M5 10v8m4.67-8v8m4.66-8v8M19 10v8M3 21h18"/>'),
  settings: svg('<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
};
const count = (n: number, what: string) =>
  n > 0 ? ` <span class="count">${n}<span class="vh"> ${what}</span></span>` : '';
const badges = (counts: Counts): Partial<Record<NavKey, string>> => ({
  review: count(counts.review, 'waiting'),
  bank: count(counts.missing, counts.missing === 1 ? 'missing a receipt' : 'missing receipts'),
});
const current = (on: boolean) => (on ? ' aria-current="page"' : '');

// One list for the wide header and the phone tab bar, so both always match.
export const NAV: readonly { key: NavKey; href: string; label: string }[] = [
  { key: 'home', href: '/', label: 'Home' },
  { key: 'review', href: '/review', label: 'Review' },
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

// Receipts has two views: every document, and the invoices you sent. The
// second shows once invoice email is set up or an invoice exists.
// The month carries across.
export function receiptsSegment(counts: Counts, active: 'all' | 'invoices', month: string | null = null): string {
  if (!counts.invoices && active === 'all') return '';
  const link = (key: 'all' | 'invoices', href: string, label: string) =>
    `<li><a href="${href}${month ? `?month=${month}` : ''}"${current(key === active)}>${label}</a></li>`;
  return `<nav class="seg" aria-label="Receipts"><ul>${link('all', '/receipts', 'Receipts')}${link('invoices', '/invoices', 'Invoices')}</ul></nav>`;
}
// The Access sign-out link, for the Settings page head on every screen size.
export function signOutLink(env: Env): string {
  return config(env).access ? '<a class="btn secondary" href="/cdn-cgi/access/logout">Sign out</a>' : '';
}

// The one status banner: what the last action did, with a next step or an Undo.
function feedbackBanner(): string {
  const params = requestState.getStore()?.params;
  const said = params && feedback(params);
  if (!said) return '';
  const link = said.link ? ` <a href="${escape(said.link.href)}">${escape(said.link.label)}</a>` : '';
  if (!said.undo) return `<p class="banner" role="status">${escape(said.text)}${link}</p>`;
  const fields = Object.entries(said.undo.fields)
    .map(([k, v]) => `<input type="hidden" name="${escape(k)}" value="${escape(v)}">`)
    .join('');
  return `<div class="banner undo" role="status"><span>${escape(said.text)}${link}</span><form method="post" action="${escape(said.undo.action)}">${fields}<button class="linkbtn">${escape(said.undo.label ?? 'Undo')}</button></form></div>`;
}

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
  const head = options.head ?? pageHead(escape(heading));
  const counts = await navCounts(env);
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escape(heading)} · ${escape(appName)}</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><style>${styles(basePath)}${options.style ?? ''}</style></head><body><a class="skip" href="#main">Skip to content</a><header class="top"><div class="bar"><a class="brand" href="/">${BRAND_ICON}${escape(appName)}</a>${nav(entry.nav, counts)}${signOut}</div></header>${tabs(entry.nav, counts)}<main id="main">${head}${feedbackBanner()}${body}</main><footer class="foot"><p class="notice">${escape(FOOTER_NOTICE)}</p><p>${release}</p></footer></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

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
// Quiet status for things that need nothing: muted text, a tick when it is done.
export function tag(label: string, ok = false): string {
  return `<span class="tag${ok ? ' ok' : ''}">${label}</span>`;
}
// Rarely used actions, behind one More per object. name says whose (for screen readers).
export function more(body: string, name = ''): string {
  return `<details class="more"><summary${name ? ` aria-label="More for ${name}"` : ''}>More</summary><div class="body">${body}</div></details>`;
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
export function input(
  name: string,
  value: unknown = '',
  type = 'text',
  label = name.replaceAll('_', ' '),
  { hint = '', attrs = '', wide = false }: { hint?: string; attrs?: string; wide?: boolean } = {},
): string {
  return `<label${wide ? ' class="wide"' : ''}>${escape(label)}${hint ? ` <span class="hint">${escape(hint)}</span>` : ''}<input name="${escape(name)}" value="${escape(value)}" type="${escape(type)}"${attrs}></label>`;
}
export function select(
  name: string,
  values: readonly string[],
  current: unknown = '',
  label = name.replaceAll('_', ' '),
): string {
  return `<label>${escape(label)}<select name="${escape(name)}">${values.map((v) => `<option${v === current ? ' selected' : ''}>${escape(v)}</option>`).join('')}</select></label>`;
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
  const link = (m: string, text: string) =>
    `<a href="${path}?month=${m}" aria-label="${escape(monthName(m))}">${text}</a>`;
  const prev = shiftMonth(selected, -1),
    next = shiftMonth(selected, 1);
  return `<div class="months" role="group" aria-label="Month">${link(prev, `‹ ${monthName(prev, false).slice(0, 3)}`)}<h1>${escape(monthName(selected))}</h1>${link(next, `${monthName(next, false).slice(0, 3)} ›`)}</div>`;
}
// A stamp only when the receipt needs you; quiet text otherwise, nothing when ready.
export function stamp(receipt: Pick<Receipt, 'status'>, matched = false): string {
  if (receipt.status === 'needs_review') return '<span class="stamp needs">Needs you</span>';
  if (receipt.status === 'pending' || receipt.status === 'processing') return tag('Reading');
  return matched ? tag('Matched', true) : '';
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
  return [...(await monthRows(env, selected)), ...(await salesMonthRows(env, selected))];
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
export async function exportRow(env: Env, r: Receipt, origin: string): Promise<unknown[]> {
  const eur = await eurValue(env, r);
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
    r.status !== 'ready',
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
export async function salesRow(env: Env, r: Receipt, origin: string): Promise<unknown[]> {
  const eur = await eurValue(env, r);
  const paid = eur.transaction
    ? await env.DB.prepare('SELECT booking_date FROM bank_transactions WHERE id=?')
        .bind(eur.transaction)
        .first<string>('booking_date')
    : null;
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
    r.status !== 'ready',
    csvCell(r.review_reasons_json),
    eur.source,
  ];
}
export async function exportSalesCsv(env: Env, selected: string, origin: string): Promise<Response> {
  const rows = await salesMonthRows(env, selected);
  const data = await Promise.all(rows.map((r) => salesRow(env, r, origin)));
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
  const data = await Promise.all(rows.map((r) => exportRow(env, r, origin)));
  return new Response(csvText(EXPORT_COLUMNS, data), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${config(env).exportPrefix}-${selected}.csv"`,
    },
  });
}
