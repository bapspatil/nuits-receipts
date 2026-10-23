-- Bootstrap for new installations. Kept equivalent to migrations/0001..0004;
-- schema/0002 matches migrations/0005.

-- scripts/schema.test.ts verifies tables, constraints, indexes, triggers and foreign keys.

CREATE TABLE accounts (
	id TEXT PRIMARY KEY,
	label TEXT NOT NULL COLLATE NOCASE UNIQUE,
	bank_name TEXT NOT NULL,
	default_currency TEXT NOT NULL,
	is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
	archived_at TEXT,
	created_at TEXT NOT NULL
);

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

CREATE TABLE bank_transactions (
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
	receipt_id TEXT UNIQUE REFERENCES receipts(id),
	match_method TEXT CHECK (match_method IN ('automatic','manual')),
	matched_at TEXT,
	FOREIGN KEY(import_id,account_key) REFERENCES imports(id,account_key)
);

CREATE TABLE fx_rates (
	currency TEXT NOT NULL, requested_date TEXT NOT NULL, rate_date TEXT NOT NULL,
	eur_per_unit TEXT NOT NULL, source TEXT NOT NULL, fetched_at TEXT NOT NULL,
	PRIMARY KEY (currency, requested_date)
);

CREATE TABLE imports (
	id TEXT PRIMARY KEY,
	account_key TEXT NOT NULL REFERENCES accounts(id),
	original_key TEXT NOT NULL UNIQUE,
	status TEXT NOT NULL CHECK (status IN ('pending','complete')),
	row_count INTEGER NOT NULL,
	imported_at TEXT NOT NULL,
	snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
	UNIQUE(id,account_key)
);

CREATE TABLE internal_transfers (
	debit_id TEXT PRIMARY KEY REFERENCES bank_transactions(id),
	credit_id TEXT NOT NULL UNIQUE REFERENCES bank_transactions(id),
	reason TEXT NOT NULL,
	confirmed_at TEXT NOT NULL,
	CHECK (debit_id <> credit_id)
);

CREATE TABLE receipts (
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
	duplicate_of TEXT REFERENCES receipts(id),
	CHECK (duplicate_of IS NULL OR duplicate_of <> id)
);

CREATE TABLE vendor_rules (
	id INTEGER PRIMARY KEY, priority INTEGER NOT NULL DEFAULT 0,
	vendor_contains TEXT NOT NULL, context_contains TEXT,
	bank_alias TEXT, product TEXT NOT NULL, expense_type TEXT NOT NULL,
	UNIQUE (vendor_contains, context_contains)
);

CREATE UNIQUE INDEX accounts_one_default ON accounts(is_default) WHERE is_default=1;

CREATE INDEX bank_account_date ON bank_transactions(account_key,booking_date,id);

CREATE UNIQUE INDEX bank_external_id ON bank_transactions(account_key,external_id)
	WHERE external_id IS NOT NULL;

CREATE INDEX bank_unmatched ON bank_transactions(booking_date,currency,amount_minor)
	WHERE receipt_id IS NULL;

CREATE INDEX presets_header ON bank_presets(header_fingerprint);

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

INSERT INTO accounts(id,label,bank_name,default_currency,is_default,created_at)
	VALUES ('default-account','Bank account','','EUR',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT INTO vendor_rules (vendor_contains,product,expense_type) VALUES
 ('cloudflare','general','infra'),
 ('openai','general','AI APIs'),
 ('anthropic','general','AI APIs'),
 ('amp frontier','general','subscriptions');
