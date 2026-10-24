-- Month package: "I've sent it" records and the optional OneDrive upload.
-- Kept identical to schema/0002_month_package.sql.

-- One row per time the owner marked a month as sent. receipts_json holds the
-- sorted "id:revision" list the hash was computed over, so a later visit can
-- tell what was added or corrected since.
CREATE TABLE month_sends (
	month TEXT NOT NULL CHECK (length(month) = 7),
	sent_at TEXT NOT NULL,
	method TEXT NOT NULL CHECK (method IN ('download','onedrive')),
	file_count INTEGER NOT NULL,
	total_minor INTEGER NOT NULL,
	receipts_hash TEXT NOT NULL,
	receipts_json TEXT NOT NULL CHECK (json_valid(receipts_json)),
	PRIMARY KEY (month, sent_at)
);

-- At most one Microsoft connection. The refresh token is AES-GCM encrypted
-- with the ONEDRIVE_TOKEN_KEY secret; the destination folder is optional.
CREATE TABLE onedrive_connection (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	account_name TEXT NOT NULL,
	account_email TEXT NOT NULL,
	refresh_token_enc TEXT NOT NULL,
	connected_at TEXT NOT NULL,
	folder_drive_id TEXT,
	folder_item_id TEXT,
	folder_name TEXT,
	folder_web_url TEXT
);

-- What is already in the destination folder, so retries skip files and a
-- corrected receipt replaces its old copy.
CREATE TABLE onedrive_uploads (
	folder_item_id TEXT NOT NULL,
	month TEXT NOT NULL,
	receipt_id TEXT NOT NULL,
	revision INTEGER NOT NULL,
	file_name TEXT NOT NULL,
	drive_item_id TEXT NOT NULL,
	uploaded_at TEXT NOT NULL,
	PRIMARY KEY (folder_item_id, month, receipt_id)
);
