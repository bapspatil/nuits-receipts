// Generated from src/tokens.json by scripts/app-tokens.mjs. Do not edit by hand.
// Change the source and run `bun run tokens`.

// The :root block of custom properties, in three layers.
export const TOKENS_CSS =
  ":root{/* primitives */--grey50:#F5F6F7;--grey0:#FFFFFF;--grey100:#ECEEF0;--petrol50:#E2ECEA;--red50:#FCEBEA;--green50:#E6F2EA;--grey950:#101418;--grey700:#4B5560;--petrol900:#0D3A36;--petrol950:#072522;--red700:#B3261E;--green800:#1E6B3C;--grey500:#7D8691;--grey200:#D6DADF;--paper:#E6EFE9;--font-display:\"Bricolage\",\"Arial Narrow\",system-ui,sans-serif;--font-ui:\"Instrument Sans\",system-ui,sans-serif;--font-mono:ui-monospace,Menlo,Consolas,monospace;--text-xs:12px;--text-sm:13px;--text-base:15px;--text-lg:18px;--text-xl:24px;--text-2xl:32px;--space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:24px;--space-6:32px;--space-7:48px;--space-8:64px;--radius-sm:2px;--radius-md:4px;--radius-pill:999px;--shadow-raised:0 1px 2px rgb(16 20 24/.08);/* semantic */--surface-page:var(--grey50);--surface-raised:var(--grey0);--surface-sunken:var(--grey100);--surface-accent-quiet:var(--petrol50);--text:var(--grey950);--text-muted:var(--grey700);--text-on-accent:var(--grey0);--border:var(--grey200);--border-strong:var(--grey500);--accent:var(--petrol900);--accent-hover:var(--petrol950);--danger:var(--red700);--danger-surface:var(--red50);--success:var(--green800);--success-surface:var(--green50);--focus-ring:var(--petrol900);/* component */--btn-primary-bg:var(--accent);--btn-primary-text:var(--text-on-accent);--btn-height:44px;--nav-height:56px;--tabbar-height:calc(3.5rem + 1px + env(safe-area-inset-bottom));--stamp-needs:var(--danger);--stamp-ok:var(--success);--stamp-missing:var(--danger);--field-height:44px;--row-height:48px;--frame-bg:var(--surface-sunken);--page-max:1120px;}@media(max-width:720px){:root{--text-base:16px;--text-2xl:26px;}}";

// The primitive colours as hex, for the places CSS variables cannot reach (the tab icon).
export const PALETTE = {
  "grey50": "#F5F6F7",
  "grey0": "#FFFFFF",
  "grey100": "#ECEEF0",
  "petrol50": "#E2ECEA",
  "red50": "#FCEBEA",
  "green50": "#E6F2EA",
  "grey950": "#101418",
  "grey700": "#4B5560",
  "petrol900": "#0D3A36",
  "petrol950": "#072522",
  "red700": "#B3261E",
  "green800": "#1E6B3C",
  "grey500": "#7D8691",
  "grey200": "#D6DADF",
  "paper": "#E6EFE9"
} as const;
