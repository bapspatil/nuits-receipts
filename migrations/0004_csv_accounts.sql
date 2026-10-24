PRAGMA defer_foreign_keys = ON;

CREATE TABLE receipts_v02 (
	id TEXT PRIMARY KEY, original_key TEXT NOT NULL UNIQUE,
	filename TEXT NOT NULL, media_type TEXT NOT NULL,
	source TEXT NOT NULL CHECK (source IN ('email','upload')),
	email_key TEXT, received_at TEXT NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('pending','processing','ready','needs_review')),
	attempt_id TEXT, lease_until TEXT, revision INTEGER NOT NULL DEFAULT 0,
	vendor TEXT, invoice_number TEXT, issue_date TEXT, due_date TEXT,
	currency TEXT, total_minor INTEGER, net_minor INTEGER, vat_minor INTEGER,
	vat_rate_bps INTEGER, line_items_json TEXT,
	product TEXT NOT NULL DEFAULT 'general' CHECK (length(product) BETWEEN 1 AND 100),
	expense_type TEXT NOT NULL DEFAULT 'other'
		CHECK (expense_type IN ('infra','AI APIs','subscriptions','other')),
	classification_json TEXT, ai_json TEXT, manual_fields_json TEXT NOT NULL DEFAULT '{}',
	review_reasons_json TEXT NOT NULL DEFAULT '[]', reviewed_at TEXT,
	fx_eur_minor INTEGER, fx_requested_date TEXT, eur_override_minor INTEGER, eur_override_reason TEXT,
	duplicate_of TEXT REFERENCES receipts_v02(id),
	CHECK (duplicate_of IS NULL OR duplicate_of <> id)
);
INSERT INTO receipts_v02 SELECT * FROM receipts;

CREATE TABLE accounts (
	id TEXT PRIMARY KEY,
	label TEXT NOT NULL COLLATE NOCASE UNIQUE,
	bank_name TEXT NOT NULL,
	default_currency TEXT NOT NULL,
	is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
	archived_at TEXT,
	created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX accounts_one_default ON accounts(is_default) WHERE is_default=1;
INSERT INTO accounts(id,label,bank_name,default_currency,is_default,created_at)
	SELECT account_key,'Holvi EUR','Holvi','EUR',1,strftime('%Y-%m-%dT%H:%M:%fZ','now')
	FROM (SELECT account_key FROM imports UNION SELECT account_key FROM bank_transactions);
INSERT INTO accounts(id,label,bank_name,default_currency,is_default,created_at)
	SELECT 'default-account','Bank account','','EUR',1,strftime('%Y-%m-%dT%H:%M:%fZ','now')
	WHERE NOT EXISTS (SELECT 1 FROM accounts);

CREATE TABLE bank_presets (
	id TEXT PRIMARY KEY,
	bank_name TEXT NOT NULL COLLATE NOCASE,
	name TEXT NOT NULL COLLATE NOCASE,
	header_fingerprint TEXT NOT NULL,
	mapping_json TEXT NOT NULL CHECK (json_valid(mapping_json)),
	revision INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE(bank_name,name)
);
CREATE INDEX presets_header ON bank_presets(header_fingerprint);

CREATE TABLE imports_v02 (
	id TEXT PRIMARY KEY,
	account_key TEXT NOT NULL REFERENCES accounts(id),
	original_key TEXT NOT NULL UNIQUE,
	status TEXT NOT NULL CHECK (status IN ('pending','complete')),
	row_count INTEGER NOT NULL,
	imported_at TEXT NOT NULL,
	snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
	UNIQUE(id,account_key)
);
INSERT INTO imports_v02
	SELECT id,account_key,original_key,status,row_count,imported_at,
		'{"version":1,"preset":"holvi-legacy"}' FROM imports;

CREATE TABLE bank_transactions_v02 (
	id TEXT PRIMARY KEY,
	account_key TEXT NOT NULL REFERENCES accounts(id),
	external_id TEXT,
	import_id TEXT NOT NULL,
	booking_date TEXT NOT NULL,
	amount_minor INTEGER NOT NULL,
	currency TEXT NOT NULL,
	original_amount_minor INTEGER,
	original_currency TEXT,
	merchant TEXT NOT NULL,
	reference TEXT,
	raw_json TEXT NOT NULL,
	receipt_required INTEGER NOT NULL DEFAULT 1 CHECK (receipt_required IN (0,1)),
	receipt_id TEXT UNIQUE REFERENCES receipts_v02(id),
	match_method TEXT CHECK (match_method IN ('automatic','manual')),
	matched_at TEXT,
	FOREIGN KEY(import_id,account_key) REFERENCES imports_v02(id,account_key)
);
INSERT INTO bank_transactions_v02
	SELECT id,account_key,external_id,import_id,booking_date,amount_minor,currency,
		original_amount_minor,original_currency,merchant,reference,raw_json,
		receipt_required,receipt_id,match_method,matched_at FROM bank_transactions;
DROP TABLE bank_transactions;
DROP TABLE imports;
DROP TABLE receipts;
ALTER TABLE receipts_v02 RENAME TO receipts;
ALTER TABLE imports_v02 RENAME TO imports;
ALTER TABLE bank_transactions_v02 RENAME TO bank_transactions;
CREATE INDEX receipts_month ON receipts(issue_date,product,expense_type);
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
CREATE UNIQUE INDEX bank_external_id ON bank_transactions(account_key,external_id)
	WHERE external_id IS NOT NULL;
CREATE INDEX bank_unmatched ON bank_transactions(booking_date,currency,amount_minor)
	WHERE receipt_id IS NULL;
CREATE INDEX bank_account_date ON bank_transactions(account_key,booking_date,id);

CREATE TABLE internal_transfers (
	debit_id TEXT PRIMARY KEY REFERENCES bank_transactions(id),
	credit_id TEXT NOT NULL UNIQUE REFERENCES bank_transactions(id),
	reason TEXT NOT NULL,
	confirmed_at TEXT NOT NULL,
	CHECK (debit_id <> credit_id)
);
PRAGMA foreign_key_check;
PRAGMA defer_foreign_keys = OFF;
