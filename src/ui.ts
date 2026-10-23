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
// In-app notice from the legal review, shown on every page. Keep word for word.
export const APP_NOTICE =
  'Figures are read automatically and can be wrong. Check every row before you use it. Not tax, VAT or accounting advice. Provided as is, without warranty. You run this in your own Cloudflare account; Nuits has no access to your data.';
export const EXPORT_NOTICE = 'Review flagged rows first. Your accountant decides how these are booked.';

// Bank rows that still need a receipt: outgoing, required, unlinked, from a complete import.
// Own-account transfers set receipt_required=0, so they never count.
export const MISSING_PAYMENTS =
  "FROM bank_transactions t JOIN imports i ON i.id=t.import_id WHERE i.status='complete' AND t.amount_minor<0 AND t.receipt_required=1 AND t.receipt_id IS NULL";

export type NavKey = 'home' | 'review' | 'payments' | 'invoices' | 'month' | 'settings' | 'more';
// style: extra page CSS, appended to the shared sheet.
export type PageOptions = { nav?: NavKey; head?: string; style?: string };
type Counts = { review: number; missing: number; invoices: boolean };

async function navCounts(env: Env): Promise<Counts> {
  try {
    const [review, missing, sales] = await env.DB.batch<{ n: number }>([
      env.DB.prepare("SELECT count(*) n FROM receipts WHERE status='needs_review' AND duplicate_of IS NULL"),
      env.DB.prepare(`SELECT count(*) n ${MISSING_PAYMENTS}`),
      env.DB.prepare("SELECT count(*) n FROM (SELECT 1 FROM receipts WHERE kind='sales' LIMIT 1)"),
    ]);
    return {
      review: review?.results[0]?.n ?? 0,
      missing: missing?.results[0]?.n ?? 0,
      // The Invoices tab appears once invoice email is set up or an invoice exists.
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
html{background:var(--paper);color:var(--ink);font:400 1rem/1.55 var(--ui);-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;overflow-wrap:break-word}
a{color:var(--ink);text-underline-offset:.18em}
:focus-visible{outline:2px solid var(--ink);outline-offset:2px;box-shadow:0 0 0 2px var(--paper)}
.skip{position:absolute;left:-9999px;top:8px}.skip:focus{left:16px;z-index:9;background:var(--slip);padding:10px 14px;border:1.5px solid var(--ink)}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.num,td.n,.amt{font-variant-numeric:tabular-nums}
h1,h2,h3{font-family:var(--display);color:var(--ink)}
h1{font-size:2.25rem;line-height:1.05;font-weight:750;letter-spacing:-.02em;margin:0}
h2{font-size:1.25rem;line-height:1.2;font-weight:700;margin:0 0 12px}
h3{font-size:1.0625rem;line-height:1.25;font-weight:700;margin:0 0 8px}
p{margin:0 0 12px}
code{font:500 .875em/1.4 ui-monospace,Menlo,Consolas,monospace;background:var(--paper);padding:2px 6px;border-radius:var(--r);overflow-wrap:anywhere}
pre{font:400 .75rem/1.5 ui-monospace,Menlo,Consolas,monospace;background:var(--paper);padding:12px;overflow:auto;border-radius:var(--r);white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px}
header.top{border-bottom:1px solid var(--ink);background:var(--paper)}
.bar{max-width:1200px;margin:auto;padding:0 var(--pad);display:flex;align-items:center;gap:28px;min-height:64px}
.brand{font:750 1.2rem/1 var(--display);letter-spacing:-.02em;text-decoration:none;display:flex;gap:8px;align-items:center;white-space:nowrap;min-height:44px}
.brand svg{width:18px;height:18px;flex:none}
nav.main ul{display:flex;gap:4px;list-style:none;margin:0;padding:0}
nav.main a{display:flex;align-items:center;gap:6px;min-height:44px;padding:3px 12px 0;text-decoration:none;font-weight:600;color:var(--ink-soft);border-bottom:3px solid transparent;white-space:nowrap}
nav.main a:hover{color:var(--ink);border-bottom-color:var(--guilloche)}
nav.main a[aria-current=page]{color:var(--ink);border-bottom-color:var(--ink)}
.count{background:var(--stamp);color:var(--on-stamp);border-radius:var(--pill);font:700 .75rem/1.4 var(--ui);padding:1px 7px;font-variant-numeric:tabular-nums}
.sign-out{margin-left:auto;font-size:.875rem;color:var(--ink-soft);min-height:44px;display:flex;align-items:center}
main{flex:1;width:100%;max-width:1200px;margin:auto;padding:28px var(--pad) 56px}
footer.foot{width:100%;max-width:1200px;margin:auto;padding:24px var(--pad) 48px;border-top:1px solid var(--guilloche);font-size:.8125rem;color:var(--ink-soft)}
footer.foot p{max-width:70ch;margin:0 0 8px}
footer.foot a{color:var(--ink-soft)}
.head{display:flex;flex-wrap:wrap;align-items:end;justify-content:space-between;gap:16px;margin-bottom:24px}
.head.tight{align-items:center;justify-content:flex-start}
.head .sub{color:var(--ink-soft);margin:6px 0 0;max-width:62ch}
.kicker{font-size:.8125rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft);margin:0 0 6px}
.lede{color:var(--ink-soft);margin:0 0 16px;max-width:62ch}
.small,.muted,.hint{font-size:.8125rem;color:var(--ink-soft);font-weight:400}
.warning{color:var(--stamp);font-weight:600}
.months{display:flex;align-items:center;gap:2px;font-weight:600;flex-wrap:wrap}
.months a{padding:0 12px;min-height:44px;display:inline-flex;align-items:center;text-decoration:none;border-radius:var(--pill)}
.months a:hover{background:var(--slip)}
.months strong{padding:0 6px}
.months form{display:flex;gap:6px;align-items:center;margin-left:8px}
.months input{width:auto;min-height:44px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 22px;border-radius:var(--pill);font:600 1rem/1.1 var(--ui);text-decoration:none;border:1.5px solid var(--ink);cursor:pointer;text-align:center;background:transparent;color:var(--ink)}
.btn.primary{background:var(--ink);color:var(--paper);min-height:48px;padding:0 26px}
.btn.primary:hover{background:#082a27}
.btn.secondary:hover{background:var(--slip)}
.btn:active{transform:translateY(1px)}
.linkbtn{text-align:left;background:none;border:0;padding:0 6px;font:inherit;font-weight:600;text-decoration:underline;text-underline-offset:.18em;color:var(--ink);cursor:pointer;min-height:44px}
a.linkbtn,.inline>a{display:inline-flex;align-items:center;min-height:44px}
.stamp{display:inline-block;font:800 .75rem/1 var(--display);letter-spacing:.08em;text-transform:uppercase;padding:6px 9px 5px;border:2px solid currentColor;border-radius:4px;transform:rotate(-2deg);white-space:nowrap;vertical-align:middle}
.stamp.needs{color:var(--stamp);background:var(--slip)}
.stamp.ready,.stamp.matched{background:var(--mint);color:var(--ink);border-color:var(--ink)}
.stamp.missing{background:var(--stamp);color:var(--on-stamp);border-color:var(--stamp)}
.stamp.muted{color:var(--ink-soft);border-color:var(--guilloche);background:var(--slip)}
.slip{position:relative;background:var(--slip);padding:28px 24px 24px;margin-top:10px;border-radius:0 0 var(--r) var(--r);filter:drop-shadow(0 1px 0 var(--guilloche))}
.slip::before{content:"";position:absolute;left:0;right:0;top:-10px;height:10px;background:radial-gradient(circle at 6px 0,transparent 6px,var(--slip) 6.5px) 0 0/12px 10px repeat-x}
.slip h2{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.card{background:var(--slip);border:1px solid var(--guilloche);border-radius:var(--r);padding:24px;margin-bottom:16px}
.card.active{border-color:var(--ink);box-shadow:var(--shadow)}
.card.quiet{background:transparent;border-style:dashed}
.rule{border:0;border-top:1.5px dashed var(--guilloche);margin:16px 0}
.rows{display:grid;grid-template-columns:1fr auto;gap:6px 16px;margin:0}
.rows dt{color:var(--ink-soft)}
.rows dd{margin:0;text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
.rows dd.red{color:var(--stamp)}
.total{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font:750 1.5rem/1.1 var(--display);font-variant-numeric:tabular-nums;margin-bottom:6px}
.alert{background:#fbeef2;border:1px solid var(--stamp);border-left-width:4px;border-radius:var(--r);padding:10px 14px;margin:0 0 14px}
.alert p:last-child{margin:0}
.banner{background:var(--mint);border:1px solid var(--ink);border-radius:var(--r);padding:12px 16px;margin:0 0 20px;font-weight:600}
.banner:empty{display:none}
label{display:grid;gap:6px;font-weight:600;font-size:.875rem;align-content:start;min-width:0}
label.check{display:flex;gap:10px;align-items:flex-start;font-weight:500;font-size:.9375rem}
label.check input{width:22px;height:22px;min-height:0;margin:1px 0 0;flex:none;accent-color:var(--ink)}
input,select,textarea{font:400 1rem/1.3 var(--ui);min-height:44px;padding:8px 12px;border:1.5px solid var(--ink-soft);border-radius:var(--r);background:var(--slip);color:var(--ink);width:100%;max-width:100%}
input[type=file]{padding:9px}
input[aria-invalid=true]{border-color:var(--stamp);border-width:2px}
.fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-bottom:16px}
.fields .wide{grid-column:1/-1}
fieldset{border:1px dashed var(--guilloche);border-radius:var(--r);padding:12px 16px 4px;margin:0 0 16px;min-width:0}
legend{font-weight:600;font-size:.875rem;padding:0 6px}
details{background:var(--slip);border:1px solid var(--guilloche);border-radius:var(--r);margin-bottom:12px}
summary{cursor:pointer;font-weight:600;padding:10px 20px;min-height:44px;display:list-item}
summary::marker{color:var(--ink-soft)}
details>.body{padding:4px 20px 20px}
details.tech{background:transparent;border-style:dashed}
.folds details{margin:0;border-radius:0;border-top-width:0}
.folds details:first-child{border-top-width:1px;border-radius:var(--r) var(--r) 0 0}
.folds details:last-child{border-radius:0 0 var(--r) var(--r)}
.scroll{overflow-x:auto;max-width:100%}
table{width:100%;border-collapse:collapse;background:var(--slip)}
caption{text-align:left;font-weight:700;padding-bottom:8px}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--guilloche);vertical-align:top}
thead th,th[scope=col]{font-size:.8125rem;color:var(--ink-soft);font-weight:600}
td.n,th.n{text-align:right;white-space:nowrap}
tfoot th,tfoot td{border-bottom:0;border-top:1.5px solid var(--ink);font:750 1.125rem/1.2 var(--display)}
.slip table{background:transparent}.slip th,.slip td{padding:8px 0;border-bottom-style:dashed}.slip td.n{padding-left:12px}
.todo,.plain{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.task{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:16px;align-items:center;background:var(--slip);border:1px solid var(--guilloche);border-radius:var(--r);padding:18px 22px;text-decoration:none}
.task:hover{border-color:var(--ink)}
.task.first{box-shadow:var(--shadow);border-color:var(--ink);padding:22px 24px}
.task .t{display:block;font-weight:600;font-size:1.0625rem}
.task .t b{font:750 1.375rem/1 var(--display);font-variant-numeric:tabular-nums}
.task .s{display:block;color:var(--ink-soft);font-size:.9375rem;margin-top:2px}
.task .go{font-weight:600;white-space:nowrap}
.icon{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;border:1.5px solid var(--ink);font:800 1rem/1 var(--display)}
.icon.red{border-color:var(--stamp);color:var(--stamp)}
.grid{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:32px;align-items:start}
.side{display:grid;gap:20px}
.steps{list-style:none;display:flex;margin:20px 0 4px;padding:0;counter-reset:s}
.steps li{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:.8125rem;font-weight:600;position:relative;color:var(--ink-soft)}
.steps li::before{counter-increment:s;content:counter(s);width:28px;height:28px;border-radius:50%;display:grid;place-items:center;border:1.5px solid var(--ink-soft);background:var(--slip);position:relative;z-index:1}
.steps li+li::after{content:"";position:absolute;top:14px;right:50%;width:100%;border-top:1.5px dotted var(--ink-soft)}
.steps li.now{color:var(--ink)}.steps li.now::before{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.steps li.done::before{content:"\\2713";background:var(--mint);border-color:var(--ink);color:var(--ink)}
.stepper{list-style:none;margin:0;padding:0;counter-reset:step}
.step{position:relative;display:grid;grid-template-columns:52px minmax(0,1fr);gap:0 16px;padding-bottom:14px}
.step:last-child{padding-bottom:0}
.step::before{counter-increment:step;content:counter(step);width:44px;height:44px;border-radius:50%;display:grid;place-items:center;font:750 1.125rem/1 var(--display);border:2px solid var(--ink-soft);color:var(--ink-soft);background:var(--paper);z-index:1}
.step:not(:last-child)::after{content:"";position:absolute;left:21px;top:48px;bottom:4px;border-left:2px dotted var(--ink-soft)}
.step.now::before{background:var(--ink);border-color:var(--ink);color:var(--paper)}
.step.done::before{content:"\\2713";background:var(--mint);border-color:var(--ink);color:var(--ink)}
.step .card{margin:0;padding:16px 20px}
.step .card>.hint{margin:0 0 10px}
.step .card>.small:last-child{margin:8px 0 0}
.ch{display:flex;justify-content:space-between;align-items:center;gap:8px 12px;flex-wrap:wrap;margin-bottom:4px}
.ch h2{margin:0}
.list{list-style:none;margin:0 0 14px;padding:0;border-top:1px solid var(--guilloche)}
.list li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0 16px;padding:8px 0;border-bottom:1px solid var(--guilloche);line-height:1.4}
.list a{font-weight:600;display:inline-block;min-height:24px;padding-top:2px}
.list .why{color:var(--stamp);font-size:.875rem;grid-column:1}
.list .ok{color:var(--ink-soft);font-size:.875rem;grid-column:1}
.list .amt{text-align:right;font-weight:600;grid-row:1;grid-column:2;white-space:nowrap}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 20px;padding:0;list-style:none}
.chips a{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border:1.5px solid var(--guilloche);border-radius:var(--pill);text-decoration:none;font-weight:600;font-size:.9375rem;background:var(--slip)}
.chips a[aria-current=page]{border-color:var(--ink);background:var(--ink);color:var(--paper)}
.work{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:32px;align-items:start}
.doc{position:sticky;top:16px}
.frame{background:#d5e2da;border:1px solid var(--guilloche);border-radius:var(--r);padding:16px;max-height:calc(100vh - 120px);overflow:auto}
.frame img{display:block;width:100%;height:auto;background:var(--slip);box-shadow:var(--shadow)}
.paper{background:var(--slip);box-shadow:var(--shadow);padding:24px 22px;font:400 .8125rem/1.6 ui-monospace,Menlo,Consolas,monospace}
.paper .v{font:700 1.05rem/1.2 var(--ui);margin-bottom:12px}
.paper table{background:transparent;margin-top:12px}.paper td{padding:3px 0;border:0}.paper td.n{padding-left:12px}
.paper tr.tot td{border-top:1px solid var(--ink);font-weight:700;padding-top:6px}
.paper .gap{color:var(--stamp)}
.doclink{display:grid;gap:8px;background:var(--slip);border:1.5px dashed var(--ink-soft);border-radius:var(--r);padding:18px 20px;margin-bottom:12px}
.doclink p{margin:0}
.doclinks{display:flex;justify-content:space-between;gap:12px;font-size:.875rem;margin-top:10px;flex-wrap:wrap}
.doclinks a{min-height:44px;display:inline-flex;align-items:center}
.flags{list-style:none;margin:0 0 12px;padding:0;background:var(--slip);border:1px solid var(--guilloche);border-radius:var(--r)}
.flag{border-left:3px solid var(--stamp);padding:0 16px;border-bottom:1px solid var(--guilloche)}
.flag:last-child{border-bottom:0}
.flag>.srow:last-child{border-bottom:0}
.flag.info{border-left-color:var(--ink-soft)}
.flag .fh{margin:0;padding:10px 0 0;line-height:1.4}.flag.info .fh{padding-bottom:10px}
.flag .fh .meta{display:block}
.flag .fx{padding:0 0 10px}
.fixh{margin:0 0 10px}.fixh h2{margin:0}.fixh .hint{margin:2px 0 0}
.fix .srow{grid-template-columns:minmax(0,11rem) minmax(0,1fr);gap:2px 16px;padding:8px 0}
.fix .sl .meta{line-height:1.35}
.fix details>.body.rowlist{padding:0 20px 6px}
.fix .rowlist>.hint{margin:0;padding-top:6px}
.fix .note-card{padding:0 20px;margin:12px 0 0}
.match{background:var(--slip);border:1.5px dashed var(--ink-soft);border-radius:var(--r);padding:16px 20px;margin-bottom:12px}
.match p{margin:0 0 10px}
.actions{border-top:1px solid var(--ink);padding:12px 0 0;margin-top:12px;display:flex;gap:8px 16px;align-items:center;flex-wrap:wrap}
.actions .note{font-size:.8125rem;color:var(--ink-soft);flex-basis:100%;margin:0;display:flex;flex-wrap:wrap;align-items:center;gap:0 6px}
.pays{list-style:none;margin:0 0 24px;padding:0;display:grid;gap:10px}
.pay{background:var(--slip);border:1px solid var(--guilloche);border-radius:var(--r);padding:14px 18px}
.pay.missing{border-left:4px solid var(--stamp)}
.pay .line{display:grid;grid-template-columns:96px minmax(0,1fr) auto auto;gap:4px 16px;align-items:center}
.pay .who{font-weight:600;min-width:0}
.pay .acct{display:block;font-size:.8125rem;color:var(--ink-soft);font-weight:400}
.pay .amt{font-weight:700;text-align:right;white-space:nowrap}
.pay .when{color:var(--ink-soft);font-size:.9375rem;white-space:nowrap}
.pay details{margin:12px 0 0}
.pay form{margin:0}
.inline{display:flex;gap:8px 16px;align-items:center;flex-wrap:wrap;margin-top:10px}
.inline form{display:inline}
.summary{display:flex;gap:8px 20px;flex-wrap:wrap;margin:0 0 16px;font-weight:600}
.summary .red{color:var(--stamp)}
.wizard{list-style:none;display:flex;gap:8px;flex-wrap:wrap;margin:0 0 24px;padding:0;counter-reset:w;font-weight:600;font-size:.9375rem;color:var(--ink-soft)}
.wizard li{display:flex;align-items:center;gap:8px}
.wizard li::before{counter-increment:w;content:counter(w);width:28px;height:28px;border-radius:50%;display:grid;place-items:center;border:1.5px solid var(--ink-soft)}
.wizard li[aria-current=step]{color:var(--ink)}.wizard li[aria-current=step]::before{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.wizard li.done::before{content:"\\2713";background:var(--mint);border-color:var(--ink);color:var(--ink)}
.sect{margin-bottom:36px;scroll-margin-top:16px}
section.part{margin-bottom:40px}
section.part>h2{padding-bottom:8px;border-bottom:1px solid var(--ink);margin-bottom:16px}
.settings{display:grid;grid-template-columns:176px minmax(0,1fr);gap:48px;align-items:start}
.sbody{min-width:0}
.snav{position:sticky;top:16px}
.snav ul{list-style:none;margin:0 0 20px;padding:0;border-left:1px solid var(--guilloche)}
.snav a{display:flex;align-items:center;min-height:40px;padding:0 14px;margin-left:-1px;border:0 solid transparent;border-left-width:3px;text-decoration:none;font-weight:600;font-size:.9375rem;color:var(--ink-soft)}
.snav a:hover{color:var(--ink);border-left-color:var(--guilloche)}
.key{list-style:none;margin:0;padding:0 0 0 14px;display:grid;gap:6px;font-size:.75rem;color:var(--ink-soft)}
.key .src{margin-right:6px}
.sh{display:flex;align-items:center;justify-content:space-between;gap:8px 16px;flex-wrap:wrap;min-height:44px;padding-bottom:8px;border-bottom:1px solid var(--ink);margin-bottom:12px}
.sh h2{margin:0}
.sect:target>.sh{border-bottom-width:3px;padding-bottom:6px}
.sect>.hint,.sect>.warning,.sect>.banner,.sect>.alert{margin:0 0 12px}
.sect .card{padding:4px 24px;margin-bottom:12px}
.srow{display:grid;grid-template-columns:minmax(0,14rem) minmax(0,1fr);gap:6px 24px;padding:14px 0;border-bottom:1px solid var(--guilloche);align-items:start}
.rowlist>.srow:last-child{border-bottom:0}
.sl{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;padding-top:10px;min-width:0}
.sl label,.flabel{display:inline;font-weight:600;font-size:.9375rem}
.sl .meta{flex-basis:100%}
.sc{display:grid;gap:6px;min-width:0}
.sc>p{margin:0;max-width:64ch}
.sc.row{display:flex;align-items:center;justify-content:space-between;gap:4px 16px;flex-wrap:wrap}
.inline-edit{display:flex;gap:10px;align-items:center;margin:0}
.inline-edit input{flex:1;min-width:0}
.setup-form textarea{resize:vertical;min-height:64px}
.srow.bad input,.srow.bad textarea,.srow.bad select{border-color:var(--stamp);border-width:2px}
.src{display:inline-block;font:600 .6875rem/1 var(--ui);letter-spacing:.03em;padding:3px 8px;border-radius:var(--pill);border:1px solid var(--guilloche);color:var(--ink-soft);white-space:nowrap}
.src.app{background:var(--mint);border-color:var(--mint);color:var(--ink)}
.src.deploy{border-color:var(--ink-soft)}
summary .src{margin-left:8px;vertical-align:2px}
.meta{font-size:.8125rem;color:var(--ink-soft);line-height:1.5}
.meta code{font-size:.75rem;padding:1px 4px}
.meta .linkbtn,.sc .warning .linkbtn{min-height:24px;padding:0 2px}
.confirm{display:flex;flex-wrap:wrap;align-items:center;gap:2px 12px}
.confirm label.check{font-size:.875rem;align-items:center}
details.why{display:inline-block;background:none;border:0;margin:0}
details.why[open]{display:block;flex-basis:100%}
.why>summary{display:inline-flex;align-items:center;min-height:24px;padding:0;list-style:none;font-size:.8125rem;color:var(--ink-soft);text-decoration:underline;text-underline-offset:.18em}
.why>summary::-webkit-details-marker{display:none}
.why>p{font-size:.8125rem;color:var(--ink-soft);border-left:3px solid var(--guilloche);padding-left:10px;margin:4px 0 0;max-width:64ch}
.why>form{margin:12px 0}
details.add{background:transparent;border-style:dashed}
details.add>.scroll{padding:0 20px 16px}
details.group>summary{font:750 1.0625rem/1.3 var(--display)}
.kv{margin:0}
.kv>div{display:grid;grid-template-columns:minmax(0,14rem) minmax(0,1fr);gap:4px 24px;padding:12px 0;border-bottom:1px solid var(--guilloche)}
.kv dt{font-weight:600}.kv dd{margin:0;min-width:0}
.cta{margin:12px 0}
.parts{gap:8px}
.parts li{display:flex;gap:14px;align-items:center}
.parts li>input{flex:1;min-width:0}
.parts label.check{white-space:nowrap;font-size:.875rem}
.save{display:flex;justify-content:flex-end;padding:14px 0 18px}
@media (max-width:899px){
.settings{grid-template-columns:minmax(0,1fr);gap:16px}
.snav{position:static}
.snav ul{display:flex;flex-wrap:wrap;gap:8px;border:0;margin:0 0 12px}
.snav a{min-height:44px;margin:0;padding:0 14px;border:1.5px solid var(--guilloche);border-radius:var(--pill);background:var(--slip);font-size:.875rem}
.key{display:flex;flex-wrap:wrap;gap:4px 14px;padding:0}
.srow,.fix .srow,.kv>div{grid-template-columns:minmax(0,1fr)}
.sl{padding-top:0}
}
.empty .stamp{margin-bottom:12px}
.empty h2{margin:0 0 4px}
.empty>.hint{font-size:.9375rem;margin:0 0 16px;max-width:62ch}
.pkg{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:12px 24px;margin:12px 0 4px;align-items:start}
.manifest{list-style:none;margin:0 0 6px;padding:8px 12px;background:var(--paper);border:1.5px dashed var(--guilloche);border-radius:var(--r);font:500 .8125rem/1.55 ui-monospace,Menlo,Consolas,monospace;overflow-x:auto}
.manifest li{white-space:nowrap}.manifest li+li{padding-left:2ch}.manifest .more{color:var(--ink-soft)}
.btns{display:flex;gap:10px 12px;flex-wrap:wrap;align-items:center;margin:12px 0 6px}
.btns form{margin:0;display:flex;gap:10px 14px;flex-wrap:wrap;align-items:center}
ol.how{margin:4px 0 16px;padding-left:22px}ol.how li{margin:0 0 6px}
.kinds{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:0 0 16px}
.kinds label{display:flex;gap:12px;align-items:flex-start;background:var(--slip);border:1.5px solid var(--guilloche);border-radius:var(--r);padding:16px 18px;font-size:1rem;cursor:pointer}
.kinds label:has(input:checked){border-color:var(--ink);box-shadow:var(--shadow)}
.kinds input{width:22px;height:22px;min-height:0;margin:2px 0 0;flex:none;accent-color:var(--ink)}
.kinds .s{display:block;font-weight:400;font-size:.875rem;color:var(--ink-soft)}
.drop{display:grid;place-items:center;gap:8px;text-align:center;border:2px dashed var(--ink-soft);border-radius:var(--r);background:var(--slip);padding:32px 20px;margin:0 0 16px}
.drop.over{border-color:var(--ink);background:var(--mint)}
.drop input[type=file]{max-width:420px}
.queue{list-style:none;margin:0 0 16px;padding:0;display:grid;gap:8px}
.queue li{display:flex;justify-content:space-between;gap:12px;background:var(--slip);border:1px solid var(--guilloche);border-radius:var(--r);padding:10px 14px;font-weight:600}
.queue li .st{font-weight:400;color:var(--ink-soft)}.queue li.bad{border-left:4px solid var(--stamp)}.queue li.bad .st{color:var(--stamp)}
@media (max-width:960px){.grid,.work{grid-template-columns:minmax(0,1fr)}.doc{position:static}.frame{max-height:260px}}
@media (max-width:640px){
.save .btn{width:100%}.sect .card{padding:4px 16px}
.meta .linkbtn,.sc .warning .linkbtn,.why>summary{min-height:44px}.confirm label.check{min-height:44px}
.months form{display:none}
.list a{min-height:44px;display:inline-flex;align-items:center;padding:0}
table.stack,table.stack tbody,table.stack tr,table.stack td{display:block;width:100%}
table.stack thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
table.stack tr{padding:10px 12px;border-bottom:1px solid var(--guilloche)}
table.stack td{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:2px 12px;padding:3px 0;border:0;text-align:right}
table.stack td::before{content:attr(data-label);color:var(--ink-soft);font-size:.8125rem;font-weight:600;text-align:left}
table.stack td.lead{font-weight:600;font-size:1.0625rem;text-align:left}table.stack td.lead::before{content:none}
table.stack td.lead a{min-height:44px;display:inline-flex;align-items:center}
h1{font-size:1.75rem}
main{padding-top:16px;padding-bottom:40px}.head{margin-bottom:16px}footer.foot{padding:20px var(--pad) 28px}
.task{grid-template-columns:auto minmax(0,1fr);gap:4px 12px;padding:12px 14px;align-items:start}.task.first{padding:14px}
.task .icon{width:32px;height:32px;font-size:.875rem}.task .t{font-size:1rem;line-height:1.3}.task .t b{font-size:1.125rem}
.task .s{font-size:.875rem;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.todo{gap:8px}.chips{margin-bottom:14px}
.task .go{grid-column:1/-1}
.task .go.btn{width:100%}
.task:not(.first) .go{display:none}
.slip{padding:20px 14px 14px}.rows{gap:2px 12px}
.card{padding:16px 14px}.step .card{padding:14px}.flag{padding:0 12px}.fix details>.body.rowlist,.fix .note-card{padding:0 14px}
.step{grid-template-columns:minmax(0,1fr)}
.step::before{display:none}.step{padding-bottom:10px}
.step:not(:last-child)::after{display:none}
.step .btn,.actions .btn.primary,.empty .btn.primary{width:100%}
.pkg{grid-template-columns:minmax(0,1fr)}.btns form{width:100%}
.pay .line{grid-template-columns:minmax(0,1fr) auto}
.pay .when{grid-row:1;grid-column:1}.pay .amt{grid-row:1;grid-column:2}.pay .who{grid-column:1/-1}.pay .stamp{grid-column:1/-1;justify-self:start}
.fields{grid-template-columns:minmax(0,1fr)}
th,td{padding:8px}
}
nav.tabs{display:none}
.menu{list-style:none;margin:0 0 16px;padding:0;background:var(--slip);border:1px solid var(--guilloche);border-radius:var(--r)}
.menu li+li{border-top:1px solid var(--guilloche)}
.menu a{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:14px;align-items:center;min-height:3.5rem;padding:8px 16px;text-decoration:none}
.menu b{display:block;font-weight:600}.menu .s{display:block;font-size:.875rem;color:var(--ink-soft);line-height:1.35}
.menu svg{width:24px;height:24px}.menu .chev{color:var(--ink-soft)}
.menu a:active{background:var(--paper)}
@media (hover:hover){.menu a:hover{background:var(--paper)}}
@media (max-width:879px){
html{scroll-padding-bottom:calc(var(--tabs) + 16px)}
body{padding-bottom:var(--tabs)}
.bar{min-height:3rem}
nav.main,.sign-out{display:none}
nav.tabs{display:block;position:fixed;left:0;right:0;bottom:0;z-index:5;background:var(--paper);border-top:1px solid var(--ink);padding:0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
nav.tabs ul{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));max-width:560px;margin:auto;padding:0;list-style:none}
nav.tabs a{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:3.5rem;padding:6px 2px 4px;text-decoration:none;color:var(--ink-soft);font:600 .75rem/1.2 var(--ui);text-align:center;-webkit-tap-highlight-color:transparent}
nav.tabs a::before{content:"";position:absolute;top:-1px;left:22%;right:22%;height:3px;background:transparent}
nav.tabs a[aria-current=page]{color:var(--ink);font-weight:750}
nav.tabs a[aria-current=page]::before{background:var(--ink)}
nav.tabs a:active{background:var(--slip)}
nav.tabs a:focus-visible{outline-offset:-4px}
nav.tabs .ti{position:relative;display:flex}
nav.tabs svg{width:24px;height:24px}
nav.tabs .count{position:absolute;top:-5px;left:15px;padding:0 5px;line-height:1.3;box-shadow:0 0 0 2px var(--paper)}
body:has(input:not([type=checkbox],[type=radio],[type=file],[type=submit],[type=button]):focus,select:focus,textarea:focus) nav.tabs{display:none}
}
@media (max-width:879px) and (hover:hover){nav.tabs a:hover{color:var(--ink)}}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}.snav a,.btn,.task,nav.main a,nav.tabs a,.menu a,.chips a{transition:background-color .15s,border-color .15s,color .15s}}`;
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
  payments: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>'),
  month: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4m8-4v4"/>'),
  more: svg('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
  invoices: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7m-7 4h5"/>'),
  settings: svg('<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  signOut: svg('<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>'),
  chevron: svg('<path d="m9 6 6 6-6 6"/>'),
};
const count = (n: number, what: string) =>
  n > 0 ? ` <span class="count">${n}<span class="vh"> ${what}</span></span>` : '';
const badges = (counts: Counts): Partial<Record<NavKey, string>> => ({
  review: count(counts.review, 'waiting'),
  payments: count(counts.missing, counts.missing === 1 ? 'missing a receipt' : 'missing receipts'),
});
const current = (on: boolean) => (on ? ' aria-current="page"' : '');

function nav(active: NavKey | undefined, counts: Counts): string {
  const badge = badges(counts);
  const item = (key: NavKey, href: string, label: string) =>
    `<li><a href="${href}"${current(key === active)}>${label}${badge[key] ?? ''}</a></li>`;
  return `<nav class="main" aria-label="Main"><ul>${item('home', '/', 'Home')}${item('review', '/review', 'Review')}${item('payments', '/payments', 'Payments')}${counts.invoices ? item('invoices', '/invoices', 'Invoices') : ''}${item('month', '/month', 'Month')}${item('settings', '/settings', 'Settings')}</ul></nav>`;
}

// The phone tab bar. Pages that live behind More light up the More tab.
const TABS = [
  { key: 'home', href: '/', label: 'Home' },
  { key: 'review', href: '/review', label: 'Review' },
  { key: 'payments', href: '/payments', label: 'Payments' },
  { key: 'month', href: '/month', label: 'Month' },
  { key: 'more', href: '/more', label: 'More' },
] as const;
const UNDER_MORE: readonly (NavKey | undefined)[] = ['more', 'settings', 'invoices'];

function tabs(active: NavKey | undefined, counts: Counts): string {
  const badge = badges(counts);
  const on = UNDER_MORE.includes(active) ? 'more' : active;
  return `<nav class="tabs" aria-label="Main"><ul>${TABS.map(
    (t) =>
      `<li><a href="${t.href}"${current(t.key === on)}><span class="ti">${ICONS[t.key]}${badge[t.key] ?? ''}</span>${t.label}</a></li>`,
  ).join('')}</ul></nav>`;
}

// The pages the phone tab bar has no room for.
export async function morePage(env: Env): Promise<Response> {
  const row = (href: string, icon: string, label: string, sub: string) =>
    `<li><a href="${href}">${icon}<span><b>${label}</b><span class="s">${sub}</span></span><span class="chev">${ICONS.chevron}</span></a></li>`;
  const rows = [
    (await navCounts(env)).invoices && row('/invoices', ICONS.invoices, 'Invoices', 'Sent invoices, paid or not'),
    row('/settings', ICONS.settings, 'Settings', 'Accounts, email and OneDrive'),
    config(env).access && row('/cdn-cgi/access/logout', ICONS.signOut, 'Sign out', 'End this session'),
  ];
  return page('More', `<ul class="menu">${rows.filter(Boolean).join('')}</ul>`, 200, env, {
    nav: 'more',
  });
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
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escape(title)} · ${escape(appName)}</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><style>${styles(basePath)}${options.style ?? ''}</style></head><body><a class="skip" href="#main">Skip to content</a><header class="top"><div class="bar"><a class="brand" href="/">${BRAND_ICON}${escape(appName)}</a>${nav(options.nav, counts)}${signOut}</div></header>${tabs(options.nav, counts)}<main id="main">${head}${body}</main><footer class="foot"><p class="notice">${escape(APP_NOTICE)}</p><p>${release}</p></footer></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

// The page header: optional kicker, the title, a one-line subtitle and an
// aside (a month switcher or one action). Title and parts are HTML.
export function pageHead(title: string, { kicker = '', sub = '', aside = '' } = {}): string {
  return `<div class="head"><div>${kicker ? `<p class="kicker">${kicker}</p>` : ''}<h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${aside}</div>`;
}
// An empty state: what is (not) here, one hint and the single next step. HTML in.
export function emptyState(title: string, hint: string, action = '', badge = ''): string {
  return `<div class="card empty">${badge}<h2>${title}</h2>${hint ? `<p class="hint">${hint}</p>` : ''}${action}</div>`;
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
      head: pageHead(title, {
        kicker: `Error ${status}`,
        sub:
          status >= 500
            ? 'Nothing you saved is lost. Try again in a minute.'
            : 'Your back button keeps what you typed.',
      }),
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
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
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
export function today(): string {
  const now = new Date();
  return `${DAYS[now.getUTCDay()]} ${now.getUTCDate()} ${MONTHS[now.getUTCMonth()]}`;
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
  return `<div class="months" role="group" aria-label="Choose month">${link(prev, `‹ ${monthName(prev, false).slice(0, 3)}`)}<strong>${escape(monthName(selected))}</strong>${link(next, `${monthName(next, false).slice(0, 3)} ›`)}<form method="get" action="${path}"><label><span class="vh">Jump to month</span><input name="month" value="${selected}" type="month"></label><button class="btn secondary">Go</button></form></div>`;
}
export function stamp(receipt: Pick<Receipt, 'status'>, matched = false): string {
  if (receipt.status === 'needs_review') return '<span class="stamp needs">Needs you</span>';
  if (receipt.status === 'pending' || receipt.status === 'processing')
    return '<span class="stamp muted">Reading</span>';
  return matched ? '<span class="stamp matched">Matched</span>' : '<span class="stamp ready">Ready</span>';
}

// Expense receipts dated in the month. Sales invoices have salesMonthRows().
export async function monthRows(env: Env, selected: string): Promise<Receipt[]> {
  return (
    await env.DB.prepare(
      "SELECT * FROM receipts WHERE kind='expense' AND substr(issue_date,1,7)=? AND duplicate_of IS NULL ORDER BY issue_date,id",
    )
      .bind(selected)
      .all<Receipt>()
  ).results;
}
// Sales invoices issued in the month.
export async function salesMonthRows(env: Env, selected: string): Promise<Receipt[]> {
  return (
    await env.DB.prepare(
      "SELECT * FROM receipts WHERE kind='sales' AND substr(issue_date,1,7)=? AND duplicate_of IS NULL ORDER BY issue_date,invoice_number,id",
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
  const mail = receiptAddress ? `Or forward it to <code>${escape(receiptAddress)}</code>. ` : '';
  return `<form action="/upload" method="post" enctype="multipart/form-data" class="upload">${kind === 'sales' ? '<input type="hidden" name="kind" value="sales">' : ''}<label>PDF or photo of the ${kind === 'sales' ? 'invoice' : 'receipt'}<input required name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp"></label><p style="margin:12px 0"><button class="btn ${primary ? 'primary' : 'secondary'}">Upload receipt</button></p><p class="small">${mail}<a href="/add">Add several at once</a></p></form>`;
}
// Tables with class "stack" turn into labelled rows on phones; data-label names each cell.
export function receiptTable(env: Env, rows: Receipt[], caption: string): string {
  return `<div class="scroll"><table class="stack"><caption class="vh">${escape(caption)}</caption><thead><tr><th scope="col">Who you paid</th><th scope="col">Date</th><th scope="col" class="n">Total</th><th scope="col">Part of the business</th><th scope="col">Status</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="lead"><a href="/receipts/${r.id}">${escape(r.vendor ?? r.filename)}</a></td><td data-label="Date">${escape(day(r.issue_date)) || 'No date'}</td><td class="n" data-label="Total">${amount(r.total_minor, r.currency)}</td><td data-label="Part">${escape(productLabel(env, r.product))}</td><td data-label="Status">${stamp(r)}</td></tr>`).join('')}</tbody></table></div>`;
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
