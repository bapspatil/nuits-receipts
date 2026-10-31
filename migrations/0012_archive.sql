-- The archive: every finance document browsable and searchable from Home.
-- Additive only. Kept identical to schema/0009_archive.sql.

-- The document's own words, lower case with spaces collapsed, for search. NULL
-- until indexed (processing writes it; Settings indexes older rows), '' when
-- the file has no text layer, such as a photo.
ALTER TABLE receipts ADD COLUMN search_text TEXT;
CREATE INDEX receipts_unindexed ON receipts (received_at) WHERE search_text IS NULL;
-- Home sorts by the document's date, then by arrival.
CREATE INDEX receipts_received ON receipts (received_at);

-- Finance papers that are not receipts or sales invoices: contracts, tax
-- returns, letters. Stored, dated and searchable; never matched, packaged or
-- counted, which is why they have their own table.
CREATE TABLE documents (
	id TEXT PRIMARY KEY,
	original_key TEXT NOT NULL UNIQUE,
	filename TEXT NOT NULL,
	media_type TEXT NOT NULL,
	title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
	doc_date TEXT CHECK (doc_date IS NULL OR length(doc_date) = 10),
	received_at TEXT NOT NULL,
	search_text TEXT
);

-- Marks on any archive item, keyed by its item key: r:<receipt id>,
-- d:<document id>, s:<import id> or p:<month>@<sent_at>.
CREATE TABLE marks (
	item TEXT PRIMARY KEY,
	starred_at TEXT,
	note TEXT CHECK (note IS NULL OR length(note) <= 2000)
);
CREATE INDEX marks_starred ON marks (starred_at) WHERE starred_at IS NOT NULL;
CREATE TABLE tags (
	item TEXT NOT NULL,
	tag TEXT NOT NULL CHECK (length(tag) BETWEEN 1 AND 40),
	PRIMARY KEY (item, tag)
);
CREATE INDEX tags_tag ON tags (tag);

-- A search kept as a folder in Home's drawer: the Home query string it opens.
CREATE TABLE saved_searches (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
	query TEXT NOT NULL CHECK (length(query) <= 300),
	created_at TEXT NOT NULL
);

-- What the owner opened lately, newest 50, for Home's Recent folder.
CREATE TABLE recent_views (
	item TEXT PRIMARY KEY,
	viewed_at TEXT NOT NULL
);
CREATE INDEX recent_views_at ON recent_views (viewed_at);
