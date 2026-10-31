// Quick find: ⌘K (or Ctrl+K) on any page, or / where the page has no search field, opens a box
// that lists the first matches as you type. It is a lookup, not a second way to navigate: Enter
// follows a match's own link, or sends the words to Home's search, which is also what the form
// does without script.
import { button } from './actions';

export const FIND_ID = 'find';

export function findSheet(): string {
  return `<dialog id="${FIND_ID}" class="keys-sheet qfind" aria-labelledby="${FIND_ID}-title"><h2 id="${FIND_ID}-title">Find a file</h2><form method="get" action="/" role="search"><label for="${FIND_ID}-q">Words, an amount or a date</label><input id="${FIND_ID}-q" name="q" type="search" maxlength="300" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="${FIND_ID}-list" aria-autocomplete="list"></form><ul id="${FIND_ID}-list" class="qfindlist" role="listbox" aria-label="Matches"></ul><p class="small" data-said aria-live="polite"></p><form method="dialog">${button('close')}</form></dialog>`;
}

export const FIND_CSS = `.qfind{width:min(36rem,calc(100vw - 2rem))}
.qfind form[role=search]{display:grid;gap:var(--space-1)}
.qfind input{width:100%;min-height:48px;font-size:var(--text-lg)}
.qfindlist{list-style:none;margin:var(--space-3) 0 0;padding:0;display:grid;gap:var(--space-1)}
.qfindlist a{display:grid;gap:var(--space-1);min-height:44px;padding:var(--space-2) var(--space-3);border-radius:var(--radius-sm);color:var(--text);text-decoration:none}
.qfindlist a span{font:400 var(--text-sm)/1.3 var(--font-num);color:var(--text-muted)}
.qfindlist a:hover,.qfindlist a[aria-selected=true]{background:var(--surface-accent-quiet)}`;

// Plain string like KEYS_JS: the worker build has no DOM types. Addresses resolve against the
// form's action, so an install under a base path asks its own /search.json.
export const FIND_JS = `(() => {
  const box = document.getElementById('${FIND_ID}');
  if (!box) return;
  const form = box.querySelector('form[role=search]');
  const input = box.querySelector('input');
  const list = box.querySelector('ul');
  const said = box.querySelector('[data-said]');
  const at = (path) => new URL(path.replace(/^\\//, ''), form.action);
  let picked = -1;
  let asked = 0;
  let timer = 0;
  const links = () => Array.from(list.querySelectorAll('a'));
  const pick = (n) => {
    const all = links();
    picked = all.length ? (n + all.length) % all.length : -1;
    all.forEach((a, i) => a.setAttribute('aria-selected', String(i === picked)));
    if (picked < 0) input.removeAttribute('aria-activedescendant');
    else {
      input.setAttribute('aria-activedescendant', all[picked].id);
      all[picked].scrollIntoView({ block: 'nearest' });
    }
  };
  const show = (found, q) => {
    list.replaceChildren(...found.map((f, i) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.id = '${FIND_ID}-' + i;
      a.href = at(f.href).href;
      a.setAttribute('role', 'option');
      a.tabIndex = -1;
      a.append(f.name);
      const line = document.createElement('span');
      line.textContent = f.line;
      a.append(line);
      li.append(a);
      return li;
    }));
    input.setAttribute('aria-expanded', String(found.length > 0));
    said.textContent = !q ? '' : found.length ? found.length + (found.length === 1 ? ' match. Enter opens it.' : ' matches. Arrows pick one, Enter opens it.') : 'Nothing matches. Enter searches Home.';
    pick(found.length ? 0 : -1);
  };
  const ask = async () => {
    const q = input.value.trim();
    const n = ++asked;
    if (!q) return show([], '');
    try {
      const r = await fetch(at('/search.json?q=' + encodeURIComponent(q)), { credentials: 'same-origin' });
      const found = r.ok ? await r.json() : [];
      if (n === asked) show(found, q);
    } catch {
      if (n === asked) said.textContent = 'Search is not answering. Enter searches Home.';
    }
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(ask, 120);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') pick(picked + 1);
    else if (e.key === 'ArrowUp') pick(picked - 1);
    else if (e.key === 'Enter' && picked >= 0) location.href = links()[picked].href;
    else return;
    e.preventDefault();
  });
  const open = () => {
    if (box.open) return input.select();
    box.showModal();
    input.select();
    if (input.value.trim()) ask();
  };
  box.addEventListener('click', (e) => { if (e.target === box) box.close(); });
  document.addEventListener('quickfind', open);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      open();
    }
  });
})();
`;
