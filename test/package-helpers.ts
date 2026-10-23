import { env } from 'cloudflare:workers';
import { hash, type Receipt } from '../src/domain';
import { request } from './helpers';

// Synthetic receipts straight into D1 and R2, without the reader.
export async function seed(
  fields: Partial<Receipt> & { bytes?: Uint8Array | string },
  target: { DB: D1Database; ORIGINALS: R2Bucket } = env,
): Promise<Receipt> {
  const { bytes = `synthetic ${Math.random()}`, ...rest } = fields;
  const body = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const id = rest.id ?? (await hash(body));
  const row: Partial<Receipt> = {
    id,
    original_key: `receipts/${id}`,
    filename: 'synthetic.pdf',
    media_type: 'application/pdf',
    source: 'upload',
    received_at: '2026-10-20T10:00:00.000Z',
    status: 'ready',
    revision: 1,
    vendor: 'Synthetic Vendor',
    invoice_number: 'S-1',
    issue_date: '2026-10-05',
    currency: 'EUR',
    total_minor: 1250,
    net_minor: 1000,
    vat_minor: 250,
    vat_rate_bps: 2500,
    product: 'general' as Receipt['product'],
    expense_type: 'other',
    manual_fields_json: '{}',
    review_reasons_json: '[]',
    ...rest,
  };
  await target.ORIGINALS.put(row.original_key!, body, { httpMetadata: { contentType: row.media_type! } });
  const entries = Object.entries(row);
  await target.DB.prepare(
    `INSERT INTO receipts (${entries.map(([k]) => k).join(',')}) VALUES (${entries.map(() => '?').join(',')})`,
  )
    .bind(...entries.map(([, v]) => v ?? null))
    .run();
  return row as Receipt;
}

export async function missingPayment(month = '2026-10', merchant = 'Synthetic Shop', amount = -4200) {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO imports (id,account_key,original_key,status,row_count,imported_at,snapshot_json) VALUES ('synthetic-import','holvi','imports/synthetic','complete',1,'2026-10-21T00:00:00Z','{}')",
    ),
    env.DB.prepare(
      "INSERT INTO bank_transactions (id,account_key,import_id,booking_date,amount_minor,currency,merchant,raw_json) VALUES (?,'holvi','synthetic-import',?,?,'EUR',?,'{}')",
    ).bind(await hash(merchant + month), `${month}-09`, amount, merchant),
  ]);
}

export type ZipEntry = { name: string; data: Uint8Array; utf8: boolean; method: number; crc: number };

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// A small ZIP reader: end of central directory, then each central entry and
// its local header. Throws on anything inconsistent.
export function unzip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('no end of central directory');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('bad central header');
    const flags = view.getUint16(at + 8, true),
      method = view.getUint16(at + 10, true),
      crc = view.getUint32(at + 16, true),
      size = view.getUint32(at + 20, true),
      nameLength = view.getUint16(at + 28, true),
      extra = view.getUint16(at + 30, true),
      comment = view.getUint16(at + 32, true),
      local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error('bad local header');
    const localName = decoder.decode(bytes.subarray(local + 30, local + 30 + view.getUint16(local + 26, true)));
    if (localName !== name) throw new Error(`local name ${localName} != ${name}`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.slice(start, start + size);
    if (crc32(data) !== crc) throw new Error(`crc mismatch for ${name}`);
    entries.push({ name, data, utf8: (flags & 0x800) !== 0, method, crc });
    at += 46 + nameLength + extra + comment;
  }
  return entries;
}

export async function zipOf(path: string, target = request) {
  const response = await target(path);
  if (response.status !== 200) throw new Error(`${response.status}: ${await response.text()}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { response, bytes, entries: unzip(bytes) };
}
