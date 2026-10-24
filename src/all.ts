// All receipts: every receipt and sales invoice plus unknown-sender mail,
// newest first, and the Unknown senders block that Review shows.
import type { Env } from './env';
import { config } from './config';
import { STATUS } from './status';
import { DISCARD_REASONS, type DiscardReason, requireInput } from './domain';
import { restoreForm } from './discard';
import { invoiceName } from './invoices';
import type { MailRow } from './inbound';
import {
  amount,
  chipRow,
  emptyState,
  escape,
  monthHead,
  monthName,
  more,
  navCounts,
  tabCounts,
  addButton,
  page,
  pageHead,
  shortDay,
  receiptsTabs,
  tag,
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
// segment, and Needs you and Unknown sender are Review's: all still filter
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
};
const WHERE: Record<Show, string> = {
  ready: "type='receipt' AND status='ready' AND duplicate_of IS NULL AND discarded_at IS NULL",
  needs: "type='receipt' AND status='needs_review' AND duplicate_of IS NULL AND discarded_at IS NULL",
  reading: "type='receipt' AND status IN ('pending','processing') AND duplicate_of IS NULL AND discarded_at IS NULL",
  duplicate: "type='receipt' AND duplicate_of IS NOT NULL AND discarded_at IS NULL",
  discarded: "type='receipt' AND discarded_at IS NOT NULL",
  sales: "type='receipt' AND kind='sales' AND discarded_at IS NULL",
  unknown: "type='mail'",
};
const RECEIPTS = `SELECT 'receipt' AS type,id,received_at,kind,status,duplicate_of,discarded_at,discard_reason,vendor,filename,client,invoice_number,total_minor,currency,issue_date,NULL AS sender,NULL AS subject FROM receipts`;
const HELD = `SELECT 'mail',id,received_at,NULL,'held',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,sender,subject FROM inbound_mail WHERE state='held'`;

export type AllQuery = { show: Show | null; month: string | null; q: string; offset: number };

// One page of rows (PAGE_SIZE + 1, so the caller knows if there is more).
export async function allRows(env: Env, query: AllQuery): Promise<AllRow[]> {
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
    where.push(
      "lower(coalesce(vendor,'')||' '||coalesce(filename,'')||' '||coalesce(invoice_number,'')||' '||coalesce(client,'')||' '||coalesce(sender,'')||' '||coalesce(subject,'')) LIKE ? ESCAPE '\\'",
    );
    binds.push(`%${query.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  const sql = (held: boolean) =>
    `SELECT * FROM (${RECEIPTS}${held ? ` UNION ALL ${HELD}` : ''})${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY received_at DESC,id DESC LIMIT ? OFFSET ?`;
  try {
    return (
      await env.DB.prepare(sql(true))
        .bind(...binds, PAGE_SIZE + 1, query.offset)
        .all<AllRow>()
    ).results;
  } catch (error) {
    // Before the inbound_mail migration: receipts only.
    if (!/inbound_mail/.test(String(error))) throw error;
    return (
      await env.DB.prepare(sql(false))
        .bind(...binds, PAGE_SIZE + 1, query.offset)
        .all<AllRow>()
    ).results;
  }
}

export function chipOf(row: AllRow): { label: string; css: string } {
  if (row.type === 'mail') return { label: 'Unknown sender', css: 'needs' };
  if (row.discarded_at)
    return { label: row.discard_reason ? DISCARD_REASONS[row.discard_reason] : 'Discarded', css: 'muted' };
  if (row.duplicate_of) return { label: 'Duplicate', css: 'muted' };
  if (row.status === 'pending' || row.status === 'processing') return { label: STATUS.reading, css: 'muted' };
  if (row.status === 'needs_review') return { label: STATUS.needs, css: 'needs' };
  return { label: STATUS.ready, css: 'ready' };
}
function rowName(row: AllRow): string {
  if (row.type === 'mail') return row.sender ?? 'Unknown sender';
  return row.kind === 'sales' ? invoiceName(row) : (row.vendor ?? row.filename ?? 'Receipt');
}

// The Unknown senders block. back: where the forms return to. primary: the
// first Allow is the screen's one primary (when nothing else is).
export function heldSection(rows: readonly MailRow[], back: 'review' | 'receipts' = 'review', primary = false): string {
  if (!rows.length) return '';
  const form = (action: string, fields: Record<string, string>, button: string) =>
    `<form method="post" action="${action}">${Object.entries(fields)
      .map(([k, v]) => `<input type="hidden" name="${k}" value="${escape(v)}">`)
      .join('')}<input type="hidden" name="back" value="${back}">${button}</form>`;
  const items = rows
    .map((r, i) => {
      const who = escape(r.sender);
      return `<li id="mail-${escape(r.id)}"><p class="who"><b>${who}</b></p><p class="subj">${r.subject ? escape(r.subject) : '<span class="muted">(no subject)</span>'}</p><div class="btns">${form(
        '/senders/approve',
        { address: r.sender },
        `<button class="btn ${primary && !i ? 'primary' : 'secondary'}" aria-label="Allow ${who}">Allow</button>`,
      )}${form('/senders/ignore', { address: r.sender }, `<button class="linkbtn" aria-label="Ignore ${who}">Ignore</button>`)}${more(
        form('/senders/delete', { id: r.id }, `<button class="linkbtn">Delete email</button>`),
        who,
      )}</div></li>`;
    })
    .join('');
  return `<section class="held" id="unknown" aria-labelledby="unknown-h"><h2 id="unknown-h">Unknown senders (${rows.length})</h2><ul class="list">${items}</ul></section>`;
}

function parseQuery(params: URLSearchParams, offset: number): AllQuery {
  const show = params.get('show') ?? '';
  const month = params.get('month') ?? '';
  requireInput(!month || /^\d{4}-(0[1-9]|1[0-2])$/.test(month), 'Choose a month like 2026-10');
  return {
    show: show in SHOW ? (show as Show) : null,
    month: month || null,
    q: (params.get('q') ?? '').trim().slice(0, 100),
    offset,
  };
}
function link(query: AllQuery, change: Partial<AllQuery>): string {
  const next = { ...query, offset: 0, ...change };
  const params = new URLSearchParams();
  if (next.show) params.set('show', next.show);
  if (next.month) params.set('month', next.month);
  if (next.q) params.set('q', next.q);
  if (next.offset) params.set('offset', String(next.offset));
  const text = params.toString();
  return `/receipts${text ? `?${escape(text)}` : ''}`;
}

export async function allReceiptsPage(env: Env, params: URLSearchParams, offset: number): Promise<Response> {
  const query = parseQuery(params, offset);
  const rows = await allRows(env, query);
  const more = rows.length > PAGE_SIZE;
  const shown = rows.slice(0, PAGE_SIZE);
  const filtered = !!(query.show || query.q);
  const tally = await env.DB.prepare(
    "SELECT coalesce(sum(status IN ('pending','processing') AND duplicate_of IS NULL AND discarded_at IS NULL),0) AS reading, coalesce(sum(duplicate_of IS NOT NULL AND discarded_at IS NULL),0) AS duplicate, coalesce(sum(discarded_at IS NOT NULL),0) AS discarded FROM receipts",
  ).first<Record<'reading' | 'duplicate' | 'discarded', number>>();
  const chips = chipRow('Show', [
    { href: link(query, { show: null }), label: 'All', current: !query.show },
    ...CHIPS.map((k) => ({
      href: link(query, { show: k }),
      label: SHOW[k],
      count: tally?.[k] ?? 0,
      current: k === query.show,
    })),
  ]);
  const find = `<form class="find" method="get" action="/receipts" role="search"><input name="q" type="search" value="${escape(query.q)}" aria-label="Search" placeholder="Seller or client" maxlength="100"><button class="btn secondary">Search</button>${query.q ? `<a class="linkbtn" href="${link(query, { q: '' })}">Clear</a>` : ''}</form>`;
  const list = shown.length
    ? `<ul class="list all">${shown
        .map((r) => {
          const chip = chipOf(r);
          const href = r.type === 'mail' ? `/review#mail-${escape(r.id)}` : `/receipts/${escape(r.id)}`;
          const status =
            chip.css === 'needs'
              ? `<span class="stamp needs">${chip.label}</span> `
              : chip.css === 'muted'
                ? `${tag(chip.label)} `
                : '';
          const date = r.type === 'mail' ? '' : r.issue_date ? escape(shortDay(r.issue_date)) : 'Undated';
          return `<li><a href="${href}">${escape(rowName(r))}</a><span class="amt">${r.type === 'mail' || r.total_minor === null ? '' : amount(r.total_minor, r.currency)}</span><span class="ok">${status}${date}</span>${r.discarded_at ? restoreForm(r.id, '/receipts') : ''}</li>`;
        })
        .join('')}</ul>${
        query.offset || more
          ? `<nav class="btns" aria-label="Pages">${query.offset ? `<a class="btn secondary" href="${link(query, { offset: Math.max(0, query.offset - PAGE_SIZE) })}">Newer</a>` : ''}${more ? `<a class="btn secondary" href="${link(query, { offset: query.offset + PAGE_SIZE })}">Older</a>` : ''}</nav>`
          : ''
      }`
    : query.q
      ? emptyState(
          `Nothing matches &#8220;${escape(query.q)}&#8221;.`,
          `<a class="btn primary" href="${link(query, { q: '' })}">Clear search</a>`,
        )
      : query.show === 'discarded'
        ? emptyState('Nothing discarded.', '<a class="btn primary" href="/receipts">Show all</a>')
        : filtered || query.offset
          ? emptyState('Nothing here.', '<a class="btn primary" href="/receipts">Show all</a>')
          : query.month
            ? emptyState(`Nothing dated ${escape(monthName(query.month, false))}.`, addButton('all', true))
            : emptyState(
                config(env).receiptAddress
                  ? `No receipts yet. Forward to <code>${escape(config(env).receiptAddress)}</code>.`
                  : 'No receipts yet.',
                addButton('all', true),
              );
  const counts = await navCounts(env);
  const waiting = counts.review
    ? `<p class="small waiting"><a href="/review">${counts.review} in Review ›</a></p>`
    : '';
  const add = shown.length ? addButton('all', true) : '';
  const tabs = receiptsTabs(await tabCounts(env, query.month), 'all', query.month);
  return page('receipts', `${tabs}${waiting}${chips}${find}${list}`, 200, env, {
    detail: query.month ? monthName(query.month) : undefined,
    head: query.month ? monthHead('/receipts', query.month, add) : pageHead('Receipts', add),
  });
}
