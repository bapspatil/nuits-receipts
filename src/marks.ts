// What the owner adds to an archive item: a star, tags and a note, keyed by its item key
// (src/archive.ts), so a receipt, a document, a statement and a package take them alike. Also the
// searches kept as folders, and the record of what was opened lately.
import type { Env } from './env';
import { requireInput } from './domain';
import { withDone } from './events';
import { itemKey, parseItem, type Item } from './archive';
import { normaliseTag } from './search';
import { parseReturn } from './worklist';

const RECENT_KEEP = 50;

function item(form: FormData): string {
  const parsed = parseItem(String(form.get('item') ?? ''));
  requireInput(parsed && parsed.type !== 'mail', 'This page is out of date. Reload it and try again.', 400);
  return itemKey(parsed);
}
// Back to Home as it was, with the item open; anything else goes to Home.
function back(form: FormData): string {
  const text = String(form.get('back') ?? '');
  return (/^\/\?[^#]{0,600}$/.test(text) || text === '/' ? text : parseReturn(text)) ?? '/';
}

export async function markAction(env: Env, path: string, form: FormData): Promise<string> {
  const key = item(form);
  const to = back(form);
  if (path === '/marks/star') {
    const on = form.get('on') === '1';
    await env.DB.prepare(
      'INSERT INTO marks(item,starred_at) VALUES (?,?) ON CONFLICT(item) DO UPDATE SET starred_at=excluded.starred_at',
    )
      .bind(key, on ? new Date().toISOString() : null)
      .run();
    return withDone(on ? 'starred' : 'unstarred', to, { item: key, back: to });
  }
  if (path === '/marks/tag' || path === '/marks/untag') {
    const tag = normaliseTag(String(form.get('tag') ?? ''));
    requireInput(/^[^\s]{1,40}$/.test(tag), 'Type a tag of up to 40 characters', 400);
    await env.DB.prepare(
      path === '/marks/tag'
        ? 'INSERT OR IGNORE INTO tags(item,tag) VALUES (?,?)'
        : 'DELETE FROM tags WHERE item=? AND tag=?',
    )
      .bind(key, tag)
      .run();
    return withDone(path === '/marks/tag' ? 'tagged' : 'untagged', to, { item: key, tag, back: to });
  }
  requireInput(path === '/marks/note', 'Not found', 404);
  const note = String(form.get('note') ?? '').trim();
  requireInput(note.length <= 2000, 'Keep the note under 2000 characters', 400);
  await env.DB.prepare('INSERT INTO marks(item,note) VALUES (?,?) ON CONFLICT(item) DO UPDATE SET note=excluded.note')
    .bind(key, note || null)
    .run();
  return withDone('noteSaved', to);
}

// A search kept as a folder: its name and the Home address it opens.
export async function saveSearch(env: Env, form: FormData): Promise<string> {
  const name = String(form.get('name') ?? '')
    .trim()
    .slice(0, 60);
  const query = String(form.get('query') ?? '');
  requireInput(name, 'Give the search a name', 400);
  requireInput(/^\/(\?[^#]{1,290})?$/.test(query), 'This page is out of date. Reload it and try again.', 400);
  await env.DB.prepare('INSERT INTO saved_searches(name,query,created_at) VALUES (?,?,?)')
    .bind(name, query, new Date().toISOString())
    .run();
  return withDone('searchSaved', query, { name });
}
export async function removeSearch(env: Env, id: number): Promise<string> {
  await env.DB.prepare('DELETE FROM saved_searches WHERE id=?').bind(id).run();
  return withDone('searchRemoved', '/');
}

// Opening an item records it; the newest RECENT_KEEP stay.
export async function recordView(env: Env, opened: Item): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO recent_views(item,viewed_at) VALUES (?,?) ON CONFLICT(item) DO UPDATE SET viewed_at=excluded.viewed_at',
    ).bind(itemKey(opened), new Date().toISOString()),
    env.DB.prepare(
      'DELETE FROM recent_views WHERE item NOT IN (SELECT item FROM recent_views ORDER BY viewed_at DESC LIMIT ?)',
    ).bind(RECENT_KEEP),
  ]);
}
