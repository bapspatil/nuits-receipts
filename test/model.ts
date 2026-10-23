export function modelResponse(overrides: Record<string, unknown> = {}): unknown {
  const values: Record<string, unknown> = {
    vendor: 'Sample Oy',
    invoice_number: 'S-1',
    issue_date: '2026-09-01',
    due_date: null,
    currency: 'EUR',
    total: 125.5,
    net: 100,
    vat_amount: 25.5,
    vat_rate: 25.5,
    line_items: ['Subscription'],
  };
  const answers = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      {
        type: ['total', 'net', 'vat_amount', 'vat_rate'].includes(key)
          ? 'number'
          : key.endsWith('date')
            ? 'date'
            : key === 'line_items'
              ? 'list'
              : 'text',
        value,
        confidence: 0.9,
        p_null: 0.1,
      },
    ]),
  );
  return {
    model: 'fixture',
    answers: { ...answers, ...overrides },
    truncated: false,
    usage: { input_tokens: 100, output_tokens: 20 },
  };
}
