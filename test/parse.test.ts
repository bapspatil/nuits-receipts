import { describe, expect, it } from 'vitest';
import { amounts, decimal, isBuyer, parseDocument, sellerMatches } from '../src/parse';

describe('parse: numbers', () => {
  it('reads dot, comma and thousands separators', () => {
    expect(decimal('82.07')).toBe('82.07');
    expect(decimal('19,98')).toBe('19.98');
    expect(decimal('1,234.50')).toBe('1234.50');
    expect(decimal('1.234,50')).toBe('1234.50');
    expect(amounts('Total €82.07').map((a) => [a.value, a.marker])).toEqual([['82.07', '€']]);
  });
});

describe('parse: documents', () => {
  it('reads a Stripe reverse-charge receipt as known zero VAT', () => {
    const doc = parseDocument(
      [
        'Receipt from Example Labs Ireland Limited',
        'Invoice number ABC12345-0003',
        'Receipt number 2937-6899',
        'Date paid October 22, 2026',
        'Example Labs Ireland Limited',
        'Bill to',
        'Sample Buyer Oy',
        'Subtotal €82.07',
        'Total €82.07',
        'Amount paid €82.07',
        'Tax to be paid on reverse charge basis',
      ].join('\n'),
    );
    expect(doc).toMatchObject({
      currency: 'EUR',
      total: 8207,
      subtotal: 8207,
      vatZero: true,
      reverseCharge: true,
      paymentDate: '2026-10-22',
      invoiceNumber: 'ABC12345-0003',
      receiptNumber: '2937-6899',
    });
    expect(doc.sellerCandidates).toContain('Example Labs Ireland Limited');
    expect(doc.conflicts).toEqual([]);
  });

  it('treats subtotal = total with no tax line as zero VAT', () => {
    const doc = parseDocument('Paid October 22, 2026\nSubtotal US$20.00\nTotal US$20.00\nAmount paid US$20.00');
    expect(doc).toMatchObject({ currency: 'USD', total: 2000, vatZero: true });
  });

  it('reads a Finnish ALV table with two rates', () => {
    const doc = parseDocument(
      [
        'Esimerkkikauppa Oy',
        '22.10.2026 14:05',
        'YHTEENSÄ 23,23 EUR',
        'ALV % VEROTON VERO VEROLLINEN',
        '25,5 % 9,20 2,35 11,55',
        '14 % 10,78 1,51 12,29',
      ].join('\n'),
    );
    expect(doc.total).toBe(2323);
    expect(doc.vatRates.sort()).toEqual([1400, 2550]);
    expect(doc.vat).toBe(386);
    expect(doc.issueDate ?? doc.soleDate).toBe('2026-10-22');
  });

  it('reads Finnish invoice labels', () => {
    const doc = parseDocument(
      'Tilitoimisto Esimerkki Oy\nLaskun päivämäärä 1.10.2026\nEräpäivä 15.10.2026\nVeroton yhteensä 100,00 €\nALV 25,5 % 25,50 €\nYhteensä 125,50 €',
    );
    expect(doc).toMatchObject({
      total: 12550,
      subtotal: 10000,
      vat: 2550,
      issueDate: '2026-10-01',
      dueDate: '2026-10-15',
    });
    expect(doc.vatRates).toEqual([2550]);
  });

  it('keeps fractional US sales tax rates', () => {
    expect(parseDocument('Sales tax (8.875%) $4.44\nTotal USD 54.44').vatRates).toEqual([888]);
  });

  it('flags a bare dollar and a total that disagrees with the amount paid', () => {
    expect(parseDocument('Total $49.00').currencyAmbiguous).toBe(true);
    expect(parseDocument('Total €50.00\nAmount paid €45.00').conflicts).toContain('total');
  });

  it('only reads slash dates that cannot be misread', () => {
    expect(parseDocument('Date paid 10/22/2026').paymentDate).toBe('2026-10-22');
    expect(parseDocument('Date paid 10/11/2026').paymentDate).toBeNull();
  });

  it('matches sellers and spots buyers', () => {
    const doc = parseDocument(
      'Receipt\nOpenAI Ireland Limited\n1 Sample Street, Dublin\nBill to\nSample Buyer Oy\nTotal €1.00',
    );
    expect(sellerMatches(doc, 'OpenAI Ireland Limited')).toBe(true);
    expect(sellerMatches(doc, 'Sample Buyer Oy')).toBe(false);
    expect(isBuyer(doc, 'Sample Buyer Oy')).toBe(true);
    expect(isBuyer(doc, 'OpenAI Ireland Limited')).toBe(false);
  });
});
