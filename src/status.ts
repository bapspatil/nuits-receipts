// The words for the state of a receipt, a payment or a month. One place, so the
// same state never shows two different words on Home, Receipts, Bank or the
// receipt page.
export const STATUS = {
  needs: 'Needs you',
  reading: 'Reading',
  ready: 'Ready',
  matched: 'Matched',
  missing: 'Missing',
  notPurchase: 'Not a purchase',
  sent: 'Sent',
} as const;

// The state of a step in a list (Home's Check, Match, Send, the import wizard).
// Every step marker means the same thing everywhere: a tick is done, a filled
// dot is the one to do next, a ring is still to do. The marker is a picture;
// these are its words, read out in every list.
export const STEP = { done: 'Done', now: 'Next', todo: 'To do' } as const;
export type StepState = keyof typeof STEP;
