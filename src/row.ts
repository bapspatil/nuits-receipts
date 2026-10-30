import { escape, rowAttrs } from './ui';

// One row for every list: Receipts To do and All, held mail, Bank and the Settings lists. Each
// part has one place in the grid (src/ui.ts, .row), so a list never lays out its own columns.
// No row holds a primary; the view's one primary is in its header.
export type RowView = {
  // A work-list row: data-row, id="row-<key>", focusable and named for the view transition.
  key?: string;
  // A plain anchor for a row that is not a work-list row, "mail-<id>".
  id?: string;
  // The bulk checkbox (bulkCheck), always visible.
  pick?: string;
  // Escaped text, set in DM Mono.
  date?: string;
  // HTML: the row's name, often a link.
  title: string;
  meta?: string;
  // One STATUS stamp, from statusMark.
  status?: string;
  amount?: string;
  // Buttons, forms and a More fold, from the ACTIONS registry.
  actions?: string;
  // Full width under the row: Bank's match controls.
  below?: string;
};

export function row(r: RowView): string {
  const anchor = r.key
    ? ` data-row="${escape(r.key)}" id="row-${escape(r.key)}"${rowAttrs(r.key)}`
    : r.id
      ? ` id="${escape(r.id)}"`
      : '';
  const part = (cls: string, html: string | undefined, tag = 'span') =>
    html ? `<${tag} class="${cls}">${html}</${tag}>` : '';
  return `<li class="row"${anchor}>${r.pick ?? ''}${part('date', r.date)}<div class="rb"><p class="rt">${r.title}</p>${part('meta', r.meta, 'p')}</div>${part('rs', r.status)}${part('amt', r.amount)}${part('ra', r.actions, 'div')}${part('rx', r.below, 'div')}</li>`;
}

// The grouped sheet the rows sit on.
export function rowList(rows: readonly string[], label = ''): string {
  return `<ul class="list"${label ? ` aria-label="${escape(label)}"` : ''}>${rows.join('')}</ul>`;
}
