// Tokens and CSS for the two directions. build.mjs renders the same markup
// with each and measures every pair listed in `pairs`.

const hex = (n) => n.toString(16).padStart(2, '0');
const rgb = (h) => h.replace('#', '').match(/../g).map((x) => parseInt(x, 16));
// A translucent bar is measured as the colour it composites to over a given
// surface, since that is what sits behind the glyph.
const over = (top, alpha, under) => {
  const [a, b] = [rgb(top), rgb(under)];
  return '#' + a.map((v, i) => hex(Math.round(v * alpha + b[i] * (1 - alpha)))).join('').toUpperCase();
};
const rgba = (h, a) => `rgb(${rgb(h).join(' ')} / ${a})`;

const BASE = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:#C9CCCF}
p,h1,h2,h3,dl,dd,figure{margin:0}
ul{list-style:none;margin:0;padding:0}
a{color:inherit}
button,input{font:inherit;color:inherit}
[hidden]{display:none !important}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.i{width:var(--icon,1.125em);height:var(--icon,1.125em);flex:none}
.mockbar{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 24px;padding:10px 20px;font:13px/1.4 ui-monospace,Menlo,monospace;background:#16191C;color:#E8EAEC}
.mockbar a{color:#FFFFFF;margin-right:14px}
.inner .mockbar{display:none}
.mocklabel{font:600 12px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;padding:28px 20px 12px;color:#22272B;background:#C9CCCF}
.mocknote{margin:0;padding:10px 16px;text-align:center;font:12px/1.4 ui-monospace,Menlo,monospace;color:#3D4247;background:repeating-linear-gradient(-45deg,#E4E6E8 0 6px,#EDEFF0 6px 12px)}
.phoneframe{display:grid;place-items:center;min-height:100vh;background:#16191C;padding:24px}
.phoneframe iframe{width:390px;height:844px;border:0;border-radius:44px;background:#FFF}
.app{display:grid;min-height:880px;position:relative;isolation:isolate}
main{min-width:0;display:flex;flex-direction:column}
.pagehead{display:flex;flex-wrap:wrap;align-items:center;gap:12px 16px}
.headacts{display:flex;flex-wrap:wrap;gap:8px;margin-left:auto}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.45em;white-space:nowrap;cursor:pointer;text-decoration:none}
.iconbtn{display:inline-grid;place-items:center;width:44px;height:44px;text-decoration:none}
.seg{display:inline-flex}
.seg a{display:inline-flex;align-items:center;gap:6px;text-decoration:none}
.chip{display:inline-flex;align-items:center;gap:6px;cursor:pointer}
.badge{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;--icon:14px}
.banner{display:flex;align-items:center;gap:12px}
.banner p{flex:1}
.listtools{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px}
.selall{display:inline-flex;align-items:center;gap:10px;cursor:pointer}
.tally{margin-left:auto}
.row{display:grid;align-items:center;column-gap:16px;position:relative}
.row .pick{grid-area:pick}.row .date{grid-area:date}.row .body{grid-area:body;min-width:0}.row .badge{grid-area:badge;justify-self:start}.row .amt{grid-area:amt;justify-self:end}.row .acts{grid-area:acts;display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap}
.row .title{text-decoration:none;display:block;min-height:24px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.likely{display:flex;gap:8px;align-items:flex-start;grid-area:likely;justify-self:start;max-width:40rem}
.input::placeholder{color:var(--muted);opacity:1}
.likely .i{margin-top:2px}
.listfoot{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.bulkbar{position:sticky;display:flex;align-items:center;gap:8px;z-index:5}
.bulkbar p{margin-right:auto}
.reviewhead .stepper,.month{display:inline-flex;align-items:center}
.reviewhead .stepper{margin-left:auto}
.back{display:inline-flex;align-items:center;gap:4px;text-decoration:none;flex-basis:100%}
.split{display:grid;gap:24px;align-items:start}
.doc{display:flex;flex-direction:column;align-items:center;gap:16px}
.slip{width:min(100%,300px);background:#FFFFFF;color:#2A2A2A;font:12.5px/1.55 ui-monospace,Menlo,monospace;padding:22px 20px 30px;-webkit-mask:conic-gradient(from -45deg at bottom,#0000,#000 1deg 89deg,#0000 90deg) bottom/12px 100%;mask:conic-gradient(from -45deg at bottom,#0000,#000 1deg 89deg,#0000 90deg) bottom/12px 100%;box-shadow:0 1px 3px rgb(0 0 0 / .15)}
.slip hr{border:0;border-top:1px dashed #9A9A9A;margin:8px 0}
.slip .s-h{text-align:center;font-weight:700}
.slip .s-c{text-align:center}
.slip .s-l{display:flex;justify-content:space-between;gap:12px}
.slip .s-t{font-weight:700}
.slip .smudge{filter:blur(.6px)}
.fields{display:flex;flex-direction:column;gap:20px;min-width:0}
.field{display:grid;gap:6px}
.inwrap{position:relative}
.inwrap .input{width:100%;padding-right:52px}
.inwrap .unit{position:absolute;right:14px;top:50%;translate:0 -50%;pointer-events:none}
.hint{display:flex;gap:6px;align-items:flex-start}
.hint .i{--icon:16px;margin-top:2px}
.grouphead{display:flex;align-items:center;justify-content:space-between;gap:8px}
.read dl{display:grid}
.rf{display:grid;grid-template-columns:minmax(8rem,40%) 1fr;gap:12px}
.actionbar{position:sticky;bottom:0;display:flex;align-items:center;gap:8px;z-index:4}
.actionbar .pos{margin-right:auto}
.ab-acts{display:flex;gap:8px;align-items:center}
.specimen{padding:24px 20px 48px;display:grid;gap:16px}
.sp-row{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.sp-input .input{width:16rem}
.iconkey{display:grid;grid-template-columns:repeat(auto-fill,minmax(11rem,1fr));gap:8px 16px}
.iconkey li{display:flex;align-items:center;gap:10px}
.row.is-leaving{overflow:hidden;pointer-events:none}
@media (min-width:880px){
  .row{grid-template-columns:24px 4.5rem minmax(0,1fr) 8.5rem 7.5rem var(--acts,13.5rem);grid-template-areas:"pick date body badge amt acts"}
  [data-list=bank]{--acts:20.5rem}
  [data-list=bank] .row{grid-template-areas:"pick date body badge amt acts" "pick date likely likely likely acts"}
  .colhead{display:grid;grid-template-columns:24px 4.5rem minmax(0,1fr) 8.5rem 7.5rem var(--acts,13.5rem);column-gap:16px}
  [data-screen=bank] .colhead{--acts:20.5rem}
  .colhead .r{text-align:right}
  .split{grid-template-columns:minmax(0,5fr) minmax(0,6fr)}
  .doc{position:sticky;top:16px}
  .bulkbar{bottom:20px;align-self:center}
}
@media (max-width:879px){
  .app{grid-template-rows:1fr auto}
  .appnav{order:2;position:sticky;bottom:0;z-index:6}
  .appnav .brand{display:none !important}
  .appnav ul{display:grid;grid-template-columns:repeat(4,1fr)}
  .appnav a{flex-direction:column;justify-content:center;position:relative}
  .appnav .count{position:absolute;top:4px;left:calc(50% + 6px)}
  .pagehead h1{flex-basis:100%}
  .headacts{margin-left:0;width:100%}
  .headacts .btn{flex:1}
  .colhead{display:none}
  .row{grid-template-columns:24px minmax(0,1fr) auto;grid-template-areas:"pick body amt" "pick badge date" "acts acts acts";row-gap:6px}
  .row .date{justify-self:end}
  [data-list=bank] .row{grid-template-areas:"pick body amt" "pick badge date" ". likely likely" "acts acts acts"}
  .row .acts{justify-content:flex-start;margin-top:4px;flex-wrap:nowrap;padding-left:36px}
  .tally{margin-left:0;flex-basis:100%}
  .bulkbar{bottom:calc(var(--tabbar) + 10px)}
  .reviewhead .stepper{margin-left:auto}
  .doc .slip{max-height:330px;overflow:hidden;-webkit-mask:linear-gradient(#000 80%,#0000);mask:linear-gradient(#000 80%,#0000)}
  .actionbar{bottom:var(--tabbar)}
  .actionbar .pos{display:none}
  .ab-acts{width:100%}
  .ab-acts .btn{flex:1 1 0;min-width:0}
  .ab-acts .btn.primary{flex:1.6 1 0}
  .rf{grid-template-columns:1fr auto;text-align:left}
  .rf dd{text-align:right}
}
`;

// Shared motion recipe; each direction tunes the keyframes. JS sets --h to the
// row's height so the gap closes from the real size.
const motion = (leave) => `
@media (prefers-reduced-motion:no-preference){
  .row.is-leaving{animation:${leave}}
  @keyframes row-collapse{from{max-height:var(--h)}to{max-height:0;padding-top:0;padding-bottom:0;margin-top:0;margin-bottom:0;border-width:0;opacity:0}}
  .banner{animation:banner-in .24s ease-out both}
  @keyframes banner-in{from{opacity:0;transform:translateY(-6px)}}
  .btn,.seg a,.chip,.row{transition:background-color .15s,color .15s,border-color .15s,box-shadow .15s}
}`;

// ---------------------------------------------------------------- Native app
const N = {
  page: '#F2F2F7',
  raised: '#FFFFFF',
  sunken: '#E5E5EA',
  text: '#1C1C1E',
  muted: '#5B5B62',
  separator: '#D1D1D6',
  fieldBorder: '#86868B',
  accent: '#0D3A36',
  accentHover: '#072522',
  accentTint: '#E2ECEA',
  onAccent: '#FFFFFF',
  success: '#1E6B3C',
  successBg: '#E3F1E7',
  warn: '#8A4B00',
  warnBg: '#FFEFD2',
  info: '#1D4F91',
  infoBg: '#E5EEFA',
  danger: '#B3261E',
  dangerBg: '#FCEBEA',
  segTrack: '#E3E3E8',
};
const nBar = { base: '#F9F9FB', alpha: 0.9 };
const nBulk = { base: '#072522', alpha: 0.94 };
Object.assign(N, {
  barOverPage: over(nBar.base, nBar.alpha, N.page),
  barOverInk: over(nBar.base, nBar.alpha, N.text),
  bulkOverPage: over(nBulk.base, nBulk.alpha, N.page),
  bulkOverRaised: over(nBulk.base, nBulk.alpha, N.raised),
});
N.onBulkTint = over('#FFFFFF', 0.16, N.bulkOverRaised);

const nativeCss = `
:root{
  --page:${N.page};--raised:${N.raised};--sunken:${N.sunken};--text:${N.text};--muted:${N.muted};--sep:${N.separator};--field-border:${N.fieldBorder};
  --accent:${N.accent};--accent-hover:${N.accentHover};--accent-tint:${N.accentTint};--on-accent:${N.onAccent};
  --success:${N.success};--success-bg:${N.successBg};--warn:${N.warn};--warn-bg:${N.warnBg};--info:${N.info};--info-bg:${N.infoBg};--danger:${N.danger};--danger-bg:${N.dangerBg};
  --bar:${rgba(nBar.base, nBar.alpha)};--bulk:${rgba(nBulk.base, nBulk.alpha)};--seg-track:${N.segTrack};
  --font:system-ui,-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI Variable Text","Segoe UI",Roboto,"Helvetica Neue",sans-serif;
  --r-sm:8px;--r-md:10px;--r-lg:12px;--tabbar:calc(64px + env(safe-area-inset-bottom));
  --t-body:15px;--t-meta:13px;--t-title:26px;
}
@media (max-width:879px){:root{--t-body:17px;--t-meta:15px;--t-title:32px}}
.app{background:var(--page);color:var(--text);font:400 var(--t-body)/1.38 var(--font);font-feature-settings:"tnum";-webkit-font-smoothing:antialiased;letter-spacing:-.006em}
.amt,.n,.count,.tally,.pos,.listfoot,.date,.stepper,.unit{font-variant-numeric:tabular-nums}
:focus-visible{outline:3px solid ${rgba(N.accent, 0.55)};outline-offset:2px}

/* sidebar on desktop, translucent tab bar on phone */
.appnav{background:var(--bar);-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px)}
.appnav .brand{display:block;font-weight:700;font-size:15px;text-decoration:none;padding:20px 20px 16px;letter-spacing:-.01em}
.appnav a{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--text)}
.appnav a .i{color:var(--accent);--icon:20px}
.appnav [aria-current] {background:var(--accent-tint);color:var(--accent);font-weight:600}
.count{display:inline-grid;place-items:center;min-width:22px;height:20px;padding:0 6px;border-radius:999px;background:var(--accent);color:var(--on-accent);font-size:12px;font-weight:600}
@media (min-width:880px){
  .app{grid-template-columns:232px minmax(0,1fr)}
  .appnav{border-right:1px solid var(--sep);background:${rgba('#E8E8ED', 0.86)}}
  .appnav ul{display:grid;gap:2px;padding:0 10px}
  .appnav a{padding:8px 10px;border-radius:var(--r-sm);font-size:14px}
  .appnav .count{margin-left:auto}
  main{padding:24px 32px 40px;max-width:1120px;width:100%;gap:16px}
}
@media (max-width:879px){
  .appnav{border-top:1px solid var(--sep);padding-bottom:env(safe-area-inset-bottom)}
  .appnav a{height:64px;gap:3px;font-size:11px;font-weight:500;color:var(--muted)}
  .appnav a .i{color:inherit;--icon:24px}
  .appnav [aria-current]{background:none;color:var(--accent)}
  .appnav .count{height:18px;min-width:18px;font-size:11px;padding:0 5px}
  main{padding:12px 16px 24px;gap:14px}
}

h1{font-size:var(--t-title);font-weight:700;letter-spacing:-.022em;line-height:1.1}
h2{font-size:13px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.02em}

/* controls: five shapes */
.btn{min-height:36px;padding:0 14px;border:0;border-radius:var(--r-md);font-size:14px;font-weight:600;--icon:17px}
.btn.sm{min-height:32px;padding:0 10px;font-size:13px;--icon:16px}
.btn.primary{background:var(--accent);color:var(--on-accent);box-shadow:0 1px 2px rgb(0 0 0 / .18)}
.btn.primary:hover{background:var(--accent-hover)}
.btn.secondary{background:var(--accent-tint);color:var(--accent)}
.btn.secondary:hover{background:#D3E2DF}
.btn.ghost{background:transparent;color:var(--accent)}
.btn.ghost:hover{background:${rgba(N.text, 0.06)}}
.btn.danger{background:var(--danger);color:var(--on-accent)}
.seg{background:var(--seg-track);border-radius:9px;padding:2px;gap:2px}
.seg a{padding:6px 14px;border-radius:7px;font-size:14px;font-weight:500;color:var(--text);min-height:32px}
.seg [aria-current]{background:var(--raised);box-shadow:0 1px 3px rgb(0 0 0 / .14),0 0 0 .5px rgb(0 0 0 / .06);font-weight:600}
.seg .n{color:var(--muted);font-weight:500}
.chip{min-height:32px;padding:0 12px;border-radius:999px;border:1px solid var(--field-border);background:var(--raised);font-size:13px;font-weight:500;--icon:15px}
.input{min-height:44px;padding:0 14px;border-radius:var(--r-md);border:1px solid var(--field-border);background:var(--raised);font-size:var(--t-body)}
.input:focus{outline:0;border-color:var(--accent);box-shadow:0 0 0 4px ${rgba(N.accent, 0.18)}}
.pick{appearance:none;-webkit-appearance:none;width:22px;height:22px;margin:0;border-radius:50%;border:1.5px solid var(--field-border);background:var(--raised);cursor:pointer;display:grid;place-items:center}
.pick:checked{background:var(--accent) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E") center/14px no-repeat;border-color:var(--accent)}

.badge{padding:3px 9px 3px 7px;border-radius:999px;font-size:12px;font-weight:600}
.badge.warn{background:var(--warn-bg);color:var(--warn)}
.badge.info{background:var(--info-bg);color:var(--info)}
.badge.ok{background:var(--success-bg);color:var(--success)}
.banner{background:var(--success-bg);color:var(--success);border-radius:var(--r-lg);padding:6px 6px 6px 14px;font-weight:600;--icon:20px}
.banner.err{background:var(--danger-bg);color:var(--danger);padding:10px 14px}
.banner .btn.ghost{color:var(--success)}
.listtools{font-size:14px}
.selall{color:var(--text)}
.tally{color:var(--muted);font-size:var(--t-meta)}

/* grouped inset list */
.colhead{display:none !important}
.rows{background:var(--raised);border-radius:var(--r-lg);overflow:hidden;box-shadow:0 0 0 .5px rgb(0 0 0 / .05)}
.row{padding:12px 14px 12px 16px;min-height:60px}
.row + .row::before{content:"";position:absolute;top:0;left:56px;right:0;border-top:.5px solid var(--sep)}
.row.is-picked{background:var(--accent-tint)}
.row.is-picked .btn.secondary{background:var(--raised)}
.row .title{font-weight:600;color:var(--text)}
.row .meta{font-size:var(--t-meta);color:var(--muted)}
.row .meta .kind::after{content:" ·"}
.row .date{font-size:var(--t-meta);color:var(--muted)}
.row .amt{font-weight:600}
.amt .cur{font-size:.8em;color:var(--muted);font-weight:500}
.amt.none{width:1px}
.likely{margin-top:6px;padding:8px 10px;border-radius:var(--r-sm);background:var(--page);font-size:var(--t-meta);color:var(--text);--icon:16px}
.likely .i{color:var(--accent)}
.likely .why{color:var(--muted)}
.lede{color:var(--muted)}
.lede b{color:var(--text)}
.listfoot{color:var(--muted);padding:4px 4px 0}
.listfoot b{color:var(--text)}
.mocknote{border-radius:var(--r-lg)}
@media (min-width:880px){.row .date{order:-1}}

.bulkbar{background:var(--bulk);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);color:var(--on-accent);border-radius:16px;padding:8px 8px 8px 18px;box-shadow:0 8px 28px rgb(0 0 0 / .22);min-width:min(100%,26rem)}
.btn.onbar-primary{background:#FFFFFF;color:var(--accent)}
.btn.onbar{background:${rgba('#FFFFFF', 0.16)};color:#FFFFFF}
.bulkbar :focus-visible{outline-color:#FFFFFF}

/* review */
.reviewhead{gap:8px 12px}
.back{color:var(--accent);font-weight:500;margin-left:-4px}
.stepper{gap:2px;color:var(--muted);font-size:14px}
.stepper b{color:var(--text)}
.iconbtn{border-radius:var(--r-md);color:var(--accent)}
.iconbtn:hover{background:${rgba(N.text, 0.06)}}
.doc{background:var(--sunken);border-radius:var(--r-lg);padding:28px 16px 16px}
.group{background:var(--raised);border-radius:var(--r-lg);padding:16px;display:grid;gap:16px}
.group.need{box-shadow:inset 0 0 0 1.5px ${N.warn}}
.group.need h2{color:var(--warn)}
.field label{font-weight:600}
.hint{font-size:var(--t-meta);color:var(--warn)}
.hint.quiet{color:var(--muted)}
.unit{color:var(--muted);font-size:13px}
.rf{padding:10px 0;border-top:.5px solid var(--sep)}
.rf:first-child{border-top:0}
.rf dt{color:var(--muted)}
.actionbar{background:var(--bar);-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);border-radius:16px;padding:8px 8px 8px 16px;box-shadow:0 0 0 .5px rgb(0 0 0 / .08),0 6px 20px rgb(0 0 0 / .08)}
.actionbar .pos{color:var(--muted)}
.actionbar .pos b{color:var(--text)}
@media (max-width:879px){
  .actionbar{border-radius:0;margin:0 -16px;padding:6px 8px;box-shadow:0 -.5px 0 var(--sep)}
  .ab-acts .btn{flex-direction:column;gap:2px;min-height:52px;padding:4px 2px;font-size:12px;--icon:20px}
  .ab-acts .btn.primary{flex-direction:row;font-size:16px;gap:6px}
  .row .acts .btn.sm{min-height:36px}
  .row{padding:12px 12px 10px 14px}
  .row + .row::before{left:52px}
}

.specimen{background:var(--page);color:var(--text);font:400 15px/1.4 var(--font)}
.specimen h2{margin-top:8px}
.iconkey li{font-size:14px}
.iconkey .i{color:var(--accent)}
${motion('n-slide .22s cubic-bezier(.4,0,1,1) forwards,row-collapse .2s .2s cubic-bezier(.2,0,0,1) forwards')}
@keyframes n-slide{to{transform:translateX(48px);opacity:0}}
`;

const nativePairs = [
  ['text', 'page', 'text', 'Body text on the page'],
  ['text', 'raised', 'text', 'Row titles on a grouped list'],
  ['muted', 'page', 'text', 'Meta and tally on the page'],
  ['muted', 'raised', 'text', 'Meta line in a row'],
  ['muted', 'sunken', 'text', 'Muted text on the document panel'],
  ['text', 'accentTint', 'text', 'Row title on a selected row'],
  ['muted', 'accentTint', 'text', 'Meta on a selected row'],
  ['accent', 'page', 'text', 'Ghost buttons and links on the page'],
  ['accent', 'raised', 'text', 'Ghost buttons in a row'],
  ['accent', 'accentTint', 'text', 'Secondary button label, current sidebar item'],
  ['onAccent', 'accent', 'text', 'Primary button, nav count'],
  ['onAccent', 'accentHover', 'text', 'Primary button while hovered'],
  ['onAccent', 'danger', 'text', 'Delete forever (permanent delete only)'],
  ['warn', 'warnBg', 'text', 'Needs you, Missing, Overdue badges'],
  ['warn', 'raised', 'text', 'Hint under a flagged field'],
  ['info', 'infoBg', 'text', 'Reading, New sender badges'],
  ['success', 'successBg', 'text', 'Undo banner and its Undo button'],
  ['danger', 'dangerBg', 'text', 'Error banner'],
  ['text', 'segTrack', 'text', 'Segmented control, unselected segment'],
  ['muted', 'segTrack', 'text', 'Segment count, unselected'],
  ['muted', 'barOverPage', 'text', 'Tab bar label over the page'],
  ['muted', 'barOverInk', 'text', 'Tab bar label over dark text scrolling under it (worst case)'],
  ['accent', 'barOverInk', 'text', 'Current tab over dark text (worst case)'],
  ['onAccent', 'bulkOverRaised', 'text', 'Bulk bar text'],
  ['accent', 'raised', 'text', 'Bulk Approve: white button, petrol label'],
  ['onAccent', 'onBulkTint', 'text', 'Bulk Discard on the bar'],
  ['fieldBorder', 'raised', 'ui', 'Input, chip and checkbox outline'],
  ['accent', 'page', 'ui', 'Focus ring, current tab icon'],
  ['warn', 'raised', 'ui', 'Flagged group outline'],
  ['onAccent', 'accent', 'ui', 'Checked checkbox tick'],
];

// --------------------------------------------------------------- Warm paper
const P = {
  page: '#F3EDE2',
  sheet: '#FBF8F2',
  sunken: '#E6DDCC',
  ink: '#211C16',
  muted: '#5E5446',
  rule: '#D8CCB8',
  ruleStrong: '#857861',
  accent: '#0D3A36',
  accentHover: '#072522',
  accentTint: '#DCE6DF',
  onAccent: '#FBF8F2',
  success: '#2E6A3C',
  successBg: '#E2ECD9',
  warn: '#87470A',
  warnBg: '#F6E3C1',
  info: '#2D4E73',
  infoBg: '#E1E7EC',
  danger: '#A12820',
  dangerBg: '#F5DCD5',
  field: '#FFFDF8',
};
const pBar = { base: '#FBF8F2', alpha: 0.92 };
Object.assign(P, {
  barOverPage: over(pBar.base, pBar.alpha, P.page),
  barOverInk: over(pBar.base, pBar.alpha, P.ink),
  bulk: P.accentHover,
});
P.onBarOutline = over(P.onAccent, 0.55, P.accentHover);

const grain = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .3 0 0 0 0 .25 0 0 0 0 .15 0 0 0 .05 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

const paperCss = `
:root{
  --page:${P.page};--sheet:${P.sheet};--sunken:${P.sunken};--ink:${P.ink};--muted:${P.muted};--rule:${P.rule};--rule-strong:${P.ruleStrong};
  --accent:${P.accent};--accent-hover:${P.accentHover};--accent-tint:${P.accentTint};--on-accent:${P.onAccent};--field:${P.field};
  --success:${P.success};--success-bg:${P.successBg};--warn:${P.warn};--warn-bg:${P.warnBg};--info:${P.info};--info-bg:${P.infoBg};--danger:${P.danger};--danger-bg:${P.dangerBg};
  --bar:${rgba(pBar.base, pBar.alpha)};
  --font:"Instrument Sans",system-ui,sans-serif;--display:"Bricolage","Arial Narrow",system-ui,sans-serif;--num:"DM Mono",ui-monospace,Menlo,monospace;
  --r:6px;--tabbar:calc(62px + env(safe-area-inset-bottom));
  --t-body:15px;--t-meta:12.5px;--t-title:36px;
}
@media (max-width:879px){:root{--t-body:16px;--t-meta:13px;--t-title:30px}}
.app{background:var(--page) ${grain};color:var(--ink);font:400 var(--t-body)/1.45 var(--font)}
.amt,.date,.n,.count,.tally,.pos,.listfoot,.stepper,.unit,.badge,.chip,.colhead,.month p,.likely,.input[inputmode=decimal]{font-family:var(--num)}
.amt{font-weight:500;letter-spacing:-.01em}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

/* top bar on desktop, tab bar on phone */
.appnav{background:var(--bar);border-bottom:1px solid var(--rule)}
.appnav .brand{font:800 20px/1 var(--display);text-decoration:none;letter-spacing:-.01em;color:var(--ink)}
.appnav a{display:flex;align-items:center;gap:8px;text-decoration:none;color:var(--muted)}
.appnav a .i{--icon:18px}
.appnav [aria-current]{color:var(--accent);font-weight:600}
.count{display:inline-grid;place-items:center;min-width:24px;height:20px;padding:0 6px;border-radius:4px;background:var(--accent);color:var(--on-accent);font-size:11.5px;font-weight:500}
@media (min-width:880px){
  .app{grid-template-rows:auto 1fr}
  .appnav{display:flex;align-items:center;gap:40px;padding:0 max(32px,calc((100% - 1120px)/2));height:60px;position:sticky;top:0;z-index:6;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
  .appnav ul{display:flex;gap:4px;height:100%}
  .appnav a{height:100%;padding:0 12px;font-size:15px;box-shadow:inset 0 -2px 0 transparent}
  .appnav [aria-current]{box-shadow:inset 0 -3px 0 var(--accent)}
  main{padding:32px max(32px,calc((100% - 1120px)/2)) 48px;gap:18px}
}
@media (max-width:879px){
  .appnav{border-top:1px solid var(--rule-strong);border-bottom:0;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
  .appnav a{height:62px;gap:3px;font-size:11.5px;font-weight:500}
  .appnav a .i{--icon:22px}
  .appnav [aria-current]{box-shadow:inset 0 3px 0 var(--accent)}
  .appnav .count{height:17px;min-width:20px;font-size:10.5px}
  main{padding:18px 16px 24px;gap:14px}
}

h1{font:800 var(--t-title)/1 var(--display);letter-spacing:-.015em}
h2{font:600 11px/1.2 var(--num);text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}

/* controls: five shapes */
.btn{min-height:40px;padding:0 16px;border-radius:var(--r);font-size:14.5px;font-weight:600;border:1px solid transparent;--icon:17px}
.btn.sm{min-height:34px;padding:0 11px;font-size:13.5px;--icon:16px}
.btn.primary{background:var(--accent);color:var(--on-accent);box-shadow:inset 0 -2px 0 rgb(0 0 0 / .28)}
.btn.primary:hover{background:var(--accent-hover)}
.btn.secondary{background:var(--field);color:var(--ink);border-color:var(--rule-strong);box-shadow:0 1px 0 var(--rule-strong)}
.btn.secondary .i{color:var(--accent)}
.btn.secondary:hover{background:var(--sheet);border-color:var(--ink)}
.btn.ghost{background:transparent;color:var(--accent);padding-inline:8px}
.btn.ghost span{text-decoration:underline;text-decoration-color:transparent;text-underline-offset:3px}
.btn.ghost:hover span{text-decoration-color:currentColor}
.btn.danger{background:var(--danger);color:var(--on-accent);box-shadow:inset 0 -2px 0 rgb(0 0 0 / .25)}
.seg{gap:2px;border-bottom:1px solid var(--rule-strong)}
.seg a{padding:8px 14px 9px;font-size:15px;font-weight:500;color:var(--muted);min-height:40px;box-shadow:inset 0 -3px 0 transparent}
.seg [aria-current]{color:var(--ink);font-weight:600;box-shadow:inset 0 -3px 0 var(--accent)}
.seg .n{font-size:12.5px}
.chip{min-height:34px;padding:0 12px;border-radius:999px;border:1px dashed var(--rule-strong);background:transparent;font-size:12.5px;--icon:14px}
.input{min-height:46px;padding:0 14px;border:1px solid var(--rule-strong);border-bottom:2px solid var(--ink);border-radius:4px 4px 0 0;background:var(--field);font-size:16px;font-weight:500}
.input:focus{outline:0;border-bottom-color:var(--accent);box-shadow:0 2px 0 var(--accent)}
.pick{width:20px;height:20px;margin:0;accent-color:var(--accent);cursor:pointer}

.badge{padding:3px 8px;border-radius:3px;font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;border:1px solid}
.badge.warn{background:var(--warn-bg);color:var(--warn);border-color:${P.warn}55}
.badge.info{background:var(--info-bg);color:var(--info);border-color:${P.info}55}
.banner{background:var(--success-bg);color:var(--success);border-left:3px solid var(--success);padding:6px 6px 6px 14px;font-weight:600;--icon:19px}
.banner.err{background:var(--danger-bg);color:var(--danger);border-color:var(--danger);padding:10px 14px}
.banner .btn.ghost{color:var(--success)}
.selall{font-size:14px}
.tally{font-size:12.5px;color:var(--muted)}

/* the ledger */
.colhead{margin-bottom:-18px;padding:0 16px 8px;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);border-bottom:3px double var(--ink)}
.rows{background:var(--sheet);border:1px solid var(--rule);border-top:0;box-shadow:0 1px 0 var(--rule),0 3px 0 -1px var(--sheet),0 4px 0 -1px var(--rule)}
.row{padding:12px 16px;min-height:62px;border-top:1px solid var(--rule)}
.row:first-child{border-top:0}
.row.is-picked{background:var(--accent-tint);box-shadow:inset 3px 0 0 var(--accent)}
.row .title{font-weight:600;color:var(--ink)}
.row .meta{font-size:13.5px;color:var(--muted)}
.row .meta .kind{font-family:var(--num);font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin-right:6px}
.row .date{font-size:13px;color:var(--muted)}
.row .amt{font-size:15.5px}
.amt .cur{font-size:.72em;color:var(--muted);letter-spacing:.04em}
.likely{margin-top:6px;padding:7px 10px;font-size:12.5px;background:var(--page);border:1px dashed var(--rule-strong);--icon:15px}
.likely b{font-weight:500;color:var(--accent)}
.likely .i{color:var(--accent)}
.likely .why{color:var(--muted)}
.lede{color:var(--muted)}
.lede b{color:var(--ink);font-family:var(--num);font-weight:500}
.listfoot{color:var(--muted)}
.listfoot b{color:var(--ink);font-weight:500}
.month{gap:2px}
.month p{font-size:14px;min-width:9.5em;text-align:center}
.iconbtn{color:var(--accent);border-radius:var(--r)}
.iconbtn:hover{background:var(--sunken)}
.bankhead h1{margin-right:8px}

.bulkbar{background:var(--accent-hover);color:var(--on-accent);padding:10px 10px 10px 18px;border-radius:var(--r);box-shadow:0 10px 24px rgb(33 28 22 / .25);font-family:var(--num)}
.bulkbar b{font-weight:500}
.btn.onbar-primary{background:var(--on-accent);color:var(--accent);font-family:var(--font)}
.btn.onbar{background:transparent;color:var(--on-accent);border-color:${rgba(P.onAccent, 0.55)};font-family:var(--font)}
.bulkbar :focus-visible{outline-color:var(--on-accent)}
@media (min-width:880px){.bulkbar{min-width:28rem}}

/* review */
.back{color:var(--accent);font-weight:600;font-size:14px}
.stepper{color:var(--muted);font-size:14px}
.stepper b{color:var(--ink);font-weight:500}
.reviewhead{padding-bottom:16px;border-bottom:3px double var(--ink)}
.doc{background:var(--sunken) ${grain};padding:28px 16px 16px;border:1px solid var(--rule)}
.slip{font-family:var(--num);color:#2A2520;background:#FFFEFB}
.group{display:grid;gap:16px}
.group.need{background:var(--sheet);border:1px solid var(--rule);border-left:3px solid var(--warn);padding:16px 18px}
.group.need h2{color:var(--warn)}
.field label{font-weight:600}
.hint{font-size:13.5px;color:var(--warn)}
.hint.quiet{color:var(--muted)}
.unit{color:var(--muted);font-size:12px}
.read{padding:0 2px}
.rf{padding:9px 0;border-top:1px dotted var(--rule-strong)}
.rf dt{color:var(--muted);font-size:14px}
.rf dd{font-weight:500}
.actionbar{background:var(--bar);border-top:3px double var(--ink);padding:10px 0;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.actionbar .pos{color:var(--muted);font-size:14px}
.actionbar .pos b{color:var(--ink);font-weight:500}
@media (max-width:879px){
  .actionbar{margin:0 -16px;padding:8px 12px;border-top-width:1px;border-top-style:solid;border-color:var(--rule-strong)}
  .ab-acts{gap:6px}
  .ab-acts .btn{padding:0 6px;font-size:13.5px}
  .ab-acts .btn.ghost{padding:0 4px}
  .row .acts .btn.sm{min-height:38px}
  .rows{margin:0 -16px;border-inline:0}
  .row{padding:12px 16px}
}

.specimen{background:var(--page) ${grain};color:var(--ink);font:400 15px/1.45 var(--font)}
.iconkey li{font-size:14px}
.iconkey .i{color:var(--accent)}
${motion('p-strike .2s ease-out forwards,row-collapse .2s .26s cubic-bezier(.2,0,0,1) forwards')}
@media (prefers-reduced-motion:no-preference){
  .row.is-leaving::after{content:"";position:absolute;left:52px;right:16px;top:50%;border-top:2px solid var(--accent);transform-origin:left;animation:p-line .2s ease-out forwards}
  @keyframes p-line{from{transform:scaleX(0)}}
  @keyframes p-strike{to{background:var(--accent-tint)}}
}
`;

const paperPairs = [
  ['ink', 'page', 'text', 'Body text on the page'],
  ['ink', 'sheet', 'text', 'Row titles on the ledger sheet'],
  ['muted', 'page', 'text', 'Meta, tally and column heads on the page'],
  ['muted', 'sheet', 'text', 'Meta line and date in a row'],
  ['muted', 'sunken', 'text', 'Muted text on the document panel'],
  ['ink', 'accentTint', 'text', 'Row title on a selected row'],
  ['muted', 'accentTint', 'text', 'Meta on a selected row'],
  ['accent', 'page', 'text', 'Ghost buttons and links on the page'],
  ['accent', 'sheet', 'text', 'Ghost buttons in a row'],
  ['ink', 'field', 'text', 'Secondary button label, input text'],
  ['muted', 'field', 'text', 'Unit inside an input'],
  ['onAccent', 'accent', 'text', 'Primary button, nav count'],
  ['onAccent', 'accentHover', 'text', 'Primary while hovered, bulk bar text'],
  ['accent', 'onAccent', 'text', 'Bulk Approve: paper button, petrol label'],
  ['onAccent', 'danger', 'text', 'Delete forever (permanent delete only)'],
  ['warn', 'warnBg', 'text', 'Needs you, Missing, Overdue stamps'],
  ['warn', 'sheet', 'text', 'Hint under a flagged field'],
  ['info', 'infoBg', 'text', 'Reading, New sender stamps'],
  ['success', 'successBg', 'text', 'Undo banner and its Undo button'],
  ['danger', 'dangerBg', 'text', 'Error banner'],
  ['muted', 'barOverPage', 'text', 'Nav label on the translucent bar'],
  ['muted', 'barOverInk', 'text', 'Nav label over dark text scrolling under it (worst case)'],
  ['accent', 'barOverInk', 'text', 'Current nav item over dark text (worst case)'],
  ['ruleStrong', 'sheet', 'ui', 'Input, chip and secondary button outline'],
  ['ruleStrong', 'page', 'ui', 'Chip outline on the page'],
  ['ink', 'field', 'ui', 'Input baseline'],
  ['accent', 'page', 'ui', 'Focus ring, current tab rule'],
  ['warn', 'sheet', 'ui', 'Flagged group rule'],
  ['onBarOutline', 'accentHover', 'ui', 'Bulk Discard outline, 55% paper on petrol950'],
];

const fontFace = (family, url, weight) =>
  `@font-face{font-family:"${family}";src:url("${url}") format("woff2");font-weight:${weight};font-display:swap}`;

export const THEMES = {
  native: {
    title: 'Native app',
    colors: N,
    pairs: nativePairs,
    fontFaces: '',
    css: BASE + nativeCss,
  },
  paper: {
    title: 'Warm paper',
    colors: P,
    pairs: paperPairs,
    fontFaces: [
      fontFace('Bricolage', '../../../site/public/fonts/bricolage.woff2', '600 800'),
      fontFace('Instrument Sans', '../../../site/public/fonts/instrument-sans.woff2', '400 700'),
      fontFace('DM Mono', 'fonts/dm-mono-latin-400-normal.woff2', 400),
      fontFace('DM Mono', 'fonts/dm-mono-latin-500-normal.woff2', 500),
    ].join('\n'),
    css: BASE + paperCss,
  },
};
