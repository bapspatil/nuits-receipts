// All receipts: every receipt and sales invoice plus unknown-sender mail,
// newest first, and the Unknown senders block that Review shows.
import type { Env } from './env';
import { config } from './config';
import { requireInput } from './domain';
import { invoiceName } from './invoices';
import { recentMail, type MailRow } from './inbound';
import { amount, day, emptyState, escape, page, pageHead, plural, uploadForm } from './ui';

export const PAGE_SIZE = 50;
export const SHOW = {
  ready: 'Ready',
  needs: 'Needs you',
  reading: 'Being read',
  duplicate: 'Duplicate',
  sales: 'Sales invoices',
  unknown: 'Unknown sender',
} as const;
export type Show = keyof typeof SHOW;
export type AllRow = {
  type: 'receipt' | 'mail';
  id: string;
  received_at: string;
  kind: string | null;
  status: string;
  duplicate_of: string | null;
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
  ready: "type='receipt' AND status='ready' AND duplicate_of IS NULL",
  needs: "type='receipt' AND status='needs_review' AND duplicate_of IS NULL",
  reading: "type='receipt' AND status IN ('pending','processing') AND duplicate_of IS NULL",
  duplicate: "type='receipt' AND duplicate_of IS NOT NULL",
  sales: "type='receipt' AND kind='sales'",
  unknown: "type='mail'",
};
const RECEIPTS = `SELECT 'receipt' AS type,id,received_at,kind,status,duplicate_of,vendor,filename,client,invoice_number,total_minor,currency,issue_date,NULL AS sender,NULL AS subject FROM receipts`;
const HELD = `SELECT 'mail',id,received_at,NULL,'held',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,sender,subject FROM inbound_mail WHERE state='held'`;

export type AllQuery = { show: Show | null; month: string | null; q: string; offset: number };

// One page of rows (PAGE_SIZE + 1, so the caller knows if there is more).
export async function allRows(env: Env, query: AllQuery): Promise<AllRow[]> {
  const where: string[] = [],
    binds: unknown[] = [];
  if (query.show) where.push(WHERE[query.show]);
  if (query.month) {
    where.push('substr(received_at,1,7)=?');
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
  if (row.duplicate_of) return { label: 'Duplicate', css: 'muted' };
  if (row.status === 'pending' || row.status === 'processing') return { label: 'Being read', css: 'muted' };
  if (row.status === 'needs_review') return { label: 'Needs you', css: 'needs' };
  return { label: 'Ready', css: 'ready' };
}
function rowName(row: AllRow): string {
  if (row.type === 'mail') return row.sender ?? 'Unknown sender';
  return row.kind === 'sales' ? invoiceName(row) : (row.vendor ?? row.filename ?? 'Receipt');
}

const REASONS: Record<string, string> = {
  allowed: 'Read',
  sender_approved: 'Read after you approved the sender',
  sender_not_allowed: 'Unknown sender, waiting in Review',
  sender_ignored: 'Ignored sender, not kept',
  sender_auth_failed: 'Failed sender checks, not kept',
  sender_unverified: 'Sender not verified',
  email_too_large: 'Too large, not kept',
  held_limit: 'Too many waiting, not kept',
  duplicate: 'Already received',
  deleted: 'Deleted',
  original_missing: 'Original missing',
};
export function reasonLabel(row: Pick<MailRow, 'reason' | 'state'>): string {
  if (row.reason === 'sender_unverified')
    return row.state === 'imported' ? 'Kept for review, sender not verified' : 'Sender not verified, not kept';
  return REASONS[row.reason] ?? row.reason;
}
// "24 Oct, 08:23" in the app's time zone (the same one the reader uses).
export function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return escape(iso);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Helsinki',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')} ${part('month')}, ${part('hour')}:${part('minute')}`;
}
function age(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

// What an approve, ignore or delete did. Shown on the page it returns to.
export function senderBanner(params: URLSearchParams): string {
  const n = (key: string) => {
    const value = Number(params.get(key));
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  };
  let text = '';
  if (params.has('approved')) {
    const count = n('approved');
    text = `Sender approved. ${count ? `${plural(count, 'email is', 'emails are')} being read now.` : 'Their next email goes straight in.'}`;
  } else if (params.has('ignored')) {
    const count = n('ignored');
    text = `Sender ignored. ${count ? `${plural(count, 'waiting email')} deleted. ` : ''}Their mail won't be kept.`;
  } else if (params.get('deleted') === '1') text = 'Email deleted.';
  else if (params.get('senders') === 'removed') text = 'Sender removed. Their next email waits in Review.';
  else if (params.get('senders') === 'unignored') text = 'Sender no longer ignored. Their next email waits in Review.';
  return text ? `<p class="banner" role="status">${escape(text)}</p>` : '';
}

// The Unknown senders block. back: where the forms return to.
export function heldSection(rows: readonly MailRow[], back: 'review' | 'receipts' = 'review'): string {
  if (!rows.length) return '';
  const form = (action: string, fields: Record<string, string>, button: string) =>
    `<form method="post" action="${action}">${Object.entries(fields)
      .map(([k, v]) => `<input type="hidden" name="${k}" value="${escape(v)}">`)
      .join('')}<input type="hidden" name="back" value="${back}">${button}</form>`;
  const items = rows
    .map((r) => {
      const to = r.to_address ? `To ${escape(r.to_address)}` : '';
      const files = r.attachments ? plural(r.attachments, 'attachment') : 'No attachments';
      return `<li class="card" id="mail-${escape(r.id)}"><p class="who"><b>${escape(r.sender)}</b><span class="stamp needs">Unknown sender</span></p><p class="subj">${r.subject ? escape(r.subject) : '<span class="muted">(no subject)</span>'}</p><p class="ok">${[to, files, `arrived ${age(r.received_at)}`].filter(Boolean).join(' · ')}</p><div class="btns">${form(
        '/senders/approve',
        { address: r.sender },
        '<button class="btn primary">Approve sender</button>',
      )}${form('/senders/ignore', { address: r.sender }, '<button class="btn secondary">Ignore sender</button>')}${form(
        '/senders/delete',
        { id: r.id },
        '<button class="linkbtn">Delete</button>',
      )}</div></li>`;
    })
    .join('');
  return `<section class="held" id="unknown" aria-labelledby="unknown-h"><h2 id="unknown-h">Unknown senders <span class="muted">(${rows.length})</span></h2><p class="hint">Mail from addresses not on your list. Nothing is read until you approve the sender. Approving reads this email and any others waiting from them.</p><ul>${items}</ul></section>`;
}

export function recentSection(rows: readonly MailRow[]): string {
  if (!rows.length) return '';
  return `<section class="recent" aria-labelledby="recent-h"><h2 id="recent-h">Recent mail</h2><p class="hint">The last ${rows.length === 1 ? 'email' : `${rows.length} emails`} sent to your address, and what happened to each.</p><ul class="list">${rows
    .map(
      (r) =>
        `<li><span class="who">${escape(r.sender)}</span><span class="amt">${when(r.received_at)}</span><span class="ok">${escape(reasonLabel(r))}${r.subject ? ` · ${escape(r.subject)}` : ''}</span></li>`,
    )
    .join('')}</ul></section>`;
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
  const filtered = !!(query.show || query.month || query.q);
  const chip = (key: Show | null, label: string) =>
    `<li><a href="${link(query, { show: key })}"${key === query.show ? ' aria-current="page"' : ''}>${escape(label)}</a></li>`;
  const chips = `<ul class="chips" aria-label="Show">${chip(null, 'All')}${(Object.keys(SHOW) as Show[]).map((k) => chip(k, SHOW[k])).join('')}</ul>`;
  const find = `<form class="find" method="get" action="/receipts" role="search">${query.show ? `<input type="hidden" name="show" value="${query.show}">` : ''}<label class="q">Search<input name="q" type="search" value="${escape(query.q)}" placeholder="Vendor, client or sender" maxlength="100"></label><label class="m">Month received<input name="month" type="month" value="${escape(query.month ?? '')}"></label><button class="btn secondary">Show</button>${filtered ? `<a class="linkbtn" href="/receipts">Clear</a>` : ''}</form>`;
  const list = shown.length
    ? `<ul class="list all">${shown
        .map((r) => {
          const chip = chipOf(r);
          const href = r.type === 'mail' ? `/review#mail-${escape(r.id)}` : `/receipts/${escape(r.id)}`;
          const extra =
            r.type === 'mail'
              ? r.subject
                ? escape(r.subject)
                : '(no subject)'
              : r.issue_date
                ? `dated ${escape(day(r.issue_date))}`
                : 'No date';
          return `<li><a href="${href}">${escape(rowName(r))}</a><span class="amt">${r.type === 'mail' ? '' : amount(r.total_minor, r.currency)}</span><span class="ok"><span class="stamp ${chip.css}">${chip.label}</span>${r.kind === 'sales' ? ' <span class="stamp muted">Sales invoice</span>' : ''} Received ${day(r.received_at)} · ${extra}</span></li>`;
        })
        .join('')}</ul>${
        query.offset || more
          ? `<nav class="btns" aria-label="Pages">${query.offset ? `<a class="btn secondary" href="${link(query, { offset: Math.max(0, query.offset - PAGE_SIZE) })}">Newer</a>` : ''}${more ? `<a class="btn secondary" href="${link(query, { offset: query.offset + PAGE_SIZE })}">Older</a>` : ''}</nav>`
          : ''
      }`
    : filtered || query.offset
      ? emptyState(
          'Nothing matches.',
          'Try another month or search.',
          '<a class="btn primary" href="/receipts">Show everything</a>',
        )
      : emptyState(
          'No receipts yet.',
          config(env).receiptAddress
            ? `Forward receipts to <code>${escape(config(env).receiptAddress)}</code> or upload one.`
            : 'Upload a receipt to start.',
          uploadForm(config(env).receiptAddress, true),
        );
  const recent = query.offset ? '' : recentSection(await recentMail(env));
  return page('All receipts', `${senderBanner(params)}${chips}${find}${list}${recent}`, 200, env, {
    nav: 'receipts',
    head: pageHead('All receipts', {
      kicker: 'Receipts',
      sub: 'Every receipt and invoice, newest first.',
    }),
  });
}
