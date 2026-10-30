export const READY: number;
export const NEEDS_REVIEW: number;
export const BANK_ROWS: number;
export const TRANSFER_ROWS: readonly (readonly [number, number])[];
export const UNDATED: readonly number[];
export const SALES: readonly number[];
export const EARLIER: readonly number[];
export function earlierMonth(month: string): string;
export function hex64(prefix: string, n: number): string;
type Cols = Record<string, string | number | null>;
export function busyReceipts(month: string): Cols[];
export function busyMail(month: string): Cols[];
export type StatementRow = { ext: string; date: string; amount_minor: number; merchant: string; reference: string };
export function busyStatement(month: string): StatementRow[];
export function statementCsv(rows: StatementRow[]): string;
export function classifyBank(
  idByIndex: string[],
  sorted: string[],
): {
  missing: string[];
  matched: { id: string; receipt: string }[];
  exempted: string[];
  owner: string[];
  transfers: { debit: string; credit: string }[];
};
export function busySql(month: string, accountId?: string): string;
