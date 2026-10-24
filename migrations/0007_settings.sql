-- In-app settings: values edited in Settings > Setup override the Worker var
-- of the same name (app setting > Worker var > built-in default). Empty on
-- install, so a fresh or upgraded deployment behaves exactly as before.
-- Kept identical to schema/0004_settings.sql.
CREATE TABLE settings (
  key TEXT PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 64),
  value_json TEXT NOT NULL CHECK (json_valid(value_json) AND length(value_json) <= 20000),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
-- Every save and reset, newest last. old/new are NULL for "not set in app".
CREATE TABLE settings_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  old_json TEXT,
  new_json TEXT,
  changed_at TEXT NOT NULL,
  changed_by TEXT NOT NULL
);
CREATE INDEX settings_audit_changed ON settings_audit(changed_at);
