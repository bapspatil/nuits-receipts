// Settings > About: the full notice from Legal's review (section 2.4), the
// licence and the trademark lines from the README. The footer carries the
// short version on every page; nothing else in the app repeats it.
import type { Env } from './env';
import { config } from './config';
import { DATA_LINE, escape } from './ui';

const NOTICE = [
  'Nuits Receipts is free, open-source software provided "as is", without warranties or conditions of any kind, as set out in the Apache License 2.0 (sections 7 and 8). It reads documents with an AI extraction model (Cloudflare Workers AI "Clairic", currently a preview model), and it can misread or miss vendors, amounts, VAT, dates and currencies. Bank matching is a suggestion, not a reconciliation you can rely on without checking.',
  'You are responsible for checking every figure, for your own bookkeeping, tax and VAT filings, and for keeping your original receipts as your local accounting law requires. Nuits Receipts is not an archive or a bookkeeping system. Ask your accountant or tax adviser about anything that matters.',
  `${DATA_LINE} You are responsible for your deployment, its security, its costs and the personal data in your receipts.`,
  'To the extent permitted by applicable law, Bapusaheb Patil / Nuits is not liable for any loss arising from use of the software. Nothing in this notice limits liability that cannot be limited by law.',
];
const TRADEMARKS = [
  'Holvi, Nordea, OP, Revolut, Wise, N26 and other bank names are trademarks of their respective owners. Nuits Receipts is not affiliated with or endorsed by any of them.',
  'Cloudflare, the Cloudflare logo, and Cloudflare Workers are trademarks and/or registered trademarks of Cloudflare, Inc. in the United States and other jurisdictions. Nuits Receipts is an independent project and is not affiliated with or endorsed by Cloudflare.',
];

export function aboutBody(env: Env): string {
  const repo = config(env).sourceRepository;
  const licence = repo ? `<a href="${escape(repo)}/blob/main/LICENSE">Apache-2.0</a>` : 'Apache-2.0';
  return `<div class="about"><p><strong>No warranty. Not financial, tax or accounting advice.</strong></p>${NOTICE.map((p) => `<p>${escape(p)}</p>`).join('')}<p>Licence: ${licence}. The licence does not grant rights to the "Nuits" or "Nuits Receipts" names (section 6); forks should use their own name.</p>${TRADEMARKS.map((p) => `<p>${escape(p)}</p>`).join('')}</div>`;
}
