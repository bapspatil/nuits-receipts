// Generated from src/tokens.json by scripts/app-tokens.mjs. Do not edit by hand.
// Change the source and run `bun run tokens`.

// The :root block of custom properties, in three layers.
export const TOKENS_CSS =
  ":root{/* primitives */--paper50:#F3EDE2;--paper0:#FBF8F2;--paper-field:#FFFDF8;--paper200:#E6DDCC;--paper300:#DED3BF;--slip0:#FFFFFF;--petrol50:#DCE6DF;--red50:#F5DCD5;--green50:#E2ECD9;--amber50:#F6E3C1;--slate50:#E1E7EC;--ink950:#211C16;--ink700:#5E5446;--petrol900:#0D3A36;--petrol950:#072522;--red700:#A12820;--green800:#2E6A3C;--amber700:#87470A;--slate700:#2D4E73;--ink500:#857861;--ink200:#D8CCB8;--paper:#E6EFE9;--guilloche:#C2D8CB;--font-display:\"Bricolage\",\"Arial Narrow\",system-ui,sans-serif;--font-ui:\"Instrument Sans\",system-ui,sans-serif;--font-num:\"DM Mono\",ui-monospace,Menlo,monospace;--font-mono:\"DM Mono\",ui-monospace,Menlo,Consolas,monospace;--text-xs:0.75rem;--text-sm:0.8125rem;--text-base:0.9375rem;--text-lg:1.125rem;--text-xl:1.5rem;--text-2xl:2.125rem;--space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:24px;--space-6:32px;--space-7:48px;--space-8:64px;--radius-sm:8px;--radius-md:10px;--radius-lg:14px;--radius-glass:22px;--radius-pill:999px;--shadow-raised:0 1px 0 rgb(216 204 184),0 2px 6px rgb(33 28 22/.05);--shadow-glass:0 1px 2px rgb(33 28 22/.1),0 12px 32px -8px rgb(33 28 22/.24);--shadow-glass-edge:inset 0 1px 0 rgb(255 255 255/.8),inset 0 -1px 0 rgb(33 28 22/.08);/* semantic */--surface-page:var(--paper50);--surface-raised:var(--paper0);--surface-field:var(--paper-field);--surface-sunken:var(--paper200);--surface-accent-quiet:var(--petrol50);--text:var(--ink950);--text-muted:var(--ink700);--text-on-accent:var(--paper0);--border:var(--ink200);--border-strong:var(--ink500);--accent:var(--petrol900);--accent-hover:var(--petrol950);--danger:var(--red700);--danger-surface:var(--red50);--success:var(--green800);--success-surface:var(--green50);--focus-ring:var(--petrol900);--warn:var(--amber700);--warn-surface:var(--amber50);--info:var(--slate700);--info-surface:var(--slate50);--glass-filter:blur(24px) saturate(170%);--glass-border:rgb(133 120 97/.3);--surface-tab:var(--paper300);--slip:var(--slip0);--guilloche-line:var(--guilloche);--glass:rgb(251 248 242/0.85);/* component */--btn-primary-bg:var(--accent);--btn-primary-text:var(--text-on-accent);--btn-height:40px;--sidebar-width:260px;--tabbar-height:calc(76px + env(safe-area-inset-bottom));--stamp-needs:var(--warn);--stamp-ok:var(--success);--stamp-missing:var(--warn);--field-height:46px;--row-height:62px;--frame-bg:var(--surface-sunken);--page-max:1120px;}@media(max-width:720px){:root{--text-sm:0.84375rem;--text-base:1rem;--text-2xl:1.875rem;--btn-height:44px;}}";

// The primitive colours as hex, for the places CSS variables cannot reach (the tab icon).
export const PALETTE = {
  "paper50": "#F3EDE2",
  "paper0": "#FBF8F2",
  "paperField": "#FFFDF8",
  "paper200": "#E6DDCC",
  "paper300": "#DED3BF",
  "slip0": "#FFFFFF",
  "petrol50": "#DCE6DF",
  "red50": "#F5DCD5",
  "green50": "#E2ECD9",
  "amber50": "#F6E3C1",
  "slate50": "#E1E7EC",
  "ink950": "#211C16",
  "ink700": "#5E5446",
  "petrol900": "#0D3A36",
  "petrol950": "#072522",
  "red700": "#A12820",
  "green800": "#2E6A3C",
  "amber700": "#87470A",
  "slate700": "#2D4E73",
  "ink500": "#857861",
  "ink200": "#D8CCB8",
  "paper": "#E6EFE9",
  "guilloche": "#C2D8CB"
} as const;
