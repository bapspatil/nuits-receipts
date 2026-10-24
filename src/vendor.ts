// Who sold it, when the document does not say clearly: labels the model copies
// along with the name ("Maksun saaja: Aalto Energia Oy"), copyright lines, the
// original sender of a forwarded email, and the user's own business names,
// which are never the vendor of an expense.
import { normalize } from './domain';

const LABEL =
  /^(?:maksun saaja|saaja|myyjä|laskuttaja|lähettäjä|seller|sold by|merchant|payee|vendor|supplier|from|billed by|issued by|verkäufer|empfänger)\s*:\s*/i;
// Labels printed in front of the seller's name, with or without a colon.
const LEAD =
  /^(?:receipt from|invoice from|your receipt from|kuitti|lasku|account holder|account name|company name|business name|merchant name|seller name|sold by|billed by|issued by)(?:\s*:\s*|\s+)/i;
// Labels in front of the customer: the line names the buyer, never the seller.
const BUYER_LABEL = /^(?:bill(?:ed)? to|invoice to|sold to|ship(?:ped)? to|customer|asiakas|laskutetaan)\b/i;

export function cleanVendor(value: string | null | undefined): string | null {
  if (!value) return null;
  let name = value.replace(/\s+/g, ' ').trim();
  if (BUYER_LABEL.test(name)) return null;
  for (let i = 0; i < 3; i++) {
    const before = name;
    name = name
      .replace(LABEL, '')
      .replace(LEAD, '')
      .replace(/^(?:©|\(c\)|copyright)\s*/i, '')
      .replace(/^(?:19|20)\d{2}(?:\s*[-–]\s*(?:19|20)\d{2})?\s*,?\s+/, '')
      .replace(/[.,]?\s*all rights reserved\.?$/i, '')
      .trim();
    if (name === before) break;
  }
  name = name.replace(/[\s,;:|–-]+$/, '').trim();
  return name.length >= 2 && /\p{L}/u.test(name) ? name.slice(0, 200) : null;
}

// True when every word of `vendor` is a word of the user's own names
// (SELLER_NAMES): "Nuits", "Bapusaheb Patil", "Nuits / Bapusaheb Patil".
export function isOwnName(vendor: string | null | undefined, own: readonly string[]): boolean {
  if (!vendor || !own.length) return false;
  const words = normalize(vendor).split(' ').filter(Boolean);
  const mine = new Set(own.flatMap((n) => normalize(n).split(' ').filter(Boolean)));
  return words.length > 0 && words.every((w) => mine.has(w));
}

const GENERIC =
  /^(?:no-?reply|do-?not-?reply|donotreply|notifications?|info|mail|billing|invoices?|receipts?|orders?|support|hello|hi)$/i;
const SECOND_LEVEL = new Set(['com', 'co', 'net', 'org', 'gov', 'ac', 'edu']);
function domainName(address: string): string | null {
  const host = address.slice(address.lastIndexOf('@') + 1).toLowerCase();
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return null;
  const keep = labels.length >= 3 && SECOND_LEVEL.has(labels[labels.length - 2]!) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

// A display name, or the sender's domain when the name is empty or generic.
export function senderName(from: { name?: string | null; address?: string | null } | null | undefined): string | null {
  if (!from) return null;
  const name = cleanVendor(
    (from.name ?? '')
      .replace(/^["']|["']$/g, '')
      .replace(/\s+via\s+.*$/i, '')
      .trim(),
  );
  if (name && !name.includes('@') && !GENERIC.test(name)) return name;
  return from.address && from.address.includes('@') ? domainName(from.address) : null;
}

// The original sender in a forwarded email's quoted header block.
export function forwardedSender(text: string): string | null {
  const marker = text.search(
    /-{3,}\s*(?:forwarded message|välitetty viesti|original message)|begin forwarded message|^\s*>?\s*(?:from|lähettäjä|von)\s*:/im,
  );
  if (marker < 0) return null;
  const line = text
    .slice(marker)
    .match(/^\s*>?\s*(?:from|lähettäjä|von|de)\s*:\s*(.+)$/im)?.[1]
    ?.trim();
  if (!line) return null;
  const address = line.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] ?? line.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] ?? null;
  const name = line
    .replace(/<[^<>]*>/g, '')
    .replace(/[^\s<>"]+@[^\s<>"]+/g, '')
    .replace(/\[mailto:[^\]]*\]/gi, '')
    .trim();
  return senderName({ name, address });
}
