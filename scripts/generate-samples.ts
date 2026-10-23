import { URL } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PNG } from 'pngjs';
import { writeFile, mkdir } from 'node:fs/promises';

const directory = new URL('./sample-receipts/', import.meta.url);
await mkdir(directory, { recursive: true });
const fixtures = [
  {
    file: 'sample.pdf',
    vendor: 'Sample Cloud Lantern Oy',
    invoice_number: 'SAMPLE-1001',
    issue_date: '2026-09-04',
    due_date: '2026-09-18',
    currency: 'EUR',
    net: '100.00',
    vat_rate: '25.5',
    vat_amount: '25.50',
    total: '125.50',
  },
  {
    file: 'sample.png',
    vendor: 'Sample Pixel Harbor Ltd',
    invoice_number: 'SAMPLE-1002',
    issue_date: '2026-09-05',
    due_date: '2026-09-19',
    currency: 'USD',
    net: '20.00',
    vat_rate: '0',
    vat_amount: '0.00',
    total: '20.00',
  },
  {
    file: 'sample.html',
    vendor: 'Sample Mail Meadow Oy',
    invoice_number: 'SAMPLE-1003',
    issue_date: '2026-09-06',
    due_date: '2026-09-20',
    currency: 'EUR',
    net: '40.00',
    vat_rate: '25.5',
    vat_amount: '10.20',
    total: '50.20',
  },
];
function lines(f: (typeof fixtures)[number]) {
  return [
    'SYNTHETIC SAMPLE - NOT A REAL INVOICE',
    ...Object.entries(f)
      .filter(([k]) => k !== 'file')
      .map(([k, v]) => `${k}: ${v}`),
    'line_items: Sample subscription for testing only',
  ];
}
const pdf = await PDFDocument.create();
pdf.setCreationDate(new Date('2026-09-01T00:00:00Z'));
pdf.setModificationDate(new Date('2026-09-01T00:00:00Z'));
const page = pdf.addPage([595, 842]),
  font = await pdf.embedFont(StandardFonts.Helvetica);
lines(fixtures[0]!).forEach((line, i) => page.drawText(line, { x: 45, y: 780 - i * 27, size: 12, font }));
await writeFile(new URL('sample.pdf', directory), await pdf.save());
const image = new PNG({ width: 900, height: 520 });
image.data.fill(255);
// A local bitmap font keeps the sample image reproducible without a renderer or AI.
const glyphs: Record<string, string> = {
  A: '01110100011000111111100011000110001',
  B: '11110100011000111110100011000111110',
  C: '01111100001000010000100001000001111',
  D: '11110100011000110001100011000111110',
  E: '11111100001000011110100001000011111',
  F: '11111100001000011110100001000010000',
  G: '01111100001000010111100011000101111',
  H: '10001100011000111111100011000110001',
  I: '11111001000010000100001000010011111',
  J: '00111000100001000010000101001001100',
  K: '10001100101010011000101001001010001',
  L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001',
  N: '10001110011010110011100011000110001',
  O: '01110100011000110001100011000101110',
  P: '11110100011000111110100001000010000',
  Q: '01110100011000110001101011001001101',
  R: '11110100011000111110101001001010001',
  S: '01111100001000001110000010000111110',
  T: '11111001000010000100001000010000100',
  U: '10001100011000110001100011000101110',
  V: '10001100011000110001100010101000100',
  W: '10001100011000110101101011101110001',
  X: '10001100010101000100010101000110001',
  Y: '10001100010101000100001000010000100',
  Z: '11111000010001000100010001000011111',
  '0': '01110100011001110101110011000101110',
  '1': '00100011000010000100001000010001110',
  '2': '01110100010000100010001000100011111',
  '3': '11110000010000101110000010000111110',
  '4': '00010001100101010010111110001000010',
  '5': '11111100001000011110000010000111110',
  '6': '01110100001000011110100011000101110',
  '7': '11111000010001000100010000100001000',
  '8': '01110100011000101110100011000101110',
  '9': '01110100011000101111000010000101110',
  ':': '00000001000010000000001000010000000',
  '-': '00000000000000011111000000000000000',
  '.': '00000000000000000000000000010000100',
  _: '00000000000000000000000000000011111',
  ' ': '00000000000000000000000000000000000',
};
lines(fixtures[1]!).forEach((line, row) =>
  [...line.toUpperCase()].forEach((character, column) => {
    const glyph = glyphs[character] ?? glyphs[' ']!;
    [...glyph].forEach((pixel, n) => {
      if (pixel === '1')
        for (let y = 0; y < 2; y++)
          for (let x = 0; x < 2; x++) {
            const offset = ((25 + row * 34 + Math.floor(n / 5) * 2 + y) * 900 + 24 + column * 12 + (n % 5) * 2 + x) * 4;
            image.data[offset] = 25;
            image.data[offset + 1] = 35;
            image.data[offset + 2] = 48;
          }
    });
  }),
);
await writeFile(new URL('sample.png', directory), PNG.sync.write(image));
await writeFile(
  new URL('sample.html', directory),
  '<!doctype html><html><body>' +
    lines(fixtures[2]!)
      .map((line) => `<p>${line}</p>`)
      .join('\n') +
    '</body></html>\n',
);
await writeFile(
  new URL('ground-truth.json', directory),
  JSON.stringify({ synthetic: true, receipts: fixtures }, null, 2) + '\n',
);
await writeFile(
  new URL('bank.csv', directory),
  'Transaction ID;Booking date;Amount;Currency;Payee;Reference\nSAMPLE-BANK-1;2026-09-07;-125,50;EUR;Sample Cloud Lantern Oy;SAMPLE-1001\nSAMPLE-BANK-2;2026-09-08;-9,99;EUR;Sample Missing Vendor;No receipt\n',
);
const testDirectory = new URL('../test/fixtures/', import.meta.url);
await mkdir(testDirectory, { recursive: true });
for (const [name, pages] of [
  ['blank.pdf', 1],
  ['too-many-pages.pdf', 26],
] as const) {
  const document = await PDFDocument.create();
  document.setCreationDate(new Date('2026-09-01T00:00:00Z'));
  document.setModificationDate(new Date('2026-09-01T00:00:00Z'));
  for (let n = 0; n < pages; n++) document.addPage([595, 842]);
  await writeFile(new URL(name, testDirectory), await document.save());
}
