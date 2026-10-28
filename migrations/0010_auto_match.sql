-- Automatic matching: who decided a payment needs no receipt, and pairs the
-- owner took apart so the matcher never links them again. exempt_by is NULL
-- until something decides: 'owner' for a choice made on the Bank page, a rule
-- name for the built-in rules, 'clef' for the model. A rule or Clef never
-- overrides an owner's choice. Additive only. Kept identical to
-- schema/0007_auto_match.sql.
ALTER TABLE bank_transactions ADD COLUMN exempt_by TEXT
  CHECK (exempt_by IS NULL OR exempt_by IN ('owner','own','tax','fee','cash','pension','topup','delivery','clef'));
CREATE TABLE match_rejections (
  transaction_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  rejected_at TEXT NOT NULL,
  PRIMARY KEY (transaction_id, receipt_id)
);
