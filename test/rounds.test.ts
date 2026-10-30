import { env } from 'cloudflare:workers';
import { expect, test, vi } from 'vitest';
import { request } from './helpers';
import { seed } from './package-helpers';

// How many times a request waits on D1, one after another. A statement or a batch that starts
// after another finished sits one round deeper than it; ones started together share a round.
function rounded(db: D1Database) {
  const state = { done: 0, calls: 0, rounds: 0 };
  const track = async <T>(run: () => Promise<T>): Promise<T> => {
    const depth = state.done + 1;
    state.calls++;
    state.rounds = Math.max(state.rounds, depth);
    try {
      return await run();
    } finally {
      state.done = Math.max(state.done, depth);
    }
  };
  const originals = new WeakMap<object, D1PreparedStatement>();
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const proxy: D1PreparedStatement = new Proxy(statement, {
      get(target, key) {
        const value = Reflect.get(target, key) as unknown;
        if (typeof value !== 'function') return value;
        if (key === 'bind') return (...args: unknown[]) => wrap(value.apply(target, args) as D1PreparedStatement);
        if (['all', 'first', 'run', 'raw'].includes(String(key)))
          return (...args: unknown[]) => track(async () => value.apply(target, args));
        return value.bind(target);
      },
    });
    originals.set(proxy, statement);
    return proxy;
  };
  const prepare = db.prepare.bind(db);
  const batch = db.batch.bind(db);
  const spies = [
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => wrap(prepare(sql))),
    vi
      .spyOn(db, 'batch')
      .mockImplementation(((statements: D1PreparedStatement[]) =>
        track(() => batch(statements.map((x) => originals.get(x) ?? x)))) as typeof db.batch),
  ];
  return { state, restore: () => spies.forEach((x) => x.mockRestore()) };
}

async function rounds(path: string) {
  const { state, restore } = rounded(env.DB);
  try {
    const response = await request(path);
    expect(response.status).toBe(200);
    await response.text();
  } finally {
    restore();
  }
  return state;
}

async function sales(n: number) {
  for (let i = 0; i < n; i++)
    await seed({
      kind: 'sales',
      client: `Client ${i}`,
      status: 'ready',
      issue_date: `2026-10-0${i + 1}`,
      currency: i % 2 ? 'USD' : 'EUR',
    });
}

test('the invoices list waits on D1 once for its data, whichever Show chip is open', async () => {
  await sales(3);
  const all = await rounds('/receipts?view=all&kind=sales&month=2026-10');
  const unpaid = await rounds('/receipts?view=all&kind=sales&month=2026-10&show=unpaid');
  const overdue = await rounds('/receipts?view=all&kind=sales&month=2026-10&show=overdue');
  // It was six, five and five: the rows, then the open ones, then the undated, the euro values,
  // the overdue and the counts, each waiting on the one before. The first request of a process also
  // spends one round on settings, so the page itself adds at most one.
  expect(all.rounds).toBeLessThanOrEqual(2);
  expect(unpaid.rounds).toBeLessThanOrEqual(2);
  expect(overdue.rounds).toBeLessThanOrEqual(2);
});
