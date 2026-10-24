CREATE TABLE receipts (
	id TEXT PRIMARY KEY,
	original_key TEXT NOT NULL UNIQUE,
	filename TEXT NOT NULL, media_type TEXT NOT NULL,
	source TEXT NOT NULL CHECK (source IN ('email','upload')),
	email_key TEXT, received_at TEXT NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('pending','processing','ready','needs_review')),
	attempt_id TEXT, lease_until TEXT, revision INTEGER NOT NULL DEFAULT 0,
	vendor TEXT, invoice_number TEXT, issue_date TEXT, due_date TEXT,
	currency TEXT, total_minor INTEGER, net_minor INTEGER, vat_minor INTEGER,
	vat_rate_bps INTEGER, line_items_json TEXT,
	product TEXT NOT NULL DEFAULT 'Nuits general' CHECK (product IN (
		'SignalScout','Mochi','Lexborn','Cringe','Doveborn','Fablebloom','Window',
		'Echoborn','BapsOS','bapspatil.com','brandnuits.com','musicbybaps.com','Nuits general')),
	expense_type TEXT NOT NULL DEFAULT 'other'
		CHECK (expense_type IN ('infra','AI APIs','subscriptions','other')),
	classification_json TEXT, ai_json TEXT, manual_fields_json TEXT NOT NULL DEFAULT '{}',
	review_reasons_json TEXT NOT NULL DEFAULT '[]', reviewed_at TEXT,
	fx_eur_minor INTEGER, fx_requested_date TEXT,
	eur_override_minor INTEGER, eur_override_reason TEXT,
	duplicate_of TEXT REFERENCES receipts(id),
	CHECK (duplicate_of IS NULL OR duplicate_of <> id)
);
CREATE INDEX receipts_month ON receipts(issue_date, product, expense_type);

CREATE TABLE imports (
	id TEXT PRIMARY KEY, account_key TEXT NOT NULL, original_key TEXT NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('pending','complete')),
	row_count INTEGER NOT NULL, imported_at TEXT NOT NULL,
	UNIQUE (account_key, original_key)
);
CREATE TABLE bank_transactions (
	id TEXT PRIMARY KEY, account_key TEXT NOT NULL, external_id TEXT,
	import_id TEXT NOT NULL REFERENCES imports(id), booking_date TEXT NOT NULL,
	amount_minor INTEGER NOT NULL, currency TEXT NOT NULL,
	original_amount_minor INTEGER, original_currency TEXT,
	merchant TEXT NOT NULL, reference TEXT, raw_json TEXT NOT NULL,
	receipt_required INTEGER NOT NULL DEFAULT 1 CHECK (receipt_required IN (0,1)),
	receipt_id TEXT UNIQUE REFERENCES receipts(id),
	match_method TEXT CHECK (match_method IN ('automatic','manual')),
	matched_at TEXT
);
CREATE UNIQUE INDEX bank_external_id ON bank_transactions(account_key, external_id)
	WHERE external_id IS NOT NULL;
CREATE INDEX bank_unmatched ON bank_transactions(booking_date, currency, amount_minor)
	WHERE receipt_id IS NULL;

CREATE TABLE fx_rates (
	currency TEXT NOT NULL, requested_date TEXT NOT NULL, rate_date TEXT NOT NULL,
	eur_per_unit TEXT NOT NULL, source TEXT NOT NULL, fetched_at TEXT NOT NULL,
	PRIMARY KEY (currency, requested_date)
);
CREATE TABLE vendor_rules (
	id INTEGER PRIMARY KEY, priority INTEGER NOT NULL DEFAULT 0,
	vendor_contains TEXT NOT NULL, context_contains TEXT,
	bank_alias TEXT, product TEXT NOT NULL, expense_type TEXT NOT NULL,
	UNIQUE (vendor_contains, context_contains)
);
