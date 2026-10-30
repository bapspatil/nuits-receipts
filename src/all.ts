// Receipts, one page with two views. To do holds what needs the owner: mail from unknown senders,
// receipts to check and overdue sales invoices. All is the archive, newest first.
import type { Env } from './env';
import { config } from './config';
import { STATUS } from './status';
import { DISCARD_REASONS, type DiscardReason, type Receipt, requireInput } from './domain';
import { flagCards, flagFor, needsReview, needsReviewSql, readySql, reasonCodes, todoReasons } from './flags';
import { restoreForm } from './discard';
import { BULK_CAP, bulkBar, bulkCheck, bulkTools, RECEIPT_ACTIONS, type BulkList } from './bulk';
import { BANK_UPTO } from './banking';
import { mergePlan } from './dedupe';
import { dueOn, invoiceName, iso } from './invoices';
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
  chipRow,
  emptyState,
  escape,
  monthHead,
  monthName,
  tabCounts,
  addButton,
  page,
  pageHead,
  plural,
  shortDay,
  receiptsTabs,
  tag,
  viewSwitch,
} from './ui';

export const PAGE_SIZE = 50;
export const SHOW = {
  ready: STATUS.ready,
  needs: STATUS.needs,
  reading: STATUS.reading,
  duplicate: 'Duplicate',
  discarded: 'Discarded',
  sales: 'Sales invoices',
  unknown: 'Unknown sender',
} as const;
export type Show = keyof typeof SHOW;
// Only the exceptions are chips. Ready is the default, Sales has its own
// segment, and Needs you and Unknown sender are To do's: all still filter
// from the URL.
const CHIPS = ['reading', 'duplicate', 'discarded'] as const;
export type AllRow = {
  type: 'receipt' | 'mail';
  id: string;
  received_at: string;
  kind: string | null;
  status: string;
  duplicate_of: string | null;
  discarded_at: string | null;
  discard_reason: DiscardReason | null;
  vendor: string | null;
  filename: string | null;
  client: string | null;
  invoice_number: string | null;
  total_minor: number | null;
  currency: string | null;
  issue_date: string | null;
  sender: string | null;
  subject: string | null;
  review_reasons_json: string;
};
const WHERE: Record<Show, string> = {
  ready: `type='receipt' AND ${readySql()} AND duplicate_of IS NULL AND discarded_at IS NULL`,
  needs: `type='receipt' AND ${needsReviewSql()} AND duplicate_of IS NULL AND discarded_at IS NULL`,
  reading: "type='receipt' AND status IN ('pending','processing') AND duplicate_of IS NULL AND discarded_at IS NULL",
  duplicate: "type='receipt' AND duplicate_of IS NOT NULL AND discarded_at IS NULL",
  discarded: "type='receipt' AND discarded_at IS NOT NULL",
  sales: "type='receipt' AND kind='sales' AND discarded_at IS NULL",
  unknown: "type='mail'",
};
const RECEIPTS = `SELECT 'receipt' AS type,id,received_at,kind,status,duplicate_of,discarded_at,discard_reason,vendor,filename,client,invoice_number,total_minor,currency,issue_date,NULL AS sender,NULL AS subject,review_reasons_json FROM receipts`;
const HELD = `SELECT 'mail',id,received_at,NULL,'held',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,sender,subject,'[]' FROM inbound_mail WHERE state='held'`;

// The All list's filter and its keyset cursor: the arrival time and id of the last row shown.
export type AllQuery = { show: Show | null; month: string | null; q: string; before: Cursor | null };
type Cursor = { at: string; id: string };
const CURSOR = /^([0-9][0-9T:.+-]{9,34}Z?)_([a-f0-9-]{36,64})$/;

// The list's filter as SQL over RECEIPTS and HELD, shared by the page and its bulk actions.
export function allWhere(query: Omit<AllQuery, 'before'>): { where: string; binds: unknown[] } {
  const where: string[] = [],
    binds: unknown[] = [];
  // Discarded rows show only under their own chip.
  // Invoices have their own tab; a search looks in both.
  where.push(
    query.show ? WHERE[query.show] : `(type='mail' OR (discarded_at IS NULL${query.q ? '' : " AND kind<>'sales'"}))`,
  );
  if (query.month) {
    // The document's month, like Home; undated ones by when they arrived.
    where.push('substr(coalesce(issue_date,received_at),1,7)=?');
    binds.push(query.month);
  }
  if (query.q) {
    // instr, not LIKE: D1 refuses a LIKE pattern over 50 bytes, and a search may be 100 characters.
    where.push(
      "instr(lower(coalesce(vendor,'')||' '||coalesce(filename,'')||' '||coalesce(invoice_number,'')||' '||coalesce(client,'')||' '||coalesce(sender,'')||' '||coalesce(subject,'')),?)>0",
    );
    binds.push(query.q.toLowerCase());
  }
  return { where: where.join(' AND '), binds };
}

// One page of rows after the cursor (PAGE_SIZE + 1, so the caller knows if there is more).
export async function allRows(env: Env, query: AllQuery): Promise<AllRow[]> {
  const { where, binds } = allWhere(query);
  const after = query.before ? ' AND (received_at,id)<(?,?)' : '';
  const cursor = query.before ? [query.before.at, query.before.id] : [];
  const sql = (held: boolean) =>
    `SELECT * FROM (${RECEIPTS}${held ? ` UNION ALL ${HELD}` : ''}) WHERE ${where}${after} ORDER BY received_at DESC,id DESC LIMIT ?`;
  try {
    return (
      await env.DB.prepare(sql(true))
        .bind(...binds, ...cursor, PAGE_SIZE + 1)
        .all<AllRow>()
    ).results;
  } catch (error) {
    // Before the inbound_mail migration: receipts only.
    if (!/inbound_mail/.test(String(error))) throw error;
    return (
      await env.DB.prepare(sql(false))
        .bind(...binds, ...cursor, PAGE_SIZE + 1)
        .all<AllRow>()
    ).results;
  }
}

// The receipt rows (never held mail) the filter matches, across pages: their
// count for the bulk bar, or up to `limit` ids for a bulk action on all of them.
export async function filterCount(env: Env, query: Omit<AllQuery, 'before'>): Promise<number> {
  const { where, binds } = allWhere(query);
  return (
    (await env.DB.prepare(`SELECT count(*) n FROM (${RECEIPTS}) WHERE ${where}`)
      .bind(...binds)
      .first<number>('n')) ?? 0
  );
}
export async function filterIds(env: Env, query: Omit<AllQuery, 'before'>, limit: number): Promise<string[]> {
  const { where, binds } = allWhere(query);
  return (
    await env.DB.prepare(`SELECT id FROM (${RECEIPTS}) WHERE ${where} ORDER BY received_at DESC,id DESC LIMIT ?`)
      .bind(...binds, limit)
      .all<{ id: string }>()
  ).results.map((r) => r.id);
}

export function chipOf(row: AllRow): { label: string; css: string } {
  if (row.type === 'mail') return { label: 'Unknown sender', css: 'needs' };
  if (row.discarded_at)
    return { label: row.discard_reason ? DISCARD_REASONS[row.discard_reason] : 'Discarded', css: 'muted' };
  if (row.duplicate_of) return { label: 'Duplicate', css: 'muted' };
  if (row.status === 'pending' || row.status === 'processing') return { label: STATUS.reading, css: 'muted' };
  if (needsReview(row)) return { label: STATUS.needs, css: 'needs' };
  return { label: STATUS.ready, css: 'ready' };
}
function rowName(row: AllRow): string {
  if (row.type === 'mail') return row.sender ?? 'Unknown sender';
  return row.kind === 'sales' ? invoiceName(row) : (row.vendor ?? row.filename ?? 'Receipt');
}

export function parseQuery(params: URLSearchParams): AllQuery {
  const show = params.get('show') ?? '';
  const month = params.get('month') ?? '';
  requireInput(!month || /^\d{4}-(0[1-9]|1[0-2])$/.test(month), 'Choose a month like 2026-10');
  const before = (params.get('before') ?? '').match(CURSOR);
  return {
    show: Object.hasOwn(SHOW, show) ? (show as Show) : null,
    month: month || null,
    q: (params.get('q') ?? '').trim().slice(0, 100),
    before: before ? { at: before[1]!, id: before[2]! } : null,
  };
}
function path(query: AllQuery, change: Partial<AllQuery>): string {
  const next = { ...query, before: null, ...change };
  const params = new URLSearchParams({ view: 'all' });
  if (next.show) params.set('show', next.show);
  if (next.month) params.set('month', next.month);
  if (next.q) params.set('q', next.q);
  if (next.before) params.set('before', `${next.before.at}_${next.before.id}`);
  return `/receipts?${params}`;
}
const link = (query: AllQuery, change: Partial<AllQuery>) => escape(path(query, change));

// The To do | All switch of Receipts, under the month the page has. All counts the archive the
// Receipts tab of All shows.
export async function receiptsSwitch(env: Env, month: string | null, view: View): Promise<string> {
  const state: ListState = { ...RECEIPTS_TODO, month };
  const [todo, all] = await Promise.all([
    openCount(env, LIST_DEFS.receipts!, state).then((c) => c.total),
    filterCount(env, { show: null, month, q: '' }),
  ]);
  return viewSwitch((v) => listUrl({ ...state, view: v }), { todo, all }, view);
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
  return `<li id="mail-${escape(m.id)}"><p class="who"><b>${who}</b></p><p class="subj">${m.subject ? escape(m.subject) : '<span class="muted">(no subject)</span>'}</p><div class="btns"><form method="post" action="/senders/approve">${fields}<button class="btn secondary" aria-label="Allow ${who}">Allow</button></form><details class="more"><summary aria-label="Ignore ${who}">Ignore</summary><div class="body"><form method="post" action="/senders/ignore">${fields}<p class="ask">Delete the waiting mail from ${who}, and only log what they send later?</p><button class="btn secondary">Ignore and delete</button></form></div></details></div></li>`;
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
  const items = rows
    .map((r) => {
      const name = receiptName(r);
      const sales = r.kind === 'sales';
      const overdue = sales && !needsReview(r);
      const amt = `<span class="amt">${r.total_minor === null ? '' : amount(r.total_minor, r.currency)}</span>`;
      const invoice = sales ? `${tag('Invoice')} ` : '';
      const note = overdue
        ? `<span class="ok">${invoice}<span class="stamp missing">Overdue</span> ${escape(shortDay(dueOn(r, terms) ?? r.issue_date!))}</span><details class="more"><summary aria-label="Mark ${escape(name)} paid">Mark paid</summary><div class="body"><form method="post" action="/receipts/${r.id}/paid">${fields}<label>Paid on<input type="date" name="paid_outside_on" value="${iso()}" required></label><label>How<input name="paid_outside_note" maxlength="300" required placeholder="Stripe payout 14 Oct"></label><button class="btn secondary">Mark paid</button></form></div></details>`
        : `<span class="why" title="${escape(firstFlag(r))}">${invoice}${escape(reasonWord(r))}</span>`;
      return `<li data-row="${r.id}" id="row-${r.id}">${bulkCheck(bulk, r.id, name)}<a href="${escape(receiptUrl(r.id, state))}">${escape(name)}</a>${amt}${note}</li>`;
    })
    .join('');
  const everything = total + heldTotal;
  const left = total - rows.length;
  const more =
    left > 0 && state.upto < BULK_CAP
      ? `<p><a class="btn secondary" href="${escape(listUrl({ ...state, upto: Math.min(state.upto + BANK_UPTO, BULK_CAP) }))}">Show ${Math.min(left, BANK_UPTO)} more</a></p>`
      : '';
  const mail = held.length
    ? `<section class="held" id="unknown" aria-labelledby="unknown-h"><h2 id="unknown-h">Unknown senders (${heldTotal})</h2><ul class="list">${held.map((m) => heldRow(m, listUrl(state))).join('')}</ul></section>`
    : '';
  const list = `<div data-list="receipts-todo" data-total="${total}"${rows.length ? ` data-bulk-list="${bulk.form}"` : ''}>${
    rows.length
      ? `${bulkTools(bulk, rows.length)}<ul class="list checks">${items}</ul>`
      : everything
        ? ''
        : emptyState(
            'Nothing to do.',
            `<a class="btn primary" href="${escape(listUrl({ ...state, view: 'all' }))}">See receipts</a>`,
          )
  }</div>${rows.length ? `${bulkBar(bulk)}${more}` : ''}`;
  const merge = merges.length
    ? `<div class="tools"><form class="merge" action="/receipts/merge" method="post">${fields}<button class="btn secondary">Merge ${plural(merges.length, 'duplicate')}</button></form></div>`
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
    ? `<a class="btn primary" href="${escape(receiptUrl(rows[0].id, state))}">Start checking (${total})</a>`
    : '';
  return page(
    'receipts',
    `${switcher}${month}${merge}${reading ? `<p class="banner" role="status">${reading} being read</p>` : ''}${head}${mail}${list}`,
    200,
    env,
    { head: pageHead('Receipts', start) },
  );
}

// Receipts All: the archive, newest first, a page at a time behind an Older cursor.
export async function allReceiptsPage(env: Env, params: URLSearchParams): Promise<Response> {
  const query = parseQuery(params);
  const [rows, tally, tabTotals, total, switcher] = await Promise.all([
    allRows(env, query),
    env.DB.prepare(
      "SELECT coalesce(sum(status IN ('pending','processing') AND duplicate_of IS NULL AND discarded_at IS NULL),0) AS reading, coalesce(sum(duplicate_of IS NOT NULL AND discarded_at IS NULL),0) AS duplicate, coalesce(sum(discarded_at IS NOT NULL),0) AS discarded FROM receipts",
    ).first<Record<'reading' | 'duplicate' | 'discarded', number>>(),
    tabCounts(env, query.month),
    filterCount(env, query),
    receiptsSwitch(env, query.month, 'all'),
  ]);
  const more = rows.length > PAGE_SIZE;
  const shown = rows.slice(0, PAGE_SIZE);
  const filtered = !!(query.show || query.q);
  const chipList = chipRow('Show', [
    { href: link(query, { show: null }), label: 'All', current: !query.show },
    ...CHIPS.map((k) => ({
      href: link(query, { show: k }),
      label: SHOW[k],
      count: tally?.[k] ?? 0,
      current: k === query.show,
    })),
  ]);
  const chips = chipList
    ? `<details class="filters"${query.show && (CHIPS as readonly string[]).includes(query.show) ? ' open' : ''}><summary>More filters</summary><div class="body">${chipList}</div></details>`
    : '';
  const find = `<form class="find" method="get" action="/receipts" role="search"><input type="hidden" name="view" value="all"><input name="q" type="search" value="${escape(query.q)}" aria-label="Search" placeholder="Seller or client" maxlength="100"><button class="btn secondary">Search</button>${query.q ? `<a class="linkbtn" href="${link(query, { q: '' })}">Clear</a>` : ''}</form>`;
  // The list as actions return to it: the filter and search, never the page.
  const state: ListState = { ...RECEIPTS_TODO, view: 'all', show: query.show, month: query.month, q: query.q };
  const bulk: BulkList = {
    form: 'bulk-receipts',
    action: '/receipts/bulk',
    noun: ['receipt', 'receipts'],
    total,
    scope: listParams(state),
    actions:
      query.show === 'discarded'
        ? [RECEIPT_ACTIONS.restore]
        : [
            RECEIPT_ACTIONS.discard,
            RECEIPT_ACTIONS.retry,
            RECEIPT_ACTIONS.kind(query.show === 'sales' ? 'sales' : 'expense'),
          ],
  };
  const picks = shown.filter((r) => r.type === 'receipt').length;
  const ul = `<ul class="list all">${shown
    .map((r) => {
      const chip = chipOf(r);
      const href = escape(r.type === 'mail' ? `${listUrl(RECEIPTS_TODO)}#mail-${r.id}` : receiptUrl(r.id, state));
      const status =
        chip.css === 'needs'
          ? `<span class="stamp needs">${chip.label}</span> `
          : chip.css === 'muted'
            ? `${tag(chip.label)} `
            : '';
      const date = r.type === 'mail' ? '' : r.issue_date ? escape(shortDay(r.issue_date)) : 'Undated';
      return `<li>${r.type === 'receipt' ? bulkCheck(bulk, r.id, rowName(r)) : ''}<a href="${href}">${escape(rowName(r))}</a><span class="amt">${r.type === 'mail' || r.total_minor === null ? '' : amount(r.total_minor, r.currency)}</span><span class="ok">${status}${date}</span>${r.discarded_at ? restoreForm(r.id, listUrl(state)) : ''}</li>`;
    })
    .join('')}</ul>`;
  const last = shown[shown.length - 1];
  const pages =
    query.before || more
      ? `<nav class="btns" aria-label="Pages">${query.before ? `<a class="btn secondary" href="${link(query, { before: null })}">Newest</a>` : ''}${more && last ? `<a class="btn secondary" href="${link(query, { before: { at: last.received_at, id: last.id } })}">Older</a>` : ''}</nav>`
      : '';
  const all = listUrl({ ...state, show: null, q: '', month: null });
  const list = shown.length
    ? `${picks ? `<div data-bulk-list="${bulk.form}">${bulkTools(bulk, picks)}${ul}</div>${bulkBar(bulk)}` : ul}${pages}`
    : query.q
      ? emptyState(
          `Nothing matches &#8220;${escape(query.q)}&#8221;.`,
          `<a class="btn primary" href="${link(query, { q: '' })}">Clear search</a>`,
        )
      : query.show === 'discarded'
        ? emptyState('Nothing discarded.', `<a class="btn primary" href="${escape(all)}">Show all</a>`)
        : filtered || query.before
          ? emptyState('Nothing here.', `<a class="btn primary" href="${escape(all)}">Show all</a>`)
          : query.month
            ? emptyState(`Nothing dated ${escape(monthName(query.month, false))}.`, addButton('all', true))
            : emptyState(
                config(env).receiptAddress
                  ? `No receipts yet. Forward to <code>${escape(config(env).receiptAddress)}</code>.`
                  : 'No receipts yet.',
                addButton('all', true),
              );
  const add = shown.length ? addButton('all', true) : '';
  const tabs = receiptsTabs(tabTotals, 'all', query.month);
  return page(
    'receipts',
    `${switcher}${tabs}${chips}${find}<div data-list="receipts-all" data-total="${total}">${list}</div>`,
    200,
    env,
    {
      detail: query.month ? monthName(query.month) : undefined,
      head: query.month ? monthHead('/receipts?view=all', query.month, add) : pageHead('Receipts', add),
    },
  );
}
