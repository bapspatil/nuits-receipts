// Receipts To do: what needs the owner, mail from unknown senders, receipts to check and overdue
// sales invoices. All, the archive, is Home (src/archive.ts).
import type { Env } from './env';
import { config } from './config';
import { button, buttonLink, buttonSummary, statusMark } from './actions';
import { type Receipt } from './domain';
import { flagCards, flagFor, needsReview, reasonCodes, todoReasons } from './flags';
import { BULK_CAP, bulkBar, bulkCheck, bulkTools, RECEIPT_ACTIONS, type BulkList } from './bulk';
import { BANK_UPTO } from './banking';
import { mergePlan } from './dedupe';
import { dueOn, iso } from './invoices';
import { receiptName } from './match';
import { heldCount, heldMail, type MailRow } from './inbound';
import {
  LIST_DEFS,
  listFields,
  listParams,
  listUrl,
  openCount,
  openRows,
  RECEIPTS_TODO,
  receiptUrl,
  type ListState,
  type View,
} from './worklist';
import {
  amount,
  emptyState,
  escape,
  monthName,
  page,
  pageHead,
  plural,
  shortDay,
  viewSwitch,
  VIEW_TRANSITION_CSS,
} from './ui';
import { row, rowList } from './row';
import { archiveQuery, filterCount } from './archive';

// The To do | All switch of Receipts, under the month the page has. All counts the archive the
// Receipts tab of All shows.
export async function receiptsSwitch(env: Env, month: string | null, view: View): Promise<string> {
  const state: ListState = { ...RECEIPTS_TODO, month };
  const [todo, all, invoices] = await Promise.all([
    openCount(env, LIST_DEFS.receipts!, state).then((c) => c.total),
    filterCount(env, { ...archiveQuery(new URLSearchParams()), month }),
    filterCount(env, { ...archiveQuery(new URLSearchParams({ in: 'kind:sales' })), month }),
  ]);
  // All is Home's archive now, so Invoices, the sales work list, is the switch's third link.
  const href = escape(listUrl({ ...state, key: 'invoices', view: 'all' }));
  return viewSwitch((v) => listUrl({ ...state, view: v }), { todo, all }, view).replace(
    '</ul></nav>',
    `<li><a href="${href}" data-view="invoices" data-count="${invoices}">Invoices (${invoices})</a></li></ul></nav>`,
  );
}

// The first problem as one word, for the list. The full question is its tooltip.
const REASON_WORDS: Record<string, string> = {
  Seller: 'Seller',
  Date: 'Date',
  Amounts: 'Amount',
  Details: 'Details',
  'Euro amount': 'Euros',
  Filing: 'Filing',
  Duplicate: 'Duplicate',
  Source: 'File',
  Other: 'Check',
};
function reasonWord(r: Receipt): string {
  const cards = flagCards(todoReasons(reasonCodes(r.review_reasons_json)));
  const word = REASON_WORDS[cards[0]?.flag.group ?? 'Other'] ?? 'Check';
  return cards.length > 1 ? `${word} +${cards.length - 1}` : word;
}
function firstFlag(r: Receipt): string {
  const code = todoReasons(reasonCodes(r.review_reasons_json))[0];
  return code ? flagFor(code).title.replace(/\.$/, '') : 'Needs a look';
}

// An email from an unknown sender: Allow reads it, Ignore asks first, as it deletes the email.
function heldRow(m: MailRow, back: string): string {
  const who = escape(m.sender);
  const fields = `<input type="hidden" name="address" value="${who}"><input type="hidden" name="back" value="${escape(back)}">`;
  return row({
    id: `mail-${m.id}`,
    title: who,
    meta: m.subject ? escape(m.subject) : '(no subject)',
    status: statusMark('newSender'),
    actions: `<form method="post" action="/senders/approve">${fields}${button('allow', { attrs: ` aria-label="Allow ${who}"` })}</form><details class="more">${buttonSummary('ignore', { attrs: ` aria-label="Ignore ${who}"` })}<div class="body"><form method="post" action="/senders/ignore">${fields}<p class="ask">Delete the waiting mail from ${who}, and only log what they send later?</p>${button('ignore', { label: 'Ignore and delete' })}</form></div></details>`,
  });
}

// Receipts To do: the held mail, then the open rows of the list in its order, the first upto of
// them, across every month unless the list names one.
export async function todoPage(env: Env, state: ListState): Promise<Response> {
  const def = LIST_DEFS.receipts!;
  const [rows, { total }, held, heldTotal, reading, merges, switcher] = await Promise.all([
    openRows<Receipt>(env, def, state, state.upto),
    openCount(env, def, state),
    heldMail(env),
    heldCount(env),
    env.DB.prepare(
      "SELECT count(*) n FROM receipts WHERE status IN ('pending','processing') AND duplicate_of IS NULL AND discarded_at IS NULL",
    ).first<number>('n'),
    mergePlan(env),
    receiptsSwitch(env, state.month, 'todo'),
  ]);
  const terms = config(env).tuning.paymentTermsDays;
  const bulk: BulkList = {
    form: 'bulk-todo',
    action: '/receipts/bulk',
    noun: ['receipt', 'receipts'],
    total,
    scope: listParams(state),
    actions: [RECEIPT_ACTIONS.approve, RECEIPT_ACTIONS.discard],
  };
  const fields = listFields(state);
  const items = rows.map((r) => {
    const name = receiptName(r);
    const sales = r.kind === 'sales';
    const overdue = sales && !needsReview(r);
    const kind = `<span class="kind">${sales ? 'Invoice' : 'Receipt'}</span> `;
    return row({
      key: r.id,
      pick: bulkCheck(bulk, r.id, name),
      date: r.issue_date ? escape(shortDay(r.issue_date)) : 'Undated',
      title: `<a href="${escape(receiptUrl(r.id, state))}">${escape(name)}</a>`,
      meta: overdue
        ? `${kind}Due ${escape(shortDay(dueOn(r, terms) ?? r.issue_date!))}`
        : `${kind}<span title="${escape(firstFlag(r))}">${escape(reasonWord(r))}</span>`,
      status: statusMark(overdue ? 'overdue' : 'needs'),
      amount: r.total_minor === null ? '' : amount(r.total_minor, r.currency),
      actions: overdue
        ? `<details class="more">${buttonSummary('paid', { attrs: ` aria-label="Mark paid: ${escape(name)}"` })}<div class="body"><form method="post" action="/receipts/${r.id}/paid">${fields}<label>Paid on<input type="date" name="paid_outside_on" value="${iso()}" required></label><label>How<input name="paid_outside_note" maxlength="300" required placeholder="Stripe payout 14 Oct"></label>${button('paid')}</form></div></details>`
        : '',
    });
  });
  const everything = total + heldTotal;
  const left = total - rows.length;
  const more =
    left > 0 && state.upto < BULK_CAP
      ? `<p>${buttonLink('showMore', listUrl({ ...state, upto: Math.min(state.upto + BANK_UPTO, BULK_CAP) }), { label: `Show ${Math.min(left, BANK_UPTO)} more` })}</p>`
      : '';
  const mail = held.length
    ? `<section id="unknown" aria-labelledby="unknown-h"><h2 id="unknown-h">Unknown senders (${heldTotal})</h2>${rowList(held.map((m) => heldRow(m, listUrl(state))))}</section>`
    : '';
  const list = `<div data-list="receipts-todo" data-total="${total}"${rows.length ? ` data-bulk-list="${bulk.form}"` : ''}>${
    rows.length
      ? `${bulkTools(bulk, rows.length)}${rowList(items)}`
      : everything
        ? ''
        : emptyState(
            'Nothing to do.',
            buttonLink('seeReceipts', listUrl({ ...state, view: 'all' }), { tone: 'primary' }),
          )
  }</div>${rows.length ? `${bulkBar(bulk)}${more}` : ''}`;
  const merge = merges.length
    ? `<div class="tools"><form class="merge" action="/receipts/merge" method="post">${fields}${button('mergeDup', { label: `Merge ${plural(merges.length, 'duplicate')}` })}</form></div>`
    : '';
  const month = state.month
    ? `<p class="small">${escape(monthName(state.month))} and undated only. <a href="${escape(listUrl({ ...state, month: null }))}">Every month</a></p>`
    : '';
  // The header counts the list it heads, as the switch does; the mail section carries its own count.
  const head = total
    ? `<p class="listhead">${rows.length < total ? `${rows.length} of ${total}` : total} to do</p>`
    : '';
  // The one primary: the first open row, which Approve then walks on from.
  const start = rows[0]
    ? buttonLink('start', receiptUrl(rows[0].id, state), { label: `Start checking (${total})` })
    : '';
  return page(
    'receipts',
    `${switcher}${month}${merge}${reading ? `<p class="banner" role="status">${reading} being read <a href="${escape(listUrl(state))}">Refresh</a></p>` : ''}${head}${mail}${list}`,
    200,
    env,
    { head: pageHead('Receipts', start), style: VIEW_TRANSITION_CSS },
  );
}
