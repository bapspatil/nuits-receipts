import Papa from 'papaparse';
import { money, requireInput, type Receipt } from './domain';
import { eurValue } from './banking';
import type { Env } from './env';
import { config } from './config';
import { version } from '../package.json';

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
// style: extra page CSS, appended to the shared sheet.
export type PageOptions = { nav?: NavKey; head?: string; style?: string };
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
:root{--ink:#0D3A36;--ink-soft:#355650;--paper:#E6EFE9;--slip:#FFFFFF;--guilloche:#C2D8CB;--mint:#9FD3BC;--stamp:#A8123F;--on-stamp:#FFFFFF;--display:"Bricolage","Arial Narrow",system-ui,sans-serif;--ui:"Instrument Sans",system-ui,sans-serif;--r:2px;--pill:999px;--shadow:0 18px 40px -18px rgb(13 58 54/.35);--pad:max(clamp(16px,4vw,48px),env(safe-area-inset-left),env(safe-area-inset-right));--tabs:calc(3.5rem + 1px + env(safe-area-inset-bottom))}
*,*::before,*::after{box-sizing:border-box}
html{background:var(--paper);color:var(--ink);font:400 1rem/1.5 var(--ui);-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;overflow-wrap:break-word}
a{color:var(--ink);text-underline-offset:.18em}
:focus-visible{outline:2px solid var(--ink);outline-offset:2px;box-shadow:0 0 0 2px var(--paper)}
.skip{position:absolute;left:-9999px;top:8px}.skip:focus{left:16px;z-index:9;background:var(--slip);padding:8px 12px;border:1.5px solid var(--ink)}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.num,td.n,.amt{font-variant-numeric:tabular-nums}
h1,h2,h3{font-family:var(--display);color:var(--ink)}
h1{font-size:1.75rem;line-height:1.15;font-weight:750;letter-spacing:-.02em;margin:0}
h2{font-size:1.125rem;line-height:1.2;font-weight:700;margin:0 0 12px}
h3{font-size:1.0625rem;line-height:1.25;font-weight:700;margin:0 0 8px}
p{margin:0 0 12px}
code{font:500 .875em/1.4 ui-monospace,Menlo,Consolas,monospace;background:var(--paper);padding:4px 8px;border-radius:var(--r);overflow-wrap:anywhere}
pre{font:400 .75rem/1.5 ui-monospace,Menlo,Consolas,monospace;background:var(--paper);padding:12px;overflow:auto;border-radius:var(--r);white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px}
header.top{border-bottom:1px solid var(--ink);background:var(--paper)}
.bar{max-width:960px;margin:auto;padding:0 var(--pad);display:flex;align-items:center;gap:24px;min-height:64px}
.brand{font:750 1.2rem/1 var(--display);letter-spacing:-.02em;text-decoration:none;display:flex;gap:8px;align-items:center;white-space:nowrap;min-height:44px}
.brand svg{width:18px;height:18px;flex:none}
nav.main ul{display:flex;gap:4px;list-style:none;margin:0;padding:0}
nav.main a{display:flex;align-items:center;gap:8px;min-height:44px;padding:4px 12px 0;text-decoration:none;font-weight:600;color:var(--ink-soft);border-bottom:3px solid transparent;white-space:nowrap}
nav.main a:hover{color:var(--ink);border-bottom-color:var(--guilloche)}
nav.main a[aria-current=page]{color:var(--ink);border-bottom-color:var(--ink)}
.count{background:var(--stamp);color:var(--on-stamp);border-radius:var(--pill);font:700 .75rem/1.4 var(--ui);padding:1px 8px;font-variant-numeric:tabular-nums}
.sign-out{margin-left:auto;font-size:.875rem;color:var(--ink-soft);min-height:44px;display:flex;align-items:center}
main{flex:1;width:100%;max-width:960px;margin:auto;padding:24px var(--pad) 48px}
footer.foot{width:100%;max-width:960px;margin:auto;padding:24px var(--pad) 48px;border-top:1px solid var(--guilloche);font-size:.875rem;color:var(--ink-soft)}
footer.foot p{max-width:70ch;margin:0 0 8px}
footer.foot a{color:var(--ink-soft)}
.head{display:flex;flex-wrap:wrap;align-items:end;justify-content:space-between;gap:16px;margin-bottom:24px}
.head.tight{align-items:center;justify-content:flex-start}
.lede{color:var(--ink-soft);margin:0 0 16px;max-width:62ch}
.small,.muted,.hint{font-size:.875rem;color:var(--ink-soft);font-weight:400}
.warning{color:var(--stamp);font-weight:600}
.months{display:flex;align-items:center;gap:4px;min-width:0}
.months h1{padding:0 4px}
.months a{flex:none;padding:0 12px;min-height:44px;display:inline-flex;align-items:center;text-decoration:none;font-weight:600;color:var(--ink-soft);border-radius:var(--pill)}
.months a:hover{background:var(--slip);color:var(--ink)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 24px;border-radius:var(--pill);font:600 1rem/1.1 var(--ui);text-decoration:none;border:1.5px solid var(--ink);cursor:pointer;text-align:center;background:transparent;color:var(--ink)}
.btn.primary{background:var(--ink);color:var(--paper);min-height:48px;padding:0 24px}
.btn.primary:hover{background:#082a27}
.btn.secondary:hover{background:var(--slip)}
.btn:active{transform:translateY(1px)}
.linkbtn{text-align:left;background:none;border:0;padding:0 8px;font:inherit;font-weight:600;text-decoration:underline;text-underline-offset:.18em;color:var(--ink);cursor:pointer;min-height:44px}
a.linkbtn,.inline>a{display:inline-flex;align-items:center;min-height:44px}
.stamp{display:inline-block;font:800 .75rem/1 var(--display);letter-spacing:.08em;text-transform:uppercase;padding:8px 8px 4px;border:2px solid currentColor;border-radius:4px;white-space:nowrap;vertical-align:middle}
.head .stamp{transform:rotate(-2deg)}
.stamp.needs{color:var(--stamp);background:var(--slip)}
.stamp.missing{background:var(--stamp);color:var(--on-stamp);border-color:var(--stamp)}
.stamp.muted{color:var(--ink-soft);border-color:var(--ink-soft);background:var(--slip)}
.tag{display:inline-flex;align-items:center;gap:4px;font-size:.875rem;font-weight:600;color:var(--ink-soft);white-space:nowrap}
.tag.ok::before{content:"\\2713";color:var(--ink)}
.card{background:var(--slip);border:1px solid var(--guilloche);border-radius:var(--r);padding:24px;margin-bottom:16px}
.card.active{border-color:var(--ink);box-shadow:var(--shadow)}
.card.quiet{background:transparent;border-style:dashed}
.rule{border:0;border-top:1.5px dashed var(--guilloche);margin:16px 0}
.total{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font:750 1.5rem/1.1 var(--display);font-variant-numeric:tabular-nums;margin-bottom:8px}
.alert{background:#fbeef2;border:1px solid var(--stamp);border-left-width:4px;border-radius:var(--r);padding:8px 12px;margin:0 0 12px}
.alert p:last-child{margin:0}
.banner{background:var(--mint);border:1px solid var(--ink);border-radius:var(--r);padding:12px 16px;margin:0 0 16px;font-weight:600}
.banner:empty{display:none}
label{display:grid;gap:8px;font-weight:600;font-size:.875rem;align-content:start;min-width:0}
label.check{display:flex;gap:8px;align-items:center;min-height:44px;font-weight:500;font-size:.9375rem}
label.check input{width:22px;height:22px;min-height:0;margin:1px 0 0;flex:none;accent-color:var(--ink)}
input,select,textarea{font:400 1rem/1.3 var(--ui);min-height:44px;padding:8px 12px;border:1.5px solid var(--ink-soft);border-radius:var(--r);background:var(--slip);color:var(--ink);width:100%;max-width:100%}
input[type=file]{padding:8px}
input[aria-invalid=true]{border-color:var(--stamp);border-width:2px}
.fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-bottom:16px}
.fields .wide{grid-column:1/-1}
fieldset{border:1px dashed var(--guilloche);border-radius:var(--r);padding:12px 16px 4px;margin:0 0 16px;min-width:0}
legend{font-weight:600;font-size:.875rem;padding:0 8px}
details{background:var(--slip);border:1px solid var(--guilloche);border-radius:var(--r);margin-bottom:12px}
summary{cursor:pointer;font-weight:600;padding:8px 16px;min-height:44px;display:list-item}
summary::marker{color:var(--ink-soft)}
summary:focus-visible{outline-offset:-2px}
details.more{background:transparent;border-style:dashed}
details>.body{padding:4px 16px 16px}
details.tech{background:transparent;border-style:dashed}
.folds details{margin:0;border-radius:0;border-top-width:0}
.folds details:first-child{border-top-width:1px;border-radius:var(--r) var(--r) 0 0}
.folds details:last-child{border-radius:0 0 var(--r) var(--r)}
.scroll{overflow-x:auto;max-width:100%}
table{width:100%;border-collapse:collapse;background:var(--slip)}
caption{text-align:left;font-weight:700;padding-bottom:8px}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid var(--guilloche);vertical-align:top}
thead th,th[scope=col]{font-size:.875rem;color:var(--ink-soft);font-weight:600}
td.n,th.n{text-align:right;white-space:nowrap}
tfoot th,tfoot td{border-bottom:0;border-top:1.5px solid var(--ink);font:750 1.125rem/1.2 var(--display)}
.plain{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.bank-more{margin-top:32px}
.list{list-style:none;margin:0 0 12px;padding:0;border-top:1px solid var(--guilloche)}
.list li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0 16px;padding:8px 0;border-bottom:1px solid var(--guilloche);line-height:1.4}
.list a{font-weight:600;display:inline-flex;align-items:center;min-height:44px}
.list .why{color:var(--stamp);font-size:.875rem;grid-column:1}
.list .ok{color:var(--ink-soft);font-size:.875rem;grid-column:1}
.list .amt{text-align:right;font-weight:600;grid-row:1;grid-column:2;white-space:nowrap}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px;padding:0;list-style:none}
.chips a{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border:1px solid var(--ink-soft);border-radius:var(--pill);text-decoration:none;font-weight:600;font-size:.9375rem;background:var(--slip)}
.chips a[aria-current=page]{border-color:var(--ink);background:var(--ink);color:var(--paper)}
.held{margin:0 0 24px}.held h2,.recent h2{margin:0 0 4px}.held>.hint,.recent>.hint{margin:0 0 12px}
.held .list li{display:block}.held .who,.held .subj{margin:0;overflow-wrap:anywhere}.held .btns{margin:4px 0 0}.held details.more{margin:0}
.steps{list-style:none;margin:0 0 16px;padding:0;border-top:1px solid var(--guilloche)}
.steps li{border-bottom:1px solid var(--guilloche)}
.steps a,.steps li>div{display:flex;align-items:center;gap:12px;min-height:56px;padding:8px 0;text-decoration:none;color:var(--ink)}
.steps a::before,.steps li>div::before{content:"";flex:none;width:16px;height:16px;border-radius:50%;border:2px solid var(--ink-soft);font:700 .75rem/12px var(--ui);text-align:center}
.steps .now a::before,.steps .now>div::before{background:var(--ink);border-color:var(--ink)}
.steps .done a::before,.steps .done>div::before{content:"\\2713";background:var(--mint);border-color:var(--ink);color:var(--ink)}
.steps b{font:700 1.125rem/1.2 var(--display);flex:1}
.steps span{color:var(--ink-soft);font-weight:600}.steps span.red{color:var(--stamp)}
.steps a::after{content:"›";color:var(--ink-soft);font-weight:600}
.next{margin:0 0 16px}.send .btns{margin:12px 0}.dated{margin:16px 0 0}.dated a{display:inline-flex;align-items:center;min-height:44px}
.checks li:first-child a.btn{justify-self:start;margin:4px 0}
.fixes>details.more{margin-top:16px}
.crumbs{display:flex;align-items:center;gap:8px 16px;margin:0 0 8px}.crumbs a,.crumbs .linkbtn{min-height:44px;display:inline-flex;align-items:center}.crumbs .linkbtn{margin-left:auto;padding:0}
.head .amt{font:700 1.25rem/1.2 var(--ui);margin-left:auto}
.fix h2{margin:0 0 8px}.fix details.all,.fix details.note{margin:12px 0 0}
.matchs{margin-top:16px}.match .btn{margin-top:8px}
input::placeholder{color:var(--ink-soft);opacity:1}
.find{display:flex;gap:8px;align-items:center;margin:0 0 16px}.find input{flex:1 1 auto;min-width:0}
.list.all .ok .stamp{font-size:.75rem;padding:4px 8px 4px;margin-right:4px}.list .who{font-weight:600;overflow-wrap:anywhere;min-width:0}
.work{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:32px;align-items:start}
.doc{position:sticky;top:16px}
.frame{display:block;background:#d5e2da;border:1px solid var(--guilloche);border-radius:var(--r);padding:16px;max-height:calc(100vh - 120px);overflow:auto}
.frame img{display:block;width:100%;height:auto;background:var(--slip);box-shadow:var(--shadow)}
.flags{list-style:none;margin:0 0 12px;padding:0;background:var(--slip);border:1px solid var(--guilloche);border-radius:var(--r)}
.flag{border-left:3px solid var(--stamp);padding:0 16px;border-bottom:1px solid var(--guilloche)}
.flag:last-child{border-bottom:0}
.flag>.srow:last-child{border-bottom:0}
.flag.info{border-left-color:var(--ink-soft)}
.flag .fh{margin:0;padding:8px 0 0;line-height:1.4}.flag.info .fh{padding-bottom:8px}
.flag .fh .meta{display:block}
.flag .fx{padding:0 0 8px}
.fix .srow{grid-template-columns:minmax(0,11rem) minmax(0,1fr);gap:4px 16px;padding:8px 0}
.fix .sl .meta{line-height:1.35}
.match{background:var(--slip);border:1.5px dashed var(--ink-soft);border-radius:var(--r);padding:16px 16px;margin-bottom:12px}
.actions{border-top:1px solid var(--ink);padding:12px 0 0;margin-top:12px;display:flex;gap:8px 16px;align-items:center;flex-wrap:wrap}
.pays{list-style:none;margin:0 0 24px;padding:0}
.pay{padding:8px 0;border-bottom:1px solid var(--guilloche)}
.pay.missing{box-shadow:inset 4px 0 var(--stamp);padding-left:16px}
.pay .line{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0 16px;align-items:baseline;min-height:44px;align-content:center}
.pay .who{font-weight:600;min-width:0;overflow-wrap:anywhere}
.pay .amt{font-weight:700;text-align:right;white-space:nowrap}
.pay .meta{grid-column:1;color:var(--ink-soft);font-size:.875rem}
.pay .meta .stamp{font-size:.75rem;padding:4px 8px;margin-left:4px}.pay .meta a.tag{display:inline-flex;align-items:center;min-height:44px;margin:-12px 0}
.pay details{margin:8px 0 0}
.pay .line>details.more{grid-column:2;grid-row:2;justify-self:end;border:0;background:none;margin:0}
.pay .line>details.more>summary{padding:0;font-size:.875rem;color:var(--ink-soft);display:flex;align-items:center}
.pay .line>details.more[open]{grid-column:1/-1;grid-row:3;justify-self:stretch}.pay .line>details.more>.body{padding:4px 0 8px}
.pay form{margin:0}
.fixrow{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;margin:8px 0 0}.fixrow .none{margin:0;flex-basis:100%}
.pmatch{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px}.pmatch select{flex:1 1 14rem;min-width:0}.pmatch .check{margin:0}
.transfer{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 0}.transfer select,.transfer input{flex:1 1 10rem;min-width:0}
.stmts{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px}.stmts details{flex-basis:100%}
.inline{display:flex;gap:8px 16px;align-items:center;flex-wrap:wrap;margin-top:8px}
.inline form{display:inline}
.summary{display:flex;gap:8px 16px;flex-wrap:wrap;margin:0 0 16px;font-weight:600}
.summary .red{color:var(--stamp)}
.csv{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;margin:16px 0 0}.csv p{margin:0}
.wizard{list-style:none;display:flex;gap:8px;flex-wrap:wrap;margin:0 0 24px;padding:0;counter-reset:w;font-weight:600;font-size:.9375rem;color:var(--ink-soft)}
.wizard li{display:flex;align-items:center;gap:8px}
.wizard li::before{counter-increment:w;content:counter(w);width:28px;height:28px;border-radius:50%;display:grid;place-items:center;border:1.5px solid var(--ink-soft)}
.wizard li[aria-current=step]{color:var(--ink)}.wizard li[aria-current=step]::before{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.wizard li.done::before{content:"\\2713";background:var(--mint);border-color:var(--ink);color:var(--ink)}
section.part{margin-bottom:32px}
section.part>h2{padding-bottom:8px;border-bottom:1px solid var(--ink);margin-bottom:16px}
.settings{max-width:720px}
details.sect{background:transparent;border:0;border-bottom:1px solid var(--guilloche);border-radius:0;margin:0}
details.sect:first-child{border-top:1px solid var(--guilloche)}
details.sect>summary{display:flex;align-items:center;gap:4px 16px;flex-wrap:wrap;min-height:56px;padding:8px 0;list-style:none}
details.sect>summary::-webkit-details-marker{display:none}
details.sect>summary::after{content:"\\203A";margin-left:auto;font-size:1.25rem;color:var(--ink-soft);transition:transform .15s}
details.sect[open]>summary::after{transform:rotate(90deg)}
details.sect>summary h2{margin:0}
details.sect>summary .sum{color:var(--ink-soft);font-weight:400;font-size:.875rem;min-width:0;overflow-wrap:anywhere}
details.sect>.body{padding:0 0 24px;scroll-margin-top:72px}
details.sect>.body>.banner,details.sect>.body>.warning,details.sect>.body>.alert{margin:0 0 12px}
details.sect[open] .save .btn{background:var(--ink);color:var(--paper);border-color:var(--ink)}
@supports selector(:has(a)){.setup-form .confirm{display:none}.setup-form .srow:has(:invalid) .confirm{display:flex}}
.rules>li>details{background:none;border:0;border-bottom:1px solid var(--guilloche);border-radius:0;margin:0}.rules summary{font-weight:600;padding:8px 0}
.add-row{margin:12px 0}
.sect .card{padding:4px 24px;margin-bottom:12px}
.srow{display:grid;grid-template-columns:minmax(0,14rem) minmax(0,1fr);gap:8px 24px;padding:12px 0;border-bottom:1px solid var(--guilloche);align-items:start}
.rowlist>.srow:last-child{border-bottom:0}
.sl{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;padding-top:8px;min-width:0}
.sl label,.flabel{display:inline;font-weight:600;font-size:.9375rem}
.sl .meta{flex-basis:100%}
.sc{display:grid;gap:8px;min-width:0}
.sc>p{margin:0;max-width:64ch}
.sc.row{display:flex;align-items:center;justify-content:space-between;gap:4px 16px;flex-wrap:wrap}
.inline-edit{display:flex;gap:8px;align-items:center;margin:0}
.inline-edit input{flex:1;min-width:0}
.setup-form textarea{resize:vertical;min-height:64px}
.srow.bad input,.srow.bad textarea,.srow.bad select{border-color:var(--stamp);border-width:2px}
.meta{font-size:.875rem;color:var(--ink-soft);line-height:1.5}
.meta code{font-size:.75rem;padding:1px 4px}
.meta .linkbtn,.sc .warning .linkbtn{min-height:44px;padding:0 4px}
.confirm{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px}
.confirm label.check{font-size:.875rem;align-items:center}
details.why{display:inline-block;background:none;border:0;margin:0}
details.why[open]{display:block;flex-basis:100%}
.why>summary{display:inline-flex;align-items:center;min-height:44px;padding:0;list-style:none;font-size:.875rem;color:var(--ink-soft);text-decoration:underline;text-underline-offset:.18em}
.why>summary::-webkit-details-marker{display:none}
.why>p{font-size:.875rem;color:var(--ink-soft);border-left:3px solid var(--guilloche);padding-left:8px;margin:4px 0 0;max-width:64ch}
.why>form{margin:12px 0}
details.add{background:transparent;border-style:dashed}
details.add>.scroll{padding:0 16px 16px}
details.group>summary{font:750 1.0625rem/1.3 var(--display)}
.kv{margin:0}
.kv>div{display:grid;grid-template-columns:minmax(0,14rem) minmax(0,1fr);gap:4px 24px;padding:12px 0;border-bottom:1px solid var(--guilloche)}
.kv dt{font-weight:600}.kv dd{margin:0;min-width:0}
.cta{margin:12px 0}
.parts{gap:8px}
.parts li{display:flex;gap:12px;align-items:center}
.parts li>input{flex:1;min-width:0}
.parts label.check{white-space:nowrap;font-size:.875rem}
.save{display:flex;justify-content:flex-end;padding:12px 0 16px}
@media (max-width:899px){
.srow,.fix .srow,.kv>div{grid-template-columns:minmax(0,1fr)}
.sl{padding-top:0}
}
.empty h2{margin:0 0 12px}
.manifest{list-style:none;margin:0 0 8px;padding:8px 12px;background:var(--paper);border:1.5px dashed var(--guilloche);border-radius:var(--r);font:500 .875rem/1.55 ui-monospace,Menlo,Consolas,monospace;overflow-x:auto}
.manifest li{white-space:nowrap}.manifest li+li{padding-left:2ch}.manifest .more{color:var(--ink-soft)}
.btns{display:flex;gap:8px 12px;flex-wrap:wrap;align-items:center;margin:12px 0 8px}
.btns form{margin:0;display:flex;gap:8px 12px;flex-wrap:wrap;align-items:center}
ol.how{margin:4px 0 16px;padding-left:24px}ol.how li{margin:0 0 8px}
.kinds{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:0 0 16px}
.kinds label{display:flex;gap:12px;align-items:flex-start;background:var(--slip);border:1.5px solid var(--guilloche);border-radius:var(--r);padding:16px 16px;font-size:1rem;cursor:pointer}
.kinds label:has(input:checked){border-color:var(--ink);box-shadow:var(--shadow)}
.kinds input{width:22px;height:22px;min-height:0;margin:4px 0 0;flex:none;accent-color:var(--ink)}
.kinds .s{display:block;font-weight:400;font-size:.875rem;color:var(--ink-soft)}
.drop{display:grid;place-items:center;gap:8px;text-align:center;border:2px dashed var(--ink-soft);border-radius:var(--r);background:var(--slip);padding:32px 16px;margin:0 0 16px}
.drop.over{border-color:var(--ink);background:var(--mint)}
.drop input[type=file]{max-width:420px}
.queue{list-style:none;margin:0 0 16px;padding:0;display:grid;gap:8px}
.queue li{display:flex;justify-content:space-between;gap:12px;background:var(--slip);border:1px solid var(--guilloche);border-radius:var(--r);padding:8px 12px;font-weight:600}
.queue li .st{font-weight:400;color:var(--ink-soft)}.queue li.bad{border-left:4px solid var(--stamp)}.queue li.bad .st{color:var(--stamp)}
@media (max-width:960px){.work{grid-template-columns:minmax(0,1fr)}.doc{position:static}.frame{max-height:none;width:120px;padding:4px}.frame img{max-height:120px;object-fit:contain}}
@media (max-width:640px){
.save .btn{width:100%}
table.stack,table.stack tbody,table.stack tr,table.stack td{display:block;width:100%}
table.stack thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
table.stack tr{padding:8px 12px;border-bottom:1px solid var(--guilloche)}
table.stack td{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:4px 12px;padding:4px 0;border:0;text-align:right}
table.stack td::before{content:attr(data-label);color:var(--ink-soft);font-size:.875rem;font-weight:600;text-align:left}
table.stack td.lead{font-weight:600;font-size:1.0625rem;text-align:left}table.stack td.lead::before{content:none}
table.stack td.lead a{min-height:44px;display:inline-flex;align-items:center}
h1{font-size:1.5rem}
main{padding-top:16px;padding-bottom:32px}.head{margin-bottom:16px}footer.foot{padding:16px var(--pad) 24px}
.chips{margin-bottom:12px}
.card{padding:16px 12px}.flag{padding:0 12px}
.next .btn,.actions .btn.primary,.empty .btn.primary{width:100%}
.fields{grid-template-columns:minmax(0,1fr)}
th,td{padding:8px}
}
nav.tabs{display:none}
.seg ul{display:inline-flex;max-width:100%;gap:4px;list-style:none;margin:0 0 16px;padding:4px;background:var(--slip);border:1px solid var(--guilloche);border-radius:var(--pill)}
.seg a{display:flex;align-items:center;min-height:44px;padding:0 16px;border-radius:var(--pill);text-decoration:none;font-weight:600;font-size:.9375rem;color:var(--ink-soft);white-space:nowrap}
.seg a[aria-current=page]{background:var(--ink);color:var(--paper)}
@media (hover:hover){.seg a:not([aria-current]):hover{color:var(--ink);background:var(--paper)}}
@media (max-width:879px){
html{scroll-padding-bottom:calc(var(--tabs) + 88px)}
.fix .actions{position:sticky;bottom:var(--tabs);z-index:4;background:var(--paper);padding:8px 0;margin:12px 0 0}
body{padding-bottom:var(--tabs)}
.bar{min-height:3rem}
nav.main,.sign-out{display:none}
nav.tabs{display:block;position:fixed;left:0;right:0;bottom:0;z-index:5;background:var(--paper);border-top:1px solid var(--ink);padding:0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
nav.tabs ul{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));max-width:560px;margin:auto;padding:0;list-style:none}
nav.tabs a{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:3.5rem;padding:8px 4px 4px;text-decoration:none;color:var(--ink-soft);font:600 .75rem/1.2 var(--ui);text-align:center;-webkit-tap-highlight-color:transparent}
nav.tabs a::before{content:"";position:absolute;top:-1px;left:22%;right:22%;height:3px;background:transparent}
nav.tabs a[aria-current=page]{color:var(--ink);font-weight:750}
nav.tabs a[aria-current=page]::before{background:var(--ink)}
nav.tabs a:active{background:var(--slip)}
nav.tabs a:focus-visible{outline-offset:-4px}
nav.tabs .ti{position:relative;display:flex}
nav.tabs svg{width:24px;height:24px}
nav.tabs .count{position:absolute;top:-5px;left:15px;padding:0 4px;line-height:1.3;box-shadow:0 0 0 2px var(--paper)}
body:has(input:not([type=checkbox],[type=radio],[type=file],[type=submit],[type=button]):focus,select:focus,textarea:focus) :is(nav.tabs,.fix .actions){display:none}
}
@media (max-width:879px) and (hover:hover){nav.tabs a:hover{color:var(--ink)}}
.tools{display:flex;align-items:center;gap:8px 16px;flex-wrap:wrap;margin:0 0 12px}.tools form{margin:0}.tools .select{margin-left:auto}
.list li:has(>details.discard)>.why{align-self:center}
details.discard{grid-column:2;grid-row:2;justify-self:end;border:0;background:none;margin:0}
details.discard>summary{padding:0 0 0 8px;font-size:.875rem;color:var(--ink-soft);display:flex;align-items:center;justify-content:flex-end;list-style:none}
details.discard>summary::-webkit-details-marker{display:none}
details.discard[open]{grid-column:1/-1;grid-row:3;justify-self:stretch}
details.discard>.body{padding:4px 0 8px}
.fixes>details.discard{margin:12px 0 0}.fixes>details.discard>summary{justify-content:flex-start;padding:0;font-size:1rem;font-weight:600;text-decoration:underline;text-underline-offset:.18em;color:var(--ink)}
.reasons{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.chip{min-height:44px;padding:0 16px;border:1px solid var(--ink-soft);border-radius:var(--pill);background:var(--slip);font:inherit;font-weight:600;font-size:.9375rem;color:var(--ink);cursor:pointer}
.chip:hover,.chip:focus-visible{border-color:var(--ink)}
.ask{margin:0 0 8px;font-weight:600;color:var(--stamp)}
.banner.undo{display:flex;align-items:center;gap:8px;padding-top:0;padding-bottom:0;min-height:44px}.banner.undo form{margin-left:auto}
.pick{display:flex;align-items:center;gap:12px;min-height:44px;font-weight:600;overflow-wrap:anywhere}.pick input{width:20px;height:20px;flex:none}
.bulk .bar{position:sticky;bottom:var(--tabs);z-index:4;background:var(--paper);padding:8px 0;display:flex;gap:8px 16px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--guilloche)}
.bulk .bar details.discard>summary{display:none}.bulk .bar details.discard>.body{padding:0}
.list.all li>form{grid-column:2;grid-row:2;justify-self:end}
.gone{margin:0 0 16px}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}.btn,nav.main a,nav.tabs a,.seg a,.chips a{transition:background-color .15s,border-color .15s,color .15s}}`;
}
// The tab icon, the same file as site/public/favicon.svg. Served at /favicon.svg.
export const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#E6EFE9"/><path d="M5 2h14v19l-2.33-1.5L14.33 21 12 19.5 9.67 21l-2.34-1.5L5 21z" fill="#0D3A36"/><path d="M8 7h8M8 10.5h8M8 14h5" stroke="#E6EFE9" stroke-width="1.6" stroke-linecap="round"/></svg>';
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

export async function page(
  title: string,
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
  const head = options.head ?? pageHead(escape(title));
  const counts = await navCounts(env);
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escape(title)} · ${escape(appName)}</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><style>${styles(basePath)}${options.style ?? ''}</style></head><body><a class="skip" href="#main">Skip to content</a><header class="top"><div class="bar"><a class="brand" href="/">${BRAND_ICON}${escape(appName)}</a>${nav(options.nav, counts)}${signOut}</div></header>${tabs(options.nav, counts)}<main id="main">${head}${body}</main><footer class="foot"><p class="notice">${escape(FOOTER_NOTICE)}</p><p>${release}</p></footer></body></html>`,
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
  const title = status >= 500 ? 'Something went wrong' : "That didn't work";
  return page(
    title,
    `<div class="alert" role="alert"><p><strong>${escape(message)}</strong></p></div><div class="btns"><a class="btn primary" href="${escape(back)}">Go back</a><a class="linkbtn" href="/">Home</a></div>`,
    status,
    env,
    {
      head: pageHead(title),
    },
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
