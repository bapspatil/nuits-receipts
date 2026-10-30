// One busy month of data for the list harness. test/busy-month.ts seeds it
// into the vitest database (the bank rows through importBankCsv) and
// busySql() renders the same shape as SQL for the journeys, so the invariant
// tests and journey f look at the same kind of month. Every name is invented.
import { hasTodoReason } from '../src/flags.ts';

const pad = (n, width = 2) => String(n).padStart(width, '0');
export const hex64 = (prefix, n) => (prefix + n.toString(16)).padStart(64, '0');

export const READY = 110;
export const NEEDS_REVIEW = 40;
export const BANK_ROWS = 220;
// CSV rows that form the two own-account transfer pairs: [debit, credit].
export const TRANSFER_ROWS = [
  [10, 11],
  [120, 121],
];
// Positions among the 40 needing review.
export const UNDATED = [3, 9, 15, 21, 27, 33];
export const SALES = [4, 12, 20, 28, 36];
// Three complete receipts dated the month before, so a month filter on To do cuts a list the
// global order does not (approving the last of them has a different next item without it).
export const EARLIER = [5, 13, 29];
export const earlierMonth = (month) => {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
};

// Reasons by position among the 40 needing review. Required ones ask for a fact
// Approve refuses without; the rest are notes.
const REASONS = [
  ['missing_vendor'],
  ['missing_total'],
  ['missing_invoice_number'],
  ['uncertain_product'],
  ['missing_eur'],
  ['vat_mismatch'],
  ['sender_unverified'],
  ['missing_net', 'missing_invoice_number'],
];

export function busyReceipts(month) {
  const rows = [];
  for (let n = 1; n <= READY + NEEDS_REVIEW; n++) {
    const review = n > READY,
      j = n - READY - 1;
    const sales = review && SALES.includes(j);
    const reasons = !review
      ? []
      : UNDATED.includes(j)
        ? ['missing_issue_date']
        : sales
          ? j === 4 || j === 20 || j === 36
            ? ['missing_client']
            : ['missing_invoice_number']
          : REASONS[j % 8];
    const day = pad(1 + (n % 28));
    const earlier = review && EARLIER.includes(j);
    const issued = earlier ? `${earlierMonth(month)}-${pad(5 + EARLIER.indexOf(j) * 5)}` : `${month}-${day}`;
    const net = (sales ? 90000 : 2000) + n * 37,
      vat = Math.round(net * 0.255);
    rows.push({
      id: hex64('a', n),
      original_key: `receipts/${hex64('a', n)}`,
      filename: `busy-${n}.pdf`,
      media_type: 'application/pdf',
      source: 'upload',
      received_at: `${month}-${day}T10:${pad(n % 60)}:00Z`,
      status: review ? 'needs_review' : 'ready',
      kind: sales ? 'sales' : 'expense',
      vendor: reasons.includes('missing_vendor') ? null : sales ? 'Busy Studio Oy' : `Acme Supply ${n}`,
      client: sales && !reasons.includes('missing_client') ? `Client ${n}` : null,
      invoice_number: reasons.includes('missing_invoice_number') ? null : `BM-${n}`,
      issue_date: reasons.includes('missing_issue_date') ? null : issued,
      currency: 'EUR',
      total_minor: reasons.includes('missing_total')
        ? null
        : reasons.includes('vat_mismatch')
          ? net + vat + 100
          : net + vat,
      net_minor: reasons.includes('missing_net') ? null : net,
      vat_minor: vat,
      vat_rate_bps: 2550,
      review_reasons_json: JSON.stringify(reasons),
    });
  }
  return rows;
}

// Flagged for a reason that keeps it in To do, by the app's own rule.
export const isTodo = (r) => r.status === 'needs_review' && hasTodoReason(JSON.parse(r.review_reasons_json));

// Facts all there, so Approve accepts it.
export const isComplete = (r) =>
  !!r.vendor &&
  !!r.issue_date &&
  r.total_minor !== null &&
  r.net_minor !== null &&
  r.vat_minor !== null &&
  (r.kind !== 'sales' || !!r.client);

export function busyMail(month) {
  return [1, 2, 3].map((n) => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    received_at: `${month}-2${n}T08:00:00Z`,
    sender: `billing${n}@unknown-shop.example`,
    envelope: `billing${n}@unknown-shop.example`,
    to_address: 'receipts@example.com',
    subject: `Invoice ${n} from an unknown shop`,
    message_id: `<busy-${n}@unknown-shop.example>`,
    attachments: 1,
    size_bytes: 20000,
    email_key: null,
    state: 'held',
    reason: 'unknown_sender',
  }));
}

// 220 statement rows, about 7 a day over the month, in CSV order.
export function busyStatement(month) {
  const transfers = new Map(
    TRANSFER_ROWS.flatMap(([d, c], k) => [
      [d, -25000 - k * 16000],
      [c, 25000 + k * 16000],
    ]),
  );
  return Array.from({ length: BANK_ROWS }, (_, i) => ({
    ext: `BM-${i}`,
    date: `${month}-${pad(1 + Math.floor((i * 30) / BANK_ROWS))}`,
    amount_minor: transfers.get(i) ?? -(777 + i * 19),
    merchant: `Kiosk Zed ${i}`,
    reference: `ref ${i}`,
  }));
}
export const statementCsv = (rows) =>
  'Transaction ID;Date;Amount;Currency;Payee;Reference\n' +
  rows
    .map(
      (r) =>
        `${r.ext};${r.date};${(r.amount_minor / 100).toFixed(2).replace('.', ',')};EUR;${r.merchant};${r.reference}\n`,
    )
    .join('');

// Which bank row is open, resolved, matched or a transfer leg. idByIndex is the row ids in CSV
// order; sorted is the same ids in the list order (booking_date, account_key, id). 60 are
// missing, 35 of them after the 100th row of that order.
export function classifyBank(idByIndex, sorted) {
  const legs = new Set(TRANSFER_ROWS.flat().map((i) => idByIndex[i]));
  const pool = sorted.map((id, p) => ({ id, p })).filter((x) => !legs.has(x.id));
  const spread = (list, n) => Array.from({ length: n }, (_, k) => list[Math.floor((k * list.length) / n)].id);
  const missing = [
    ...spread(
      pool.filter((x) => x.p < 100),
      25,
    ),
    ...spread(
      pool.filter((x) => x.p >= 100),
      35,
    ),
  ];
  const open = new Set(missing);
  const rest = pool.filter((x) => !open.has(x.id));
  const matched = spread(rest, 20);
  const done = new Set(matched);
  const owner = rest.filter((x) => !done.has(x.id)).map((x) => x.id);
  const at = new Map(sorted.map((id, p) => [id, p]));
  return {
    missing: [...missing].sort((a, b) => at.get(a) - at.get(b)),
    matched: matched.map((id, k) => ({ id, receipt: hex64('a', k + 1) })),
    exempted: [...owner, ...legs],
    owner,
    transfers: TRANSFER_ROWS.map(([d, c]) => ({ debit: idByIndex[d], credit: idByIndex[c] })),
  };
}

const literal = (v) =>
  v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`;
const insert = (table, row) =>
  `INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.values(row).map(literal).join(',')});`;

// The same month as plain SQL, for `wrangler d1 execute`. Bank ids are made up, so the list
// order is computed here rather than read back.
export function busySql(month, accountId = 'busy-acct') {
  const statement = busyStatement(month);
  const ids = statement.map((_, i) => hex64('b', i));
  const sorted = statement
    .map((r, i) => ({ date: r.date, id: ids[i] }))
    .sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1))
    .map((x) => x.id);
  const kinds = classifyBank(ids, sorted);
  const matchedBy = new Map(kinds.matched.map((m) => [m.id, m.receipt]));
  const owner = new Set(kinds.owner);
  const legs = new Set(kinds.transfers.flatMap((t) => [t.debit, t.credit]));
  const importId = hex64('c', 1);
  const stamp = `${month}-28T12:00:00Z`;
  const lines = [
    insert('accounts', {
      id: accountId,
      label: 'Busy account',
      bank_name: 'Synthetic bank',
      default_currency: 'EUR',
      is_default: 0,
      created_at: stamp,
    }),
    insert('imports', {
      id: importId,
      account_key: accountId,
      original_key: `imports/busy-${month}.csv`,
      status: 'complete',
      row_count: BANK_ROWS,
      imported_at: stamp,
      snapshot_json: '{}',
    }),
    ...busyReceipts(month).map((r) => insert('receipts', r)),
    ...busyMail(month).map((m) => insert('inbound_mail', m)),
    ...statement.map((r, i) =>
      insert('bank_transactions', {
        id: ids[i],
        account_key: accountId,
        external_id: r.ext,
        import_id: importId,
        booking_date: r.date,
        amount_minor: r.amount_minor,
        currency: 'EUR',
        merchant: r.merchant,
        reference: r.reference,
        raw_json: '{}',
        receipt_required: owner.has(ids[i]) || legs.has(ids[i]) ? 0 : 1,
        receipt_id: matchedBy.get(ids[i]) ?? null,
        match_method: matchedBy.has(ids[i]) ? 'manual' : null,
        matched_at: matchedBy.has(ids[i]) ? stamp : null,
        exempt_by: owner.has(ids[i]) ? 'owner' : legs.has(ids[i]) ? 'own' : null,
      }),
    ),
    ...kinds.transfers.map((t) =>
      insert('internal_transfers', {
        debit_id: t.debit,
        credit_id: t.credit,
        reason: 'Busy month',
        confirmed_at: stamp,
      }),
    ),
  ];
  return lines.join('\n') + '\n';
}
