// Feedback after an action. Every POST that changes something redirects with
// ?done=<event> plus the few params its message needs; the page shell shows one
// status banner from it, with an Undo form when an inverse route exists.
// The link is signed (src/signing.ts) and unsigned or stale ones never reach
// here; each param is still checked before use, and an Undo is offered only
// when all of its params are well formed.
// test/events.test.ts fails when a redirect names an event that isn't here.
import { isUndoOp, undoOf, type UndoOp } from './undo';

export type Undo = { action: string; fields: Record<string, string>; label?: string };
export type EventDef = {
  text: (p: URLSearchParams) => string;
  // A next step, as a link after the message.
  link?: (p: URLSearchParams) => { href: string; label: string } | null;
  // The inverse route, as a form the banner posts.
  undo?: (p: URLSearchParams) => Undo | null;
  // The Settings section (its anchor id) to open for this event.
  section?: (p: URLSearchParams) => string | null;
};

const ID = /^[a-f0-9]{64}$/;
const id = (p: URLSearchParams, key: string) => {
  const value = p.get(key) ?? '';
  return ID.test(value) ? value : null;
};
const count = (p: URLSearchParams, key: string) => {
  const value = Number(p.get(key));
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
};
// Free text that came from the address bar: bounded, and escaped where it is shown.
const words = (p: URLSearchParams, key: string, fallback: string) => (p.get(key) ?? '').trim().slice(0, 80) || fallback;
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
// Rows a bulk action left alone because it did not apply to them.
const skipped = (p: URLSearchParams) => (count(p, 'skipped') ? ` ${count(p, 'skipped')} skipped.` : '');
// A bulk run that changed no row says so, whatever its message would be.
const none = (p: URLSearchParams) => p.has('n') && !count(p, 'n');
const many = (p: URLSearchParams, text: string) => (none(p) ? 'Nothing changed.' : text) + skipped(p);
// The Undo of an action in the undo log (src/undo.ts), by its time and name, when it changed something.
// back: the receipt page a match was made or removed on, which its Undo returns to.
const logged = (p: URLSearchParams): Undo | null => {
  const action = none(p) ? null : undoOf(p.get('at'), p.get('op'));
  const back = p.get('back') ?? '';
  return (
    action && {
      action: '/undo',
      fields: { at: action.at, op: action.op, ...(/^\/receipts\/[a-f0-9]{64}$/.test(back) ? { back } : {}) },
    }
  );
};
// What an Undo brought back, per action.
const UNDONE: Record<UndoOp, (n: number) => string> = {
  approve: (n) => `Approval undone for ${plural(n, 'receipt')}.`,
  discard: (n) => `Brought back ${plural(n, 'receipt')}.`,
  exempt: (n) => `${plural(n, 'payment')} need${n === 1 ? 's' : ''} a receipt again.`,
  require: (n) => `${plural(n, 'payment')} ${n === 1 ? 'is' : 'are'} back as before.`,
  match: (n) => `Match undone for ${plural(n, 'payment')}.`,
  unmatch: (n) => `Matched ${plural(n, 'payment')} again.`,
  paid: (n) => `${plural(n, 'invoice')} ${n === 1 ? 'is' : 'are'} back as before.`,
  deleteRule: () => 'The rule is back.',
  settings: () => 'Your settings are back as they were.',
  import: (n) => `Removed ${plural(n, 'payment')} of that import.`,
};
const date = (value: string | null) =>
  value && /^\d{4}-\d\d-\d\d$/.test(value)
    ? new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '';
const monthLabel = (value: string | null) =>
  value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
    ? new Date(`${value}-01T00:00:00Z`).toLocaleDateString('en-GB', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : 'This month';
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthWord = (value: string | null) =>
  value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
    ? new Date(`${value}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })
    : '';
// What comes after Check, by what the month still lacks: its bank statement, matches, or sending.
const NEXT_STEP: Record<
  string,
  { text: (month: string) => string; link: (month: string) => { href: string; label: string } }
> = {
  import: {
    text: (m) => `add ${m}'s bank statement`,
    link: () => ({ href: '/import', label: 'Import statement' }),
  },
  match: {
    text: (m) => `match ${m}'s payments`,
    link: (m) => ({ href: `/payments?month=${m}&view=todo`, label: 'Open Bank' }),
  },
  send: {
    text: (m) => `send ${m} to your accountant`,
    link: (m) => ({ href: `/?month=${m}#send`, label: `Open ${monthWord(m)}` }),
  },
};
// The Settings section a setup group lives in.
const GROUP_SECTION: Record<string, string> = {
  business: 'setup-business',
  email: 'setup-email',
  accountant: 'setup-accountant',
  review: 'setup-review',
  integrations: 'setup-integrations',
};

// What a settings group is called in its banner: "Saved your accountant."
const GROUP_WORDS: Record<string, string> = {
  business: 'your business',
  email: 'your email settings',
  accountant: 'your accountant',
  review: 'review and matching',
  integrations: 'integrations',
  all: 'your settings',
};
const groupWords = (p: URLSearchParams) => GROUP_WORDS[p.get('group') ?? ''];

export const EVENTS = {
  // ---------- Receipts ----------
  approved: { text: (p) => (p.get('name') ? `Approved ${words(p, 'name', '')}.` : 'Approved.'), undo: logged },
  // The queue is empty: say so, and point at the step after Check for that month.
  approvedLast: {
    text: (p) => {
      const month = monthWord(p.get('month'));
      const next = month && NEXT_STEP[p.get('step') ?? ''];
      return next ? `Every receipt is checked. Next, ${next.text(month)}.` : 'Every receipt is checked.';
    },
    link: (p) => {
      const month = p.get('month') ?? '',
        next = NEXT_STEP[p.get('step') ?? ''];
      return monthWord(month) && next ? next.link(month) : { href: '/payments', label: 'Open Bank' };
    },
    undo: logged,
  },
  skipped: { text: () => 'Skipped. It stays in To do for later.' },
  saved: { text: () => 'Saved.' },
  movedBack: { text: () => 'Saved. It needs another look, so it moved back to To do.' },
  readAgain: { text: () => 'Reading it again. This can take a minute.' },
  uploaded: { text: () => "Uploaded. We're reading it now." },
  filesAdded: {
    text: (p) => {
      const added = count(p, 'added'),
        failed = count(p, 'failed');
      return `${added ? `${plural(added, 'file')} added. ` : ''}${failed ? `${plural(failed, 'file')} couldn't be added: each must be a PDF up to 10 MB or a photo up to 4 MB.` : ''}`.trim();
    },
  },
  kindMoved: {
    text: (p) =>
      `Moved to ${p.get('to') === 'sales' ? 'invoices' : 'receipts'}. If it was matched to a payment, that match was removed.`,
  },
  paid: {
    text: (p) => (date(p.get('on')) ? `Marked as paid on ${date(p.get('on'))}.` : 'Marked as paid.'),
    undo: logged,
  },
  notPaid: { text: () => 'Marked as not paid.', undo: logged },
  // Bulk actions on a list. Read again and Move have no Undo: they run in chunks and call the model.
  approvedMany: {
    text: (p) =>
      (count(p, 'n') ? `Approved ${plural(count(p, 'n'), 'receipt')}.` : 'Nothing was approved.') + skipped(p),
    undo: logged,
  },
  readAgainMany: {
    text: (p) => many(p, `Reading ${plural(count(p, 'n'), 'document')} again. This can take a minute.`),
  },
  kindMovedMany: {
    text: (p) =>
      many(p, `Moved ${plural(count(p, 'n'), 'document')} to ${p.get('to') === 'sales' ? 'invoices' : 'receipts'}.`),
  },
  paidMany: {
    text: (p) =>
      many(
        p,
        `Marked ${plural(count(p, 'n'), 'invoice')} as paid${date(p.get('on')) ? ` on ${date(p.get('on'))}` : ''}.`,
      ),
    undo: logged,
  },
  ruleSaved: { text: () => 'Rule saved.', section: () => 'rules' },
  ruleDeleted: { text: () => 'Rule deleted.', undo: logged, section: () => 'rules' },
  // ---------- Discard ----------
  discarded: {
    text: (p) => many(p, count(p, 'n') > 1 ? `${count(p, 'n')} discarded.` : 'Discarded.'),
    undo: logged,
  },
  // Every Undo of the undo log says what came back, and offers no Undo of its own.
  undone: {
    text: (p) => {
      const n = count(p, 'n'),
        op = p.get('op');
      // An import's Undo refuses once the owner has decided any of its payments.
      if (op === 'import' && count(p, 'changed'))
        return `${count(p, 'changed')} of these payments were changed since; nothing was removed.`;
      return n && isUndoOp(op) ? UNDONE[op](n) : 'Nothing to undo. It changed since.';
    },
    section: (p) => (/^[a-z][a-z-]{0,39}$/.test(p.get('section') ?? '') ? p.get('section') : null),
  },
  restored: { text: (p) => many(p, count(p, 'n') > 1 ? `${count(p, 'n')} restored.` : 'Restored.') },
  merged: { text: (p) => `Merged ${plural(count(p, 'n'), 'duplicate')}.` },
  // ---------- Unknown senders and Settings > Senders ----------
  // A bulk action adds senders (how many senders it took) and skipped.
  mailAllowed: {
    text: (p) =>
      (p.has('senders') && !count(p, 'senders')
        ? 'Nothing was allowed.'
        : (count(p, 'senders') > 1 ? `Allowed ${plural(count(p, 'senders'), 'sender')}.` : 'Allowed.') +
          (count(p, 'n') ? ` Reading ${plural(count(p, 'n'), 'email')}.` : '')) + skipped(p),
    section: (p) => (p.get('from') === 'settings' ? 'senders' : null),
  },
  mailIgnored: {
    text: (p) =>
      (p.has('senders') && !count(p, 'senders')
        ? 'Nothing was ignored.'
        : (count(p, 'senders') > 1 ? `Ignored ${plural(count(p, 'senders'), 'sender')}.` : 'Ignored.') +
          (count(p, 'n') ? ` ${plural(count(p, 'n'), 'email')} deleted.` : '')) + skipped(p),
    section: (p) => (p.get('from') === 'settings' ? 'senders' : null),
  },
  // Allow this sender, from Settings > Email senders. Undo takes them off the list again.
  senderAllowed: {
    text: (p) => {
      const sender = words(p, 'sender', 'The sender');
      return count(p, 'n')
        ? `Allowed ${sender}. Reading ${plural(count(p, 'n'), 'email')}.`
        : `Allowed ${sender}. Their next emails will be read.`;
    },
    undo: (p) => {
      const sender = p.get('sender') ?? '';
      return /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/.test(sender) && sender.length <= 254
        ? { action: '/senders/remove', fields: { address: sender, back: 'settings' } }
        : null;
    },
    section: () => 'senders',
  },
  senderRemoved: {
    text: (p) =>
      (p.has('n')
        ? count(p, 'n')
          ? `Removed ${plural(count(p, 'n'), 'sender')}.`
          : 'Nothing was removed.'
        : 'Sender removed.') + skipped(p),
    undo: logged,
    section: () => 'senders',
  },
  senderUnignored: {
    text: (p) =>
      (p.has('n')
        ? count(p, 'n')
          ? `${plural(count(p, 'n'), 'sender')} no longer ignored.`
          : 'Nothing changed.'
        : 'No longer ignored.') + skipped(p),
    section: () => 'senders',
  },
  // ---------- Bank ----------
  matched: {
    text: (p) =>
      `Matched ${words(p, 'name', 'the payment')} to ${p.get('kind') === 'invoice' ? 'an invoice' : 'a receipt'}.`,
    undo: logged,
  },
  unmatched: {
    text: (p) => `Removed the match for ${words(p, 'name', 'the payment')}.`,
    undo: logged,
  },
  // Match all likely. picked=1: from the bulk bar, where skipped also counts rows with no exact likely receipt.
  matchedMany: {
    text: (p) => {
      const n = count(p, 'n'),
        left = count(p, 'skipped');
      const changed = !left
        ? ''
        : p.get('picked') === '1'
          ? ` ${left} skipped: no exact likely receipt, or changed since you opened the page.`
          : ` ${plural(left, 'payment')} changed since you opened the page and ${left === 1 ? 'was' : 'were'} left alone.`;
      return n ? `Matched ${plural(n, 'payment')}.${changed}` : `Nothing was matched.${changed}`;
    },
    undo: (p) => (count(p, 'n') ? logged(p) : null),
  },
  unmatchedMany: { text: (p) => many(p, `Removed ${plural(count(p, 'n'), 'match', 'matches')}.`), undo: logged },
  notPurchaseMany: {
    text: (p) =>
      (count(p, 'n') ? `Marked ${plural(count(p, 'n'), 'payment')} as not a purchase.` : 'Nothing changed.') +
      skipped(p),
    undo: logged,
  },
  needsReceiptMany: {
    text: (p) =>
      (count(p, 'n')
        ? `${plural(count(p, 'n'), 'payment')} need${count(p, 'n') === 1 ? 's' : ''} a receipt again.`
        : 'Nothing changed.') + skipped(p),
    undo: logged,
  },
  notPurchase: {
    text: (p) => `${words(p, 'name', 'That payment')} is not a purchase, so it no longer needs a receipt.`,
    undo: logged,
  },
  needsReceipt: {
    text: (p) => `${words(p, 'name', 'That payment')} needs a receipt again.`,
    undo: logged,
  },
  transferMade: {
    text: (p) => `${words(p, 'name', 'That payment')} is now a transfer between your own accounts.`,
    undo: (p) => {
      const tx = id(p, 'tx');
      return tx ? { action: `/transfers/${tx}/undo`, fields: {} } : null;
    },
  },
  // No Undo: making the transfer again needs the note typed the first time, which is deleted with it.
  transferUndone: { text: () => 'Transfer undone. Both payments need a receipt again.' },
  // imp: the import; anyway: its payments with no bank ID that look like ones already in the app;
  // similar: payments that look like ones in another account (a warning, not a gate).
  imported: {
    text: (p) => {
      const added = count(p, 'inserted'),
        skipped = count(p, 'skipped'),
        again = count(p, 'replayed'),
        similar = count(p, 'similar');
      if (again) return `You imported this file before, so nothing changed. It has ${plural(again, 'payment')}.`;
      const tally = p.has('missing')
        ? ` Paid out: ${count(p, 'auto')} matched, ${count(p, 'np')} not a purchase, ${count(p, 'missing')} missing.`
        : '';
      return `Added ${plural(added, 'payment')}.${tally}${skipped ? ` Skipped ${skipped} already imported.` : ''}${similar ? ` ${plural(similar, 'payment')} look${similar === 1 ? 's' : ''} like ${similar === 1 ? 'one' : 'ones'} in another account.` : ''}`;
    },
    link: (p) =>
      count(p, 'anyway') && id(p, 'imp')
        ? { href: `/import/anyway?import=${id(p, 'imp')}&n=${count(p, 'anyway')}`, label: 'Import anyway' }
        : count(p, 'auto') && MONTH.test(p.get('month') ?? '')
          ? { href: `/payments?month=${p.get('month')}&view=all`, label: 'See them' }
          : null,
    undo: (p) => (count(p, 'inserted') && !count(p, 'replayed') && p.get('op') === 'import' ? logged(p) : null),
  },
  // ---------- Month ----------
  // Undo drops that one send, so the month is back as it was before: the earlier send, or not sent.
  sent: {
    text: (p) => `Marked ${monthLabel(p.get('month'))} as sent.`,
    undo: (p) => {
      const at = p.get('at') ?? '',
        month = p.get('month') ?? '';
      return /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(at) && MONTH.test(month)
        ? { action: '/month/sent/undo', fields: { month, at } }
        : null;
    },
  },
  sentUndone: { text: (p) => `${monthLabel(p.get('month'))} is not marked as sent any more.` },
  driveDone: { text: () => 'Uploaded to OneDrive. Marked as sent.' },
  driveMore: {
    text: (p) =>
      `${count(p, 'n')} of ${count(p, 'of')} uploaded.${count(p, 'wait') ? ` Continue in ${count(p, 'wait')} s.` : ''}`,
  },
  // ---------- Settings ----------
  // removed: parts the save took away; its Undo puts the whole save back.
  settingsSaved: {
    text: (p) =>
      (groupWords(p) ? `Saved ${groupWords(p)}.` : 'Saved.') +
      (count(p, 'removed') ? ` Removed ${plural(count(p, 'removed'), 'part')}.` : ''),
    undo: logged,
    section: (p) =>
      GROUP_SECTION[p.get('group') ?? ''] ?? (/^setup-[a-z]+$/.test(p.get('section') ?? '') ? p.get('section') : null),
  },
  settingsSame: {
    text: (p) => (groupWords(p) ? `Nothing changed in ${groupWords(p)}.` : 'Nothing changed.'),
    section: (p) => GROUP_SECTION[p.get('group') ?? ''] ?? null,
  },
  settingReset: {
    text: (p) =>
      `${words(p, 'label', 'That setting')} is back to ${p.get('to') === 'deploy' ? 'the value set when deployed' : 'the built-in default'}.`,
    section: (p) => GROUP_SECTION[p.get('group') ?? ''] ?? null,
  },
  accountCreated: { text: () => 'Account created.', section: () => 'accounts' },
  accountRenamed: { text: (p) => `Renamed to ${words(p, 'name', 'the new name')}.`, section: () => 'accounts' },
  oneDriveConnected: { text: () => 'Microsoft account connected.', section: () => 'onedrive' },
  oneDriveFolder: { text: () => 'Folder saved.', section: () => 'onedrive' },
  oneDriveDisconnected: {
    text: () => 'Disconnected. Its sign-in was deleted from this app.',
    section: () => 'onedrive',
  },
} as const satisfies Record<string, EventDef>;

export type EventKey = keyof typeof EVENTS;
export const isEvent = (key: string | null): key is EventKey => !!key && Object.hasOwn(EVENTS, key);

// location plus ?done=<event> and the params its message needs, before any #fragment.
export function withDone(
  event: EventKey,
  location: string,
  extra: Record<string, string | number | null | undefined> = {},
): string {
  const [path = '', hash] = location.split('#');
  const query = new URLSearchParams({ done: event });
  for (const [key, value] of Object.entries(extra))
    if (value !== null && value !== undefined) query.set(key, String(value));
  return `${path}${path.includes('?') ? '&' : '?'}${query}${hash === undefined ? '' : '#' + hash}`;
}

export type Feedback = {
  event: EventKey;
  text: string;
  link: { href: string; label: string } | null;
  undo: Undo | null;
  section: string | null;
};
// An Undo returns to the list it was offered on: the page's list state rides along in its form,
// under the names the list URL uses (from, on a receipt page; kind=sales on Invoices), unless the
// Undo sets them itself. An Undo of Settings names the section to land on.
const LIST_PARAMS = ['view', 'from', 'month', 'upto', 'show', 'q', 'kind'] as const;
function onList(undo: Undo | null, params: URLSearchParams, section: string | null): Undo | null {
  if (!undo) return null;
  const fields: Record<string, string> = { ...undo.fields };
  if (section) fields.section = section;
  for (const key of LIST_PARAMS) {
    const value = params.get(key);
    // kind is the list's only as Invoices' kind=sales; a match event's kind=receipt is its own.
    if (value && !(key in fields) && (key !== 'kind' || value === 'sales')) fields[key] = value.slice(0, 100);
  }
  return { ...undo, fields };
}
// What the query asks the page to say, if it names an event with a message.
export function feedback(params: URLSearchParams): Feedback | null {
  const key = params.get('done');
  if (!isEvent(key)) return null;
  const def: EventDef = EVENTS[key];
  const text = def.text(params);
  if (!text) return null;
  const section = def.section?.(params) ?? null;
  return {
    event: key,
    text,
    link: def.link?.(params) ?? null,
    undo: onList(def.undo?.(params) ?? null, params, section),
    section,
  };
}
