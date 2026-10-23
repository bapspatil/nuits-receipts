-- Sales invoices: invoices the owner sends to clients, stored next to expense
-- receipts in the same table. Every existing row stays an expense.
-- Kept identical to migrations/0006_sales_invoices.sql.
ALTER TABLE receipts ADD COLUMN kind TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense','sales'));
ALTER TABLE receipts ADD COLUMN client TEXT;
ALTER TABLE receipts ADD COLUMN client_country TEXT;
ALTER TABLE receipts ADD COLUMN client_vat_id TEXT;
ALTER TABLE receipts ADD COLUMN vat_treatment TEXT CHECK (vat_treatment IN ('domestic','reverse_charge','export','exempt'));
ALTER TABLE receipts ADD COLUMN reference_number TEXT;
-- "Paid outside the bank import": a Stripe payout, cash, or a statement not imported.
ALTER TABLE receipts ADD COLUMN paid_outside_on TEXT;
ALTER TABLE receipts ADD COLUMN paid_outside_note TEXT;
CREATE INDEX receipts_kind_issue ON receipts(kind, issue_date);
