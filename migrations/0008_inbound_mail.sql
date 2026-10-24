-- Every email the Worker receives gets one short log row (who, subject, what
-- happened), and mail from a sender not on the allowed list is held here as
-- an "Unknown sender" item for the owner to approve, ignore or delete.
-- ignored_senders lists senders whose mail is logged only. Additive only.
-- Kept identical to schema/0005_inbound_mail.sql.
CREATE TABLE inbound_mail (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  sender TEXT NOT NULL CHECK (length(sender) <= 254),
  envelope TEXT NOT NULL DEFAULT '' CHECK (length(envelope) <= 254),
  to_address TEXT NOT NULL DEFAULT '' CHECK (length(to_address) <= 254),
  subject TEXT NOT NULL DEFAULT '' CHECK (length(subject) <= 300),
  message_id TEXT CHECK (message_id IS NULL OR length(message_id) <= 300),
  attachments INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  email_key TEXT,
  state TEXT NOT NULL CHECK (state IN ('imported','held','ignored','dropped')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 40)
);
CREATE INDEX inbound_mail_received ON inbound_mail (received_at);
CREATE INDEX inbound_mail_sender ON inbound_mail (sender, state);
CREATE INDEX inbound_mail_email ON inbound_mail (email_key) WHERE email_key IS NOT NULL;
CREATE UNIQUE INDEX inbound_mail_held_message ON inbound_mail (message_id)
  WHERE state = 'held' AND message_id IS NOT NULL;
CREATE TABLE ignored_senders (
  address TEXT PRIMARY KEY CHECK (length(address) <= 254),
  added_at TEXT NOT NULL,
  added_by TEXT NOT NULL DEFAULT ''
);
