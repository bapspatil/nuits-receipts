CREATE TRIGGER receipt_duplicate_insert
BEFORE INSERT ON receipts WHEN NEW.duplicate_of IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'duplicate_chain')
  WHERE EXISTS (SELECT 1 FROM receipts WHERE id=NEW.duplicate_of AND duplicate_of IS NOT NULL);
END;

CREATE TRIGGER receipt_duplicate_update
BEFORE UPDATE OF duplicate_of ON receipts WHEN NEW.duplicate_of IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'duplicate_chain')
  WHERE EXISTS (SELECT 1 FROM receipts WHERE id=NEW.duplicate_of AND duplicate_of IS NOT NULL)
     OR EXISTS (SELECT 1 FROM receipts WHERE duplicate_of=NEW.id);
END;
