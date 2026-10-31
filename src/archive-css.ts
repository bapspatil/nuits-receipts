// Home's archive, as a filing drawer: year dividers like tabbed index cards with their months
// hanging below, the list on the app's sheet, and the opened document as a white slip with the
// logo's torn foot and a ledger of its facts. Desktop (1100px and up): drawer | list | preview.
// Narrower: the list, then the folders; an opened document takes the whole width, with a way back.
export const ARCHIVE_CSS = `
@media (min-width:1100px){.p-home main{max-width:1560px}}
.monthband{margin:0 0 var(--space-5)}
.monthband>.steps{grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--space-2);margin-bottom:var(--space-3)}
.monthband>.steps a,.monthband>.steps li>div{min-height:0;row-gap:0;padding:var(--space-3)}
.monthband>.steps b{font-size:var(--text-base)}
.monthband>.steps a::after{top:var(--space-3);right:var(--space-3)}
@media (max-width:720px){.monthband>.steps a,.monthband>.steps li>div{grid-template-columns:minmax(0,1fr);padding:var(--space-2) var(--space-3)}.monthband>.steps a::before,.monthband>.steps li>div::before,.monthband>.steps a::after{display:none}.monthband>.steps li>a>.vh,.monthband>.steps li>div>.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}}
.monthfold{margin:0 0 var(--space-4);background:none;border:0}
.monthfold>summary{display:inline-flex;gap:var(--space-2);align-items:center;min-height:44px;padding:0 var(--space-4);border:1px solid var(--guilloche-line);border-radius:var(--radius-pill);background:var(--surface-tab);font-weight:600;cursor:pointer}
.monthfold>summary span{font:500 var(--text-sm)/1 var(--font-num);color:var(--text-muted)}
.monthfold .body{padding-top:var(--space-3)}
.hband{margin:var(--space-5) 0 var(--space-4)}
.hfind{margin:0}
.hfind input{min-height:52px;font-size:var(--text-lg);border-radius:var(--radius-lg)}
.savesearch{margin-top:var(--space-2)}
.savesearch>summary{display:inline-flex;align-items:center;gap:var(--space-2);min-height:44px;color:var(--accent);font-weight:600;cursor:pointer}
.savesearch form{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:end}
.savesearch label{display:grid;gap:var(--space-1);font-size:var(--text-sm)}
.arch{display:grid;gap:var(--space-5);align-items:start}
.alist{min-width:0}
.tofolders{margin:0 0 var(--space-3)}
.tofolders a{display:inline-flex;align-items:center;gap:var(--space-2);min-height:44px;font-weight:600}
.lhead{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--space-3);margin:0 0 var(--space-3)}
.lhead h2{margin:0;font-family:var(--font-display);font-stretch:82%;letter-spacing:-.015em}
.alist .rt a{display:inline-flex;align-items:center;gap:var(--space-2)}
.alist .rt a .i{flex:none;color:var(--text-muted)}
.alist .rt a[aria-current=true]{font-weight:700;text-decoration:underline;text-decoration-thickness:2px}
.starred{display:inline-flex;margin-left:var(--space-2);color:var(--accent);vertical-align:middle}
.tagchip{display:inline-flex;align-items:center;margin-right:var(--space-1);padding:0 var(--space-2);border:1px solid var(--border);border-radius:var(--radius-pill);font:500 var(--text-xs)/1.4 var(--font-num);color:var(--text-muted);text-decoration:none}
a.tagchip:hover{border-color:var(--accent);color:var(--accent)}
.drawer{display:grid;gap:var(--space-4);align-content:start}
.drawer ul{list-style:none;margin:0;padding:0;display:grid;gap:var(--space-1)}
.drawer a{display:flex;align-items:center;gap:var(--space-2);min-height:40px;padding:0 var(--space-3);border-radius:var(--radius-sm);color:var(--text);text-decoration:none}
.drawer a span:first-of-type{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.drawer a .i{flex:none;color:var(--text-muted)}
.drawer a:hover{background:var(--surface-raised)}
.drawer a[aria-current=page]{background:var(--surface-accent-quiet);font-weight:600}
.drawer .n{font:500 var(--text-xs)/1 var(--font-num);font-variant-numeric:tabular-nums;color:var(--text-muted)}
.dgroup h3{margin:0 0 var(--space-2);padding:0 var(--space-3);font-size:var(--text-base);color:var(--text-muted)}
.years{display:grid;gap:var(--space-2)}
.divider>summary{display:flex;align-items:center;justify-content:space-between;min-height:44px;padding:0 var(--space-3);list-style:none;cursor:pointer;background:var(--surface-tab);border:1px solid var(--guilloche-line);border-bottom:0;border-radius:var(--radius-sm) var(--radius-sm) 0 0;width:max-content;min-width:60%}
.divider>summary::-webkit-details-marker{display:none}
.divider .tab{font:700 var(--text-lg)/1 var(--font-display);font-stretch:82%;letter-spacing:-.01em}
.divider .n{margin-left:var(--space-3)}
.divider>ul{padding:var(--space-2);background:var(--surface-raised);border:1px solid var(--guilloche-line);border-radius:0 var(--radius-sm) var(--radius-sm) var(--radius-sm)}
.divider:not([open])>summary{border-bottom:1px solid var(--guilloche-line);border-radius:var(--radius-sm)}
.overview{display:flex;flex-wrap:wrap;gap:var(--space-4) var(--space-6);align-items:end;margin:0 0 var(--space-4);padding:var(--space-4);background:var(--surface-raised);border:1px solid var(--border);border-radius:var(--radius-lg)}
.overview .facts{display:flex;flex-wrap:wrap;gap:var(--space-5);margin:0}
.overview dt{font-size:var(--text-sm);color:var(--text-muted)}
.overview dd{margin:0;font:600 var(--text-lg)/1.2 var(--font-num);font-variant-numeric:tabular-nums}
.bars{width:min(100%,432px);height:auto}
.bars .mbar{fill:var(--accent)}
.bars .lab{font:500 12px var(--font-num);fill:var(--text-muted);text-anchor:middle}
.pane{position:relative;filter:drop-shadow(0 2px 6px rgb(33 28 22/.08))}
.slip{display:grid;gap:var(--space-3);padding:var(--space-5) var(--space-5) calc(var(--space-6) + 10px);background:var(--slip);--foot:conic-gradient(from -45deg at bottom,transparent,black 1deg 89deg,transparent 90deg) bottom/16px 10px repeat-x;mask:linear-gradient(black 0 0) top/100% calc(100% - 10px) no-repeat,var(--foot)}
.pcrumbs a{font-size:var(--text-sm)}
.pkind{display:inline-flex;align-items:center;gap:var(--space-2);margin:0;font:500 var(--text-xs)/1 var(--font-num);text-transform:uppercase;letter-spacing:.12em;color:var(--text-muted)}
.slip h2{margin:0;font-family:var(--font-display);font-stretch:82%;letter-spacing:-.015em;overflow-wrap:anywhere}
.ptop{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-3)}
.ptop .amt{font:600 var(--text-lg)/1 var(--font-num);font-variant-numeric:tabular-nums}
.ledger{margin:0;display:grid}
.ledger>div{display:grid;grid-template-columns:minmax(96px,34%) minmax(0,1fr);gap:var(--space-3);padding:var(--space-2) 0;border-top:1px dashed var(--guilloche-line)}
.ledger>div:last-child{border-bottom:1px dashed var(--guilloche-line)}
.ledger dt{color:var(--text-muted);font-size:var(--text-sm)}
.ledger dd{margin:0;font-family:var(--font-num);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.tags{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:var(--space-2)}
.tags li{display:inline-flex;align-items:center;gap:var(--space-1)}
.tags .x{display:inline-grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:var(--radius-pill);background:none;color:var(--text-muted);cursor:pointer}
.tags .x:hover{background:var(--surface-sunken);color:var(--text)}
.tagform{display:flex;gap:var(--space-2)}
.tagform input{flex:1;min-width:0}
.note textarea{width:100%;margin-bottom:var(--space-2)}
table.csv{font:400 var(--text-sm)/1.4 var(--font-num)}
@media (min-width:1100px){
.arch{grid-template-columns:232px minmax(0,1fr)}
.arch.opened{grid-template-columns:minmax(0,1fr) minmax(400px,.9fr)}
.arch.opened>.drawer{display:none}
.tofolders{display:none}
.drawer{position:sticky;top:var(--space-4);max-height:calc(100vh - 2 * var(--space-4));overflow:auto;padding-right:var(--space-1)}
.pane{position:sticky;top:var(--space-4)}
.slip{max-height:calc(100vh - 2 * var(--space-4));overflow:auto}
}
@media (min-width:1680px){
.arch.opened{grid-template-columns:232px minmax(0,1fr) minmax(440px,.9fr)}
.arch.opened>.drawer{display:grid}
}
@media (max-width:1099px){
.drawer{order:2}
.arch.opened>.drawer,.arch.opened>.alist{display:none}
main:has(.arch.opened)>.hband,main:has(.arch.opened)>.monthband{display:none}
}
`;
