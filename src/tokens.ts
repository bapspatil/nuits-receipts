// Generated from src/tokens.json by scripts/app-tokens.mjs. Do not edit by hand.
// Change the source and run `bun run tokens`.

// The :root block of custom properties, in three layers.
export const TOKENS_CSS =
  ":root{/* primitives */--ink:#0D3A36;--ink-soft:#355650;--ink-press:#082A27;--paper:#E6EFE9;--slip:#FFFFFF;--guilloche:#C2D8CB;--mint:#9FD3BC;--frame:#D5E2DA;--stamp:#A8123F;--stamp-tint:#FBEEF2;--on-stamp:#FFFFFF;--font-display:\"Bricolage\",\"Arial Narrow\",system-ui,sans-serif;--font-ui:\"Instrument Sans\",system-ui,sans-serif;--font-mono:ui-monospace,Menlo,Consolas,monospace;--text-xs:.75rem;--text-sm:.875rem;--text-base:1rem;--text-lg:1.125rem;--text-xl:1.5rem;--text-2xl:1.75rem;--space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:24px;--space-6:32px;--space-7:48px;--space-8:64px;--radius-sm:2px;--radius-md:4px;--radius-pill:999px;--shadow-raised:0 18px 40px -18px rgb(13 58 54/.35);/* semantic */--surface-page:var(--paper);--surface-raised:var(--slip);--surface-sunken:var(--paper);--text:var(--ink);--text-muted:var(--ink-soft);--text-on-accent:var(--paper);--border:var(--guilloche);--border-strong:var(--ink);--accent:var(--ink);--accent-hover:var(--ink-press);--danger:var(--stamp);--danger-surface:var(--stamp-tint);--success:var(--ink);--success-surface:var(--mint);--focus-ring:var(--ink);/* component */--btn-primary-bg:var(--accent);--btn-primary-text:var(--text-on-accent);--btn-height:44px;--nav-height:64px;--tabbar-height:calc(3.5rem + 1px + env(safe-area-inset-bottom));--stamp-needs:var(--danger);--stamp-ok:var(--success);--stamp-missing:var(--danger);--field-height:44px;--row-height:56px;--frame-bg:var(--frame);}";

// The primitive colours as hex, for the places CSS variables cannot reach (the tab icon).
export const PALETTE = {
  "ink": "#0D3A36",
  "inkSoft": "#355650",
  "inkPress": "#082A27",
  "paper": "#E6EFE9",
  "slip": "#FFFFFF",
  "guilloche": "#C2D8CB",
  "mint": "#9FD3BC",
  "frame": "#D5E2DA",
  "stamp": "#A8123F",
  "stampTint": "#FBEEF2",
  "onStamp": "#FFFFFF"
} as const;
