import { expect, test } from 'vitest';
import {
  convertEur,
  date,
  emptyFacts,
  minor,
  money,
  normalize,
  review,
  roundRatio,
  similar,
  withinWindow,
} from '../src/domain';
import { parseChoice, parseExtraction } from '../src/ai';
import { parsePreset, transactionIds } from '../src/banking';
import { csvCell } from '../src/ui';

import { modelResponse } from './model';
test('money validates exponents, nulls, sub-minor precision, and signed rounding', () => {
  expect(minor('125.50', 'EUR')).toBe(12550);
  expect(minor('120', 'JPY')).toBe(120);
  expect(minor('-1.20', 'USD')).toBe(-120);
  expect(minor('1.0000', 'EUR')).toBe(100);
  expect(() => minor('1.001', 'EUR')).toThrow();
  expect(() => minor('1.1', 'JPY')).toThrow();
  expect(() => minor('9007199254740992', 'EUR')).toThrow();
  expect(() => minor('12', 'XYZ')).toThrow();
  expect(roundRatio(-15n, 10n)).toBe(-2);
  expect(roundRatio(15n, 10n)).toBe(2);
  expect(convertEur(12550, 'USD', '0.9')).toBe(11295);
  expect(convertEur(100, 'JPY', '0.0061')).toBe(61);
});
test('VAT review thresholds preserve unknowns and handle zero net', () => {
  const facts = {
    ...emptyFacts,
    vendor: 'Sample',
    invoice_number: '1',
    issue_date: '2026-09-01',
    currency: 'EUR',
    total_minor: 12552,
    net_minor: 10000,
    vat_minor: 2550,
    vat_rate_bps: 2550,
  };
  expect(review(facts)).toEqual([]);
  expect(review({ ...facts, total_minor: 12553 })).toContain('vat_mismatch');
  expect(review({ ...facts, vat_rate_bps: 2560 })).not.toContain('vat_rate_mismatch');
  expect(review({ ...facts, vat_rate_bps: 2580 })).toContain('vat_rate_mismatch');
  expect(
    review({
      ...facts,
      net_minor: 0,
      vat_minor: 0,
      total_minor: 0,
      vat_rate_bps: null,
    }),
  ).toEqual([]);
  expect(review({ ...facts, vat_minor: null })).toContain('missing_vat');
  expect(review({ ...facts, total_minor: -100 })).toContain('credit_or_sign');
});
test('Clairic null stays null despite guess, confidence boundaries are explicit', () => {
  expect(parseExtraction(modelResponse()).reasons).toEqual([]);
  const absent = parseExtraction(modelResponse({ total: { type: 'number', value: null, guess: 125.5 } }));
  expect(absent.facts.total_minor).toBeNull();
  expect(absent.reasons).toContain('uncertain_total');
  expect(
    parseExtraction(
      modelResponse({
        vendor: {
          type: 'text',
          value: 'Sample',
          confidence: 0.899,
          p_null: 0.1,
        },
      }),
    ).reasons,
  ).toContain('uncertain_vendor');
  expect(
    parseExtraction(
      modelResponse({
        vendor: {
          type: 'text',
          value: 'Sample',
          confidence: 0.9,
          p_null: 0.101,
        },
      }),
    ).reasons,
  ).toContain('uncertain_vendor');
  expect(() => parseExtraction(modelResponse({ total: { type: 'text', value: 'bad' } }))).toThrow();
  expect(() => parseExtraction(modelResponse({ issue_date: { type: 'date', value: '2026-02-30' } }))).toThrow();
});
test('Clef reads choice and validates probabilities and enums', () => {
  const answer = (probability: number, choice = 'infra') => ({
    answers: {
      expense_type: {
        type: 'choice',
        choice,
        confidence: 0.9,
        probabilities: { infra: probability },
      },
    },
  });
  expect(parseChoice(answer(0.85), 'expense_type', ['infra', 'other'])).toBe('infra');
  expect(() => parseChoice(answer(0.849), 'expense_type', ['infra', 'other'])).toThrow();
  expect(() => parseChoice(answer(NaN), 'expense_type', ['infra'])).toThrow();
  expect(() => parseChoice(answer(1, 'invented'), 'expense_type', ['infra'])).toThrow();
});
test('dates and matching name/date boundaries are conservative', () => {
  expect(() => date('2026-02-29')).toThrow();
  expect(date('2024-02-29')).toBe('2024-02-29');
  expect(withinWindow('2026-09-04', '2026-09-01')).toBe(true);
  expect(withinWindow('2026-09-04', '2026-08-31')).toBe(false);
  expect(withinWindow('2026-09-04', '2026-10-19')).toBe(true);
  expect(withinWindow('2026-09-04', '2026-10-20')).toBe(false);
  expect(normalize('Café & CLOUD, Oy')).toBe('cafe cloud');
  expect(similar('Café Cloud Oy', 'Cafe cloud LTD')).toBe(true);
  expect(similar('Stripe', 'Stripe')).toBe(false);
  expect(similar('alpha beta', 'alpha beta gamma')).toBe(true);
  expect(similar('alpha beta', 'alpha gamma')).toBe(false);
});
test('Holvi parses BOM, delimiters, quoted fields, decimal commas, dates, and explicit account currency', () => {
  const result = parsePreset(
    '\uFEFFDate;Amount;Payee;Message\n04.09.2026;-1 234,50;"Sample; Cloud";"quoted\nmessage"\n',
    'sample',
    'EUR',
  );
  expect(result.errors).toEqual([]);
  expect(result.rows[0]?.amount_minor).toBe(-123450);
  expect(result.rows[0]?.merchant).toBe('Sample; Cloud');
  expect(result.rows[0]?.reference).toBe('quoted\nmessage');
  expect(parsePreset('Date,Amount,Payee\n2026-09-01,-12.50,Sample\n', 'sample', 'EUR').rows[0]?.amount_minor).toBe(
    -1250,
  );
  expect(parsePreset('Date;Amount;Payee\n01/02/2026;-12;Sample\n', 'sample', 'EUR').errors).toHaveLength(1);
  expect(parsePreset('Date;Amount;Payee\n2026-09-01;1.234,56;Sample\n', 'sample', 'EUR').errors).toHaveLength(1);
  expect(parsePreset('Date;Balance;Payee\n2026-09-01;12;Sample\n', 'sample', 'EUR').errors).toContain(
    'Map amount or debit and credit',
  );
});
test('fallback identities preserve repeated rows and remain stable across formatting', async () => {
  const a = parsePreset('Date;Amount;Payee\n2026-09-01;-12,50;Sample Oy\n2026-09-01;-12,50;Sample Oy\n', 'a', 'EUR');
  const ids = await transactionIds(a.rows);
  expect(new Set(ids).size).toBe(2);
  const b = parsePreset('Date,Amount,Payee\n2026-09-01,-12.50,SAMPLE OY\n2026-09-01,-12.50,SAMPLE OY\n', 'a', 'EUR');
  expect(await transactionIds(b.rows)).toEqual(ids);
  const c = parsePreset('Date;Amount;Payee;Transaction ID\n2026-09-01;-12,50;Sample;id-1\n', 'a', 'EUR');
  const d = parsePreset('Date;Amount;Payee;Transaction ID\n2026-09-02;-13,50;Different;id-1\n', 'a', 'EUR');
  expect(await transactionIds(c.rows)).toEqual(await transactionIds(d.rows));
  expect(await transactionIds(c.rows)).not.toEqual(
    await transactionIds(c.rows.map((r) => ({ ...r, account_key: 'b' }))),
  );
});
test('CSV neutralizes formula text without changing numeric fields', () => {
  for (const value of ['=1+1', '+SUM(A1)', '-cmd', '@SUM(A1)', '  =1']) expect(csvCell(value)).toBe("'" + value);
  expect(csvCell('Sample vendor')).toBe('Sample vendor');
});

test('money formatting preserves every safe minor unit at the integer boundary', () => {
  expect(money(9007199254740990)).toBe('90071992547409.90');
  expect(money(-9007199254740990)).toBe('-90071992547409.90');
  expect(money(9007199254740990n * 5000n)).toBe('450359962737049500.00');
});
