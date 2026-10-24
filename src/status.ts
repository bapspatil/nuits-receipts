// The words for the state of a receipt, a payment or a month. One place, so the
// same state never shows two different words on Home, Receipts, Bank or the
// receipt page.
export const STATUS = {
  needs: 'Needs you',
  reading: 'Reading',
  ready: 'Ready',
  matchedByYou: 'Matched by you',
  matchedAuto: 'Matched automatically',
  missing: 'Missing',
  notPurchase: 'Not a purchase',
  sent: 'Sent',
} as const;

// A bank row's match, from how bank_transactions.match_method recorded it.
export const matchStatus = (method: 'automatic' | 'manual' | null | undefined): string =>
  method === 'automatic' ? STATUS.matchedAuto : STATUS.matchedByYou;
