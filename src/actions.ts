// Every control the owner presses, from one registry: one label, one icon and one
// default tone per action, so an action looks the same on a row, in a bulk bar,
// in the banner and on the receipt page. Rendering takes an action key, never a
// class string, and a key never shares its icon with another meaning.
//
// Tone rules:
//   primary    the one main action of a view: the header's Start checking or Start
//              matching, or the page's one next step. Never inside a list row.
//   secondary  a plain action.
//   ghost      a quiet action. Every action Undo can reverse is secondary or ghost.
//   danger     red, for permanent delete only, behind a <details> confirm step.
// A row never carries a tone for its position. Icon-only controls are the
// previous and next chevrons and close, each with an aria-label and a title.
import { icon, type IconName } from './icons';
import { STATUS, type StatusKey } from './status';
import { escape } from './ui';

export type Tone = 'primary' | 'secondary' | 'ghost' | 'danger';
type Action = { label: string; icon: IconName; tone: Tone };

export const ACTIONS = {
  approve: { label: 'Approve', icon: 'check', tone: 'secondary' },
  discard: { label: 'Discard', icon: 'x', tone: 'ghost' },
  restore: { label: 'Restore', icon: 'undo-2', tone: 'secondary' },
  undo: { label: 'Undo', icon: 'undo-2', tone: 'ghost' },
  skip: { label: 'Skip', icon: 'skip-forward', tone: 'secondary' },
  save: { label: 'Save', icon: 'save', tone: 'secondary' },
  add: { label: 'Add', icon: 'circle-plus', tone: 'secondary' },
  edit: { label: 'Edit', icon: 'pencil', tone: 'ghost' },
  more: { label: 'More', icon: 'ellipsis', tone: 'ghost' },
  match: { label: 'Match', icon: 'link', tone: 'secondary' },
  matchAll: { label: 'Match all', icon: 'link', tone: 'secondary' },
  unmatch: { label: 'Unmatch', icon: 'unlink', tone: 'ghost' },
  ownTransfer: { label: 'Own transfer', icon: 'arrow-left-right', tone: 'ghost' },
  exempt: { label: 'Not a purchase', icon: 'ban', tone: 'ghost' },
  needs: { label: 'Needs a receipt', icon: 'file-question-mark', tone: 'ghost' },
  reread: { label: 'Read again', icon: 'scan-text', tone: 'ghost' },
  read: { label: 'Read it', icon: 'scan-line', tone: 'secondary' },
  move: { label: 'Move to invoices', icon: 'folder-input', tone: 'ghost' },
  moveBack: { label: 'Move to receipts', icon: 'folder-output', tone: 'ghost' },
  paid: { label: 'Mark paid', icon: 'banknote', tone: 'secondary' },
  unpaid: { label: 'Mark not paid', icon: 'banknote-x', tone: 'ghost' },
  mergeDup: { label: 'Merge duplicates', icon: 'merge', tone: 'secondary' },
  allow: { label: 'Allow', icon: 'user-check', tone: 'secondary' },
  ignore: { label: 'Ignore', icon: 'user-x', tone: 'ghost' },
  unignore: { label: 'Stop ignoring', icon: 'eye', tone: 'ghost' },
  remove: { label: 'Remove', icon: 'circle-minus', tone: 'ghost' },
  reset: { label: 'Reset', icon: 'rotate-ccw', tone: 'ghost' },
  delete: { label: 'Delete', icon: 'trash-2', tone: 'danger' },
  original: { label: 'Open original', icon: 'external-link', tone: 'secondary' },
  upload: { label: 'Upload', icon: 'upload', tone: 'secondary' },
  addMany: { label: 'Add several', icon: 'files', tone: 'ghost' },
  addReceipt: { label: 'Add receipt', icon: 'plus', tone: 'secondary' },
  addInvoice: { label: 'Add invoice', icon: 'file-plus', tone: 'secondary' },
  importStmt: { label: 'Import statement', icon: 'import', tone: 'secondary' },
  importAnyway: { label: 'Import anyway', icon: 'copy-plus', tone: 'secondary' },
  zip: { label: 'Download ZIP', icon: 'download', tone: 'secondary' },
  downloadAnyway: { label: 'Download anyway', icon: 'file-down', tone: 'ghost' },
  csv: { label: 'CSV', icon: 'file-spreadsheet', tone: 'ghost' },
  oneDrive: { label: 'Upload to OneDrive', icon: 'cloud-upload', tone: 'secondary' },
  connect: { label: 'Connect', icon: 'plug', tone: 'secondary' },
  disconnect: { label: 'Disconnect', icon: 'unplug', tone: 'ghost' },
  sent: { label: 'Mark as sent', icon: 'mail-check', tone: 'secondary' },
  start: { label: 'Start checking', icon: 'list-checks', tone: 'primary' },
  startMatching: { label: 'Start matching', icon: 'list-todo', tone: 'primary' },
  showMore: { label: 'Show 50 more', icon: 'chevrons-down', tone: 'secondary' },
  older: { label: 'Older', icon: 'chevrons-right', tone: 'secondary' },
  newest: { label: 'Newest', icon: 'chevrons-left', tone: 'secondary' },
  search: { label: 'Search', icon: 'search', tone: 'secondary' },
  clearSearch: { label: 'Clear search', icon: 'filter-x', tone: 'secondary' },
  showAll: { label: 'Show all', icon: 'list', tone: 'secondary' },
  seeReceipts: { label: 'See receipts', icon: 'receipt-text', tone: 'secondary' },
  checkAgain: { label: 'Check again', icon: 'repeat', tone: 'secondary' },
  cancel: { label: 'Cancel', icon: 'octagon-x', tone: 'ghost' },
  refresh: { label: 'Refresh', icon: 'refresh-cw', tone: 'secondary' },
  selectAll: { label: 'Select all', icon: 'square-check-big', tone: 'ghost' },
  clear: { label: 'Clear', icon: 'eraser', tone: 'ghost' },
  back: { label: 'Go back', icon: 'arrow-left', tone: 'secondary' },
  home: { label: 'Home', icon: 'house', tone: 'ghost' },
  signOut: { label: 'Sign out', icon: 'log-out', tone: 'secondary' },
} as const satisfies Record<string, Action>;
export type ActionKey = keyof typeof ACTIONS;

type Options = {
  // Only a view's one main action is primary. Defaults to the key's own tone.
  tone?: Tone;
  // The label with its context, "Start checking (124)". Plain text.
  label?: string;
  // Trusted attributes: name, value, form, formaction, aria-label, id.
  attrs?: string;
  // Visually hidden, for the default button that Enter in a field presses.
  quiet?: boolean;
};
const face = (key: ActionKey, o: Options) =>
  `${icon(ACTIONS[key].icon)}<span>${escape(o.label ?? ACTIONS[key].label)}</span>`;
const cls = (key: ActionKey, o: Options) => `btn ${o.tone ?? ACTIONS[key].tone}${o.quiet ? ' vh' : ''}`;

// A submit button. Pass attrs ` type="button"` or ` type="reset"` for the others.
export function button(key: ActionKey, o: Options = {}): string {
  return `<button class="${cls(key, o)}"${o.attrs ?? ''}>${face(key, o)}</button>`;
}
// A link that looks like a button, for a step that goes somewhere. href is plain, not escaped.
export function buttonLink(key: ActionKey, href: string, o: Options = {}): string {
  return `<a class="${cls(key, o)}" href="${escape(href)}"${o.attrs ?? ''}>${face(key, o)}</a>`;
}
// The summary of a <details> that holds the action's step: the same face as its button.
export function buttonSummary(key: ActionKey, o: Options = {}): string {
  return `<summary class="${cls(key, o)}"${o.attrs ?? ''}>${face(key, o)}</summary>`;
}

// A status as a stamp: its icon, its word and its tone, from one registry. With an href it is a
// link; context ("Overdue 14 Oct") follows the word inside the stamp.
export function statusMark(key: StatusKey, o: { href?: string; title?: string; after?: string } = {}): string {
  const s = STATUS[key];
  const body = `${icon(s.icon)}<span>${s.word}</span>${o.after ? ` <span class="when">${o.after}</span>` : ''}`;
  const title = o.title ? ` title="${escape(o.title)}"` : '';
  return o.href
    ? `<a class="stamp ${s.tone}" href="${escape(o.href)}"${title}>${body}</a>`
    : `<span class="stamp ${s.tone}"${title}>${body}</span>`;
}
