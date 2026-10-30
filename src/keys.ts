// Keyboard shortcuts for a desktop, and the pending cue on submit. One script, served at
// /assets/keys.js on every page, and one table that the `?` sheet and Help both print.
import { button } from './actions';
import { escape } from './ui';

export type KeyGroup = { title: string; keys: readonly { keys: readonly string[]; does: string }[] };

export const KEY_GROUPS: readonly KeyGroup[] = [
  {
    title: 'On a list',
    keys: [
      { keys: ['j', 'k'], does: 'Move to the next or the previous row' },
      { keys: ['x'], does: 'Select or unselect the row you are on' },
      { keys: ['Enter'], does: 'Open the row you are on' },
    ],
  },
  {
    title: 'On a receipt',
    keys: [
      { keys: ['a'], does: 'Approve' },
      { keys: ['s'], does: 'Skip' },
    ],
  },
  {
    title: 'Everywhere',
    keys: [
      { keys: ['u'], does: 'Undo, when the message at the top offers it' },
      { keys: ['/'], does: 'Search, on a page that has a search field' },
      { keys: ['?'], does: 'Show these shortcuts' },
      { keys: ['Esc'], does: 'Close this window' },
    ],
  },
];

export const KEYS_NOTE = 'The keys are off while you type in a field, and on a phone or tablet.';

export const SHEET_ID = 'keys-sheet';
export function keysSheet(): string {
  const groups = KEY_GROUPS.map(
    (g) =>
      `<h3>${escape(g.title)}</h3><dl class="keys-list">${g.keys
        .map(
          (k) =>
            `<div><dt>${k.keys.map((key) => `<kbd>${escape(key)}</kbd>`).join(' ')}</dt><dd>${escape(k.does)}</dd></div>`,
        )
        .join('')}</dl>`,
  ).join('');
  return `<dialog id="${SHEET_ID}" class="keys-sheet" aria-labelledby="${SHEET_ID}-title"><h2 id="${SHEET_ID}-title">Keyboard shortcuts</h2>${groups}<p class="small">${escape(KEYS_NOTE)}</p><form method="dialog">${button('close')}</form></dialog>`;
}

// Plain string like ADD_JS: the worker build has no DOM types.
export const KEYS_JS = `(() => {
  const sheet = document.getElementById('${SHEET_ID}');
  const touch = matchMedia('(hover: none) and (pointer: coarse)');
  const typing = (el) => !!(el && el.closest && el.closest('input:not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable]'));
  const shown = (el) => el.getClientRects().length > 0;
  const press = (selector) => {
    const el = document.querySelector(selector);
    if (!el || el.disabled) return false;
    el.click();
    return true;
  };
  const step = (by) => {
    const rows = Array.from(document.querySelectorAll('[data-row]')).filter(shown);
    if (!rows.length) return;
    const now = rows.indexOf(document.activeElement && document.activeElement.closest('[data-row]'));
    rows[now < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, now + by))].focus();
  };
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || touch.matches) return;
    if (typing(e.target) || document.querySelector('dialog[open]')) return;
    const key = e.key;
    if (e.shiftKey && key !== '?') return;
    const row = document.activeElement && document.activeElement.hasAttribute('data-row') ? document.activeElement : null;
    let used = true;
    if (key === 'j') step(1);
    else if (key === 'k') step(-1);
    else if (key === 'Enter' && row && e.target === row) {
      const link = row.querySelector('a[href]');
      if (link) link.click();
      else used = false;
    } else if (key === 'a') used = press('.sbar button[name=action][value=approve]');
    else if (key === 's') used = press('.sbar button[name=action][value=skip]');
    else if (key === 'u') {
      const form = document.querySelector('#banner form');
      if (form) form.requestSubmit(form.querySelector('button'));
      else used = false;
    } else if (key === '/') {
      const field = document.querySelector('input[type=search]');
      if (field && shown(field)) {
        field.focus();
        field.select();
      } else used = false;
    } else if (key === '?' && sheet) sheet.showModal();
    else used = false;
    if (used) e.preventDefault();
  });
  if (sheet) sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });

  // The pending cue: once a form is on its way, the button that sent it can't send it again. The
  // server still treats an action that is already resolved as a quiet redirect. Bulk bars show their
  // own pending state. A GET form can end in a download, so it keeps its button.
  const waiting = new Set();
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form.matches || form.matches('form[data-bulk]') || form.method !== 'post') return;
    const by = e.submitter;
    // The browser reads the button's name and value after this event, so disable it a tick later.
    setTimeout(() => {
      if (e.defaultPrevented) return;
      form.setAttribute('aria-busy', 'true');
      waiting.add(form);
      if (by) {
        by.disabled = true;
        waiting.add(by);
      }
    }, 0);
  });
  addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    waiting.forEach((el) => {
      if (el.matches('form')) el.removeAttribute('aria-busy');
      else el.disabled = false;
    });
    waiting.clear();
  });
})();
`;
