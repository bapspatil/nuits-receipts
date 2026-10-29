// Mail from senders that are not on the allowed list, and a short log of every
// email the Worker received. An unknown sender's mail is never read by AI: it
// is kept as one "Unknown sender" item until the owner approves the sender
// (the mail is then imported like any other), ignores them, or deletes it.
// Only mail whose sender Cloudflare's checks authenticate is kept; the rest is
// logged and dropped, as before.
import PostalMime from 'postal-mime';
import type { Env } from './env';
import { config, MAX_ALLOWED_SENDERS } from './config';
import { hash, requireInput } from './domain';
import { headerFields, headerFromAddress, senderVerdict } from './sender';
import { importEmail, kindFor } from './receipts';
import { applied, saveChanges } from './settings';

// At most this many unknown-sender emails wait at once, and this many from one
// sender. Mail beyond either limit is logged only.
export const MAX_HELD = 50;
export const MAX_HELD_PER_SENDER = 10;
// Log rows kept, besides held mail.
export const MAX_LOG = 500;
export const MAX_IGNORED = 500;
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

export type MailState = 'imported' | 'held' | 'ignored' | 'dropped';
export type MailRow = {
  id: string;
  received_at: string;
  sender: string;
  envelope: string;
  to_address: string;
  subject: string;
  message_id: string | null;
  attachments: number;
  size_bytes: number;
  email_key: string | null;
  state: MailState;
  reason: string;
};
export type MailFacts = {
  sender: string;
  envelope: string;
  to: string;
  subject: string;
  messageId: string | null;
  attachments: number;
  size: number;
  emailKey?: string | null;
};

// What each logged reason means, in words for the person. `allow` marks the
// reasons where the sender was simply not on the list, so the log offers
// "Allow this sender". test/mail-log.test.ts holds this to every reason the code logs.
export const MAIL_REASONS = {
  allowed: { words: 'Read normally.', allow: false },
  sender_approved: { words: 'Read after you allowed the sender.', allow: false },
  sender_unverified: { words: "We couldn't confirm who sent it.", allow: false },
  sender_auth_failed: {
    words: 'Failed the sender check (SPF or DKIM), so it may not be from who it says.',
    allow: false,
  },
  sender_not_allowed: { words: 'Sender not allowed. Waiting in Review.', allow: true },
  sender_ignored: { words: 'Sender not allowed: you chose to ignore them.', allow: true },
  held_limit: { words: 'Sender not allowed, and too many of their emails were already waiting.', allow: true },
  deleted: { words: 'Sender not allowed: you deleted this email from Review.', allow: true },
  duplicate: { words: 'Already received: the same message is waiting or was read.', allow: false },
  email_too_large: { words: 'Too large to read.', allow: false },
  original_missing: { words: 'Its saved copy was gone, so it could not be read.', allow: false },
} as const satisfies Record<string, { words: string; allow: boolean }>;
export const reasonWords = (reason: string): string =>
  (MAIL_REASONS as Record<string, { words: string }>)[reason]?.words ?? 'Not kept.';
export const reasonAllows = (reason: string): boolean =>
  (MAIL_REASONS as Record<string, { allow: boolean }>)[reason]?.allow ?? false;

// Mail that was not kept, newest first. Only what the log stores, never the message.
export type DroppedMail = Pick<MailRow, 'id' | 'received_at' | 'sender' | 'subject' | 'reason'>;
export async function droppedMail(env: Env, limit = 50): Promise<DroppedMail[]> {
  try {
    return (
      await env.DB.prepare(
        "SELECT id,received_at,sender,subject,reason FROM inbound_mail WHERE state IN ('dropped','ignored') ORDER BY received_at DESC,id DESC LIMIT ?",
      )
        .bind(limit)
        .all<DroppedMail>()
    ).results;
  } catch {
    return [];
  }
}
export async function hasRecentDropped(env: Env, days = 60): Promise<boolean> {
  try {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    return !!(await env.DB.prepare(
      "SELECT 1 FROM inbound_mail WHERE state IN ('dropped','ignored') AND received_at>=? LIMIT 1",
    )
      .bind(since)
      .first());
  } catch {
    return false;
  }
}

export function domainOf(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1);
}
const clip = (value: string, max: number) =>
  value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, max);

// What the log and the Review item show. Never throws: unreadable mail is
// logged with what the envelope says.
export async function mailFacts(
  bytes: Uint8Array | null,
  envelope: string,
  to: string | undefined,
  sender?: string | null,
): Promise<MailFacts> {
  const facts: MailFacts = {
    sender: clip(sender ?? envelope, 254),
    envelope: clip(envelope, 254),
    to: clip((to ?? '').toLowerCase(), 254),
    subject: '',
    messageId: null,
    attachments: 0,
    size: bytes?.byteLength ?? 0,
  };
  if (!bytes) return facts;
  try {
    if (!sender) facts.sender = clip(headerFromAddress(bytes) ?? envelope, 254);
    const id = headerFields(bytes).find(([f]) => f === 'message-id')?.[1];
    facts.messageId = id ? clip(id, 300) || null : null;
    const email = await PostalMime.parse(bytes);
    facts.subject = clip(email.subject ?? '', 300);
    facts.attachments = email.attachments.length;
  } catch {
    // Keep what was read so far.
  }
  return facts;
}

// One log row. Logging never stops or fails mail handling.
export async function logMail(env: Env, facts: MailFacts, state: MailState, reason: string): Promise<void> {
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO inbound_mail (id,received_at,sender,envelope,to_address,subject,message_id,attachments,size_bytes,email_key,state,reason)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        crypto.randomUUID(),
        new Date().toISOString(),
        facts.sender,
        facts.envelope,
        facts.to,
        facts.subject,
        facts.messageId,
        facts.attachments,
        facts.size,
        facts.emailKey ?? null,
        state,
        reason,
      ),
      env.DB.prepare(
        `DELETE FROM inbound_mail WHERE id IN (SELECT id FROM inbound_mail WHERE state<>'held' ORDER BY received_at DESC,id DESC LIMIT -1 OFFSET ?)`,
      ).bind(MAX_LOG),
    ]);
  } catch (error) {
    console.warn(
      JSON.stringify({ reason: 'mail_log_failed', error: error instanceof Error ? error.message : String(error) }),
    );
  }
}

// Mail from a sender who is not allowed. `sender` is the address Cloudflare's
// checks authenticated (src/sender.ts authenticatedSender), or null.
export async function holdUnknown(
  env: Env,
  bytes: Uint8Array,
  envelope: string,
  to: string | undefined,
  sender: string | null,
): Promise<void> {
  const facts = await mailFacts(bytes, envelope, to, sender);
  const note = (reason: string) => console.warn(JSON.stringify({ reason, domain: domainOf(facts.sender) }));
  try {
    if (!sender) {
      const reason = senderVerdict(bytes, envelope) === 'fail' ? 'sender_auth_failed' : 'sender_unverified';
      note(reason);
      return await logMail(env, facts, 'dropped', reason);
    }
    const ignored = await env.DB.prepare('SELECT 1 FROM ignored_senders WHERE address IN (?,?) LIMIT 1')
      .bind(sender, facts.envelope)
      .first();
    if (ignored) {
      note('sender_ignored');
      return await logMail(env, facts, 'ignored', 'sender_ignored');
    }
    if (facts.messageId) {
      const seen = await env.DB.prepare(
        "SELECT 1 FROM inbound_mail WHERE message_id=? AND state IN ('held','imported') LIMIT 1",
      )
        .bind(facts.messageId)
        .first();
      if (seen) {
        note('duplicate');
        return await logMail(env, facts, 'dropped', 'duplicate');
      }
    }
    const counts = await env.DB.prepare(
      "SELECT count(*) AS total, coalesce(sum(sender=?),0) AS mine FROM inbound_mail WHERE state='held'",
    )
      .bind(sender)
      .first<{ total: number; mine: number }>();
    if ((counts?.total ?? 0) >= MAX_HELD || (counts?.mine ?? 0) >= MAX_HELD_PER_SENDER) {
      note('held_limit');
      return await logMail(env, facts, 'dropped', 'held_limit');
    }
    const emailKey = `emails/${await hash(bytes)}.eml`;
    await env.ORIGINALS.put(emailKey, bytes, { httpMetadata: { contentType: 'message/rfc822' } });
    note('sender_not_allowed');
    await env.DB.prepare(
      `INSERT INTO inbound_mail (id,received_at,sender,envelope,to_address,subject,message_id,attachments,size_bytes,email_key,state,reason)
      VALUES (?,?,?,?,?,?,?,?,?,?,'held','sender_not_allowed') ON CONFLICT DO NOTHING`,
    )
      .bind(
        crypto.randomUUID(),
        new Date().toISOString(),
        sender,
        facts.envelope,
        facts.to,
        facts.subject,
        facts.messageId,
        facts.attachments,
        facts.size,
        emailKey,
      )
      .run();
  } catch (error) {
    // Before the migration, or a D1 outage: dropped as before, never bounced.
    console.warn(
      JSON.stringify({ reason: 'hold_failed', error: error instanceof Error ? error.message : String(error) }),
    );
  }
}

// Lower case and checked like ALLOWED_SENDER_EMAILS entries.
export function senderAddress(value: unknown): string {
  const address = String(value ?? '')
    .trim()
    .toLowerCase();
  requireInput(address.length <= 254 && EMAIL.test(address), 'Enter one email address, like billing@example.com');
  return address;
}

export async function heldMail(env: Env, limit = MAX_HELD): Promise<MailRow[]> {
  try {
    return (
      await env.DB.prepare("SELECT * FROM inbound_mail WHERE state='held' ORDER BY received_at DESC,id LIMIT ?")
        .bind(limit)
        .all<MailRow>()
    ).results;
  } catch {
    return [];
  }
}
export async function heldCount(env: Env): Promise<number> {
  try {
    return (await env.DB.prepare("SELECT count(*) AS n FROM inbound_mail WHERE state='held'").first<number>('n')) ?? 0;
  } catch {
    return 0;
  }
}
export async function ignoredSenders(env: Env): Promise<{ address: string; added_at: string }[]> {
  try {
    return (
      await env.DB.prepare('SELECT address,added_at FROM ignored_senders ORDER BY address LIMIT ?')
        .bind(MAX_IGNORED)
        .all<{ address: string; added_at: string }>()
    ).results;
  } catch {
    return [];
  }
}

async function saveAllowed(env: Env, list: string[], who: string): Promise<void> {
  await saveChanges(
    env,
    [{ key: 'ALLOWED_SENDER_EMAILS', value: list.join(', '), old: null }],
    who,
    applied(env).revision,
  );
}

// Adds the sender to the allowed list (the list in force, so the deploy
// defaults stay), then imports every email of theirs that is waiting.
// Returns how many waiting emails were imported.
export async function approveSender(
  env: Env,
  value: unknown,
  who: string,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
): Promise<number> {
  return approveSenders(env, [senderAddress(value)], who, ctx);
}
// The same for checked addresses, in one write of the list.
export async function approveSenders(
  env: Env,
  senders: readonly string[],
  who: string,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
): Promise<number> {
  const current = [...config(env).allowedSenders];
  const added = [...new Set(senders)].filter((s) => !current.includes(s));
  if (added.length) {
    requireInput(
      current.length + added.length <= MAX_ALLOWED_SENDERS,
      `You already have ${MAX_ALLOWED_SENDERS} approved senders, the most the app keeps. Remove one in Settings first.`,
      409,
    );
    await saveAllowed(env, [...current, ...added], who);
  }
  await env.DB.prepare('DELETE FROM ignored_senders WHERE address IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(senders))
    .run();
  let imported = 0;
  for (const row of await heldFrom(env, senders)) {
    const claim = await env.DB.prepare(
      "UPDATE inbound_mail SET state='imported',reason='sender_approved' WHERE id=? AND state='held'",
    )
      .bind(row.id)
      .run();
    if (claim.meta.changes !== 1) continue;
    const stored = row.email_key ? await env.ORIGINALS.get(row.email_key) : null;
    if (!stored || !row.email_key) {
      await env.DB.prepare("UPDATE inbound_mail SET state='dropped',reason='original_missing' WHERE id=?")
        .bind(row.id)
        .run();
      continue;
    }
    await importEmail(
      env,
      new Uint8Array(await stored.arrayBuffer()),
      row.email_key,
      kindFor(env, row.to_address),
      ctx,
    );
    imported++;
  }
  return imported;
}

// The senders of these waiting emails, and how many of the emails still wait.
export async function heldSenders(env: Env, ids: readonly string[]): Promise<{ held: number; senders: string[] }> {
  const rows = (
    await env.DB.prepare(
      "SELECT m.sender FROM json_each(?) j JOIN inbound_mail m ON m.id=j.value WHERE m.state='held' ORDER BY j.key",
    )
      .bind(JSON.stringify(ids))
      .all<{ sender: string }>()
  ).results;
  return { held: rows.length, senders: [...new Set(rows.map((r) => r.sender))] };
}

async function heldFrom(env: Env, senders: readonly string[]): Promise<MailRow[]> {
  return (
    await env.DB.prepare(
      "SELECT * FROM inbound_mail WHERE state='held' AND sender IN (SELECT value FROM json_each(?)) ORDER BY received_at,id",
    )
      .bind(JSON.stringify(senders))
      .all<MailRow>()
  ).results;
}

// Ends these waiting emails in one D1 batch, however many, then deletes each
// stored copy no receipt or other log row still points at. Returns how many it ended.
async function discardHeld(env: Env, rows: readonly MailRow[], state: MailState, reason: string): Promise<number> {
  if (!rows.length) return 0;
  const keys = [...new Set(rows.flatMap((r) => (r.email_key ? [r.email_key] : [])))];
  const [update, unused] = await env.DB.batch<{ id?: string; key?: string }>([
    env.DB.prepare(
      "UPDATE inbound_mail SET state=?,reason=?,email_key=NULL WHERE state='held' AND id IN (SELECT value FROM json_each(?)) RETURNING id",
    ).bind(state, reason, JSON.stringify(rows.map((r) => r.id))),
    env.DB.prepare(
      'SELECT value AS key FROM json_each(?) WHERE NOT EXISTS (SELECT 1 FROM receipts WHERE email_key=value) AND NOT EXISTS (SELECT 1 FROM inbound_mail WHERE email_key=value)',
    ).bind(JSON.stringify(keys)),
  ]);
  const endedIds = new Set(update?.results.map((r) => r.id));
  const ended = rows.filter((r) => endedIds.has(r.id));
  const free = new Set(unused?.results.map((r) => r.key));
  const gone = [...new Set(ended.flatMap((r) => (r.email_key && free.has(r.email_key) ? [r.email_key] : [])))];
  if (gone.length) await env.ORIGINALS.delete(gone);
  return ended.length;
}

// Future mail from the sender is logged only; their waiting mail is deleted.
export async function ignoreSender(env: Env, value: unknown, who: string): Promise<number> {
  return ignoreSenders(env, [senderAddress(value)], who);
}
// The same for checked addresses, in one write of the list.
export async function ignoreSenders(env: Env, senders: readonly string[], who: string): Promise<number> {
  const allowed = config(env).allowedSenders;
  requireInput(
    !senders.some((s) => allowed.has(s)),
    'That sender is approved. Remove it from approved senders in Settings first.',
  );
  const list = JSON.stringify(senders);
  const [count, listed] = await env.DB.batch<{ n: number }>([
    env.DB.prepare('SELECT count(*) AS n FROM ignored_senders'),
    env.DB.prepare('SELECT count(*) AS n FROM ignored_senders WHERE address IN (SELECT value FROM json_each(?))').bind(
      list,
    ),
  ]);
  const fresh = new Set(senders).size - (listed?.results[0]?.n ?? 0);
  requireInput(
    (count?.results[0]?.n ?? 0) + fresh <= MAX_IGNORED,
    `You can ignore up to ${MAX_IGNORED} senders. Remove one in Settings first.`,
  );
  await env.DB.prepare(
    'INSERT INTO ignored_senders (address,added_at,added_by) SELECT value,?,? FROM json_each(?) WHERE true ON CONFLICT(address) DO NOTHING',
  )
    .bind(new Date().toISOString(), who.slice(0, 254), list)
    .run();
  return discardHeld(env, await heldFrom(env, senders), 'ignored', 'sender_ignored');
}

export async function deleteHeld(env: Env, id: string): Promise<void> {
  requireInput(await deleteHeldMail(env, [id]), 'That email is gone already.', 404);
}
// Deletes these waiting emails. Returns how many were still waiting.
export async function deleteHeldMail(env: Env, ids: readonly string[]): Promise<number> {
  const rows = (
    await env.DB.prepare("SELECT * FROM inbound_mail WHERE state='held' AND id IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify(ids))
      .all<MailRow>()
  ).results;
  return discardHeld(env, rows, 'dropped', 'deleted');
}

export async function unignoreSender(env: Env, value: unknown): Promise<void> {
  await unignoreSenders(env, [senderAddress(value)]);
}
// Returns how many were ignored.
export async function unignoreSenders(env: Env, senders: readonly string[]): Promise<number> {
  const result = await env.DB.prepare('DELETE FROM ignored_senders WHERE address IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(senders))
    .run();
  return result.meta.changes ?? 0;
}

export async function removeApproved(env: Env, value: unknown, who: string): Promise<void> {
  requireInput(await removeSenders(env, [senderAddress(value)], who), 'That sender is not on the list.', 404);
}
// Takes these off the allowed list in one write. Returns how many were on it.
export async function removeSenders(env: Env, senders: readonly string[], who: string): Promise<number> {
  const current = [...config(env).allowedSenders];
  const gone = new Set(senders);
  const kept = current.filter((s) => !gone.has(s));
  if (kept.length < current.length) await saveAllowed(env, kept, who);
  return current.length - kept.length;
}
