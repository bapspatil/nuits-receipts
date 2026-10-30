// The state of a receipt, a payment, a sender or a month, in one place: one word,
// one colour role and one icon per state. Row badges, stamps, chips and banners
// render from it (statusMark in src/actions.ts), so a state never shows two
// words or two looks. The tones are the colour roles of src/tokens.json: warn
// (amber) for what needs you, info (slate blue) for what is in progress, ok
// (green) for what is done, muted for what is set aside. Red is not a status.
import type { IconName } from './icons';

export type StatusTone = 'warn' | 'info' | 'ok' | 'muted';
type Status = { word: string; tone: StatusTone; icon: IconName };

export const STATUS = {
  needs: { word: 'Needs you', tone: 'warn', icon: 'circle-alert' },
  reading: { word: 'Reading', tone: 'info', icon: 'loader-circle' },
  newSender: { word: 'New sender', tone: 'info', icon: 'mail' },
  overdue: { word: 'Overdue', tone: 'warn', icon: 'calendar-clock' },
  missing: { word: 'Missing', tone: 'warn', icon: 'circle-dashed' },
  ready: { word: 'Ready', tone: 'ok', icon: 'circle-check' },
  matched: { word: 'Matched', tone: 'ok', icon: 'badge-check' },
  notPurchase: { word: 'Not a purchase', tone: 'muted', icon: 'circle-slash' },
  sent: { word: 'Sent', tone: 'ok', icon: 'send' },
  discarded: { word: 'Discarded', tone: 'muted', icon: 'circle-x' },
  duplicate: { word: 'Duplicate', tone: 'muted', icon: 'copy' },
  paid: { word: 'Paid', tone: 'ok', icon: 'circle-dollar-sign' },
  unpaid: { word: 'Unpaid', tone: 'muted', icon: 'hourglass' },
} as const satisfies Record<string, Status>;
export type StatusKey = keyof typeof STATUS;

// The state of a step in a list (Home's Check, Match, Send, the import wizard).
// Every step marker means the same thing everywhere: a tick is done, a filled
// dot is the one to do next, a ring is still to do. The marker is a picture;
// these are its words, read out in every list.
export const STEP = { done: 'Done', now: 'Next', todo: 'To do' } as const;
export type StepState = keyof typeof STEP;
