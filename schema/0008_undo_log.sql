-- Undo: one action's rows as they were before it, keyed by the action's time.
-- The snapshot is written in the same batch as the change, so the two commit
-- together. after_json is the row just after the change ('null' once deleted),
-- so Undo can leave alone a row that changed again since. The primary key
-- starts with at, so pruning old actions is a range delete. Additive only.
-- Kept identical to migrations/0011_undo_log.sql.
CREATE TABLE undo_log (
  at TEXT NOT NULL,
  op TEXT NOT NULL,
  tbl TEXT NOT NULL,
  row_id TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT,
  PRIMARY KEY (at, tbl, row_id)
);
