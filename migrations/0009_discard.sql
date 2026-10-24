-- Discard: the owner can set a receipt aside (personal, a duplicate, not a
-- receipt). A discarded row stays in the table and its files stay in R2, but
-- it is left out of Review, totals, exports, the month package and bank
-- matching until restored. Additive only. Kept identical to schema/0006_discard.sql.
ALTER TABLE receipts ADD COLUMN discarded_at TEXT;
ALTER TABLE receipts ADD COLUMN discard_reason TEXT
  CHECK (discard_reason IS NULL OR discard_reason IN ('personal','duplicate','not_receipt','other'));
CREATE INDEX receipts_discarded ON receipts (discarded_at) WHERE discarded_at IS NOT NULL;
