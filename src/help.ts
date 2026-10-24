// /help: what the app's own words mean. The status words and the flags come
// from their registries (status.ts, flags.ts), so a new one can't be left out:
// STATUS_HELP is typed over STATUS's keys and every FLAGS code gets an anchor.
// test/help.test.ts holds both to that.
import type { Receipt } from './domain';
import { bodyOf, FLAGS, type Flag, type FlagGroup } from './flags';
import { STATUS } from './status';
import { escape } from './ui';

export type HelpEntry = {
  // Anchor ids that open this entry: /help#<id>.
  ids: string[];
  term: string;
  text: string;
};
export type HelpSection = {
  id: string;
  title: string;
  lede?: string;
  groups: { title?: string; entries: HelpEntry[] }[];
};

const STATUS_HELP: Record<keyof typeof STATUS, string> = {
  needs: "A receipt we couldn't finish reading, or one that needs a fact from you. Open Review to fix it.",
  reading: 'We are reading the file. It usually takes under a minute.',
  ready: 'Checked and complete. Nothing is left to do for it.',
  matchedByYou: 'You linked this payment to its receipt yourself.',
  matchedAuto:
    'The app paired this payment with a receipt because the seller, the date and the amount agree. You can remove the match.',
  missing: 'A payment out of your account that has no receipt yet.',
  notPurchase: "A payment that isn't a purchase, such as a transfer between your own accounts. It needs no receipt.",
  sent: 'You marked the month as sent to your accountant.',
};

const GLOSSARY: readonly HelpEntry[] = [
  {
    ids: ['part'],
    term: 'Part of the business',
    text: 'The area of your business a cost belongs to, such as Consulting or Hosting. Each receipt is filed under one, and the month package adds them up by part. You choose the list in Settings.',
  },
  {
    ids: ['kind'],
    term: 'Kind',
    text: 'What sort of cost a receipt is: infra, AI APIs, subscriptions or other. Your accountant sees the total for each kind within each part.',
  },
  {
    ids: ['undated'],
    term: 'Undated',
    text: 'A receipt with no date we could read. It belongs to no month yet, so it waits in Review until you type the date in.',
  },
  {
    ids: ['changed-since-sent'],
    term: 'Changed since you sent it',
    text: 'You marked a month as sent, then added, corrected or removed a receipt in it. Home shows what changed and offers the changes as a download, so your accountant gets the difference, not the whole month again.',
  },
  {
    ids: ['email-routing'],
    term: 'Email Routing',
    text: 'A Cloudflare feature that hands the mail sent to your receipt address to this app. You add a rule once, in Cloudflare under Email, Email Routing, with the action Send to a Worker. The app can’t add it for you. It is confirmed when a forwarded receipt arrives.',
  },
];

const MATCHING: readonly HelpEntry[] = [
  {
    ids: ['match-anyway'],
    term: 'Match anyway',
    text: "The payment and the receipt don't agree exactly, for example the amount differs by a few cents or the dates are far apart. The button says why. Press it only when you know they belong together; you can remove the match later.",
  },
];

// Show order of the flag groups.
const FLAG_GROUPS: readonly FlagGroup[] = [
  'Seller',
  'Date',
  'Amounts',
  'Details',
  'Euro amount',
  'Filing',
  'Duplicate',
  'Source',
];

// One entry per distinct flag; codes that share a flag share its entry.
function flagEntries(): Map<FlagGroup, HelpEntry[]> {
  const byFlag = new Map<Flag, string[]>();
  for (const [code, flag] of Object.entries(FLAGS)) byFlag.set(flag, [...(byFlag.get(flag) ?? []), code]);
  const groups = new Map<FlagGroup, HelpEntry[]>();
  for (const [flag, codes] of byFlag)
    groups.set(flag.group, [
      ...(groups.get(flag.group) ?? []),
      {
        ids: codes.map((c) => `flag-${c}`),
        term: flag.title,
        text: bodyOf(flag, { currency: null } as unknown as Receipt),
      },
    ]);
  return groups;
}

export function helpSections(): HelpSection[] {
  const flags = flagEntries();
  return [
    {
      id: 'words',
      title: 'Words you see',
      lede: 'The same word means the same thing on Home, Receipts, Bank and each receipt.',
      groups: [
        {
          entries: (Object.keys(STATUS) as (keyof typeof STATUS)[]).map((key) => ({
            ids: [`status-${key}`],
            term: STATUS[key],
            text: STATUS_HELP[key],
          })),
        },
      ],
    },
    { id: 'matching', title: 'Matching payments', groups: [{ entries: [...MATCHING] }] },
    { id: 'books', title: 'Your books', groups: [{ entries: [...GLOSSARY] }] },
    ...FLAG_GROUPS.filter((g) => flags.has(g)).map((g, i) => ({
      id: `flags-${g.toLowerCase().replace(/\W+/g, '-')}`,
      title: `Flags: ${g}`,
      lede: i === 0 ? 'When a receipt needs you, its card names the problem. These are all of them.' : undefined,
      groups: [{ entries: flags.get(g)! }],
    })),
  ];
}

export function helpBody(): string {
  const entry = (e: HelpEntry) =>
    `<div><dt id="${e.ids[0]}">${e.ids
      .slice(1)
      .map((id) => `<span id="${id}"></span>`)
      .join('')}${escape(e.term)}</dt><dd>${escape(e.text)}</dd></div>`;
  return `<div class="settings help">${helpSections()
    .map(
      (s) =>
        `<details class="sect" id="${s.id}"${s.id === 'words' ? ' open' : ''}><summary><h2>${escape(s.title)}</h2></summary><div class="body">${s.lede ? `<p class="small">${escape(s.lede)}</p>` : ''}${s.groups
          .map(
            (g) =>
              `${g.title ? `<h3>${escape(g.title)}</h3>` : ''}<dl class="kv">${g.entries.map(entry).join('')}</dl>`,
          )
          .join('')}</div></details>`,
    )
    .join('')}</div>`;
}
