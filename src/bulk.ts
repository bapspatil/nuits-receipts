import type { Kind } from './domain';
import { escape } from './ui';
import { STATUS } from './status';

// Ids per request, and per all=1 resolution on the server.
export const BULK_CAP = 500;

// Per request for the ops that read documents again with the model.
export const AI_CAP = 10;

export type BulkAction = {
  op: string;
  label: string;
  tone?: 'primary' | 'danger';
  // Shown in a <details> step before the submit button.
  confirm?: string;
  // Trusted HTML for extra inputs inside the step. Avoid `required`: a hidden
  // required field blocks every other button in the bar.
  fields?: string;
  // Per-request cap below BULK_CAP; the client posts in chunks of this size.
  max?: number;
};
export type BulkList = {
  form: string;
  action: string;
  noun: readonly [string, string];
  total: number;
  scope: Record<string, string>;
  actions: BulkAction[];
};

export type Selection = { order: string[]; picked: string[]; anchor: string | null; all: boolean };
export type SelectEvent =
  | { type: 'toggle'; id: string; range: boolean }
  | { type: 'page'; on: boolean }
  | { type: 'all' }
  | { type: 'clear' };

// Shipped to the browser as source, so it may not reference anything outside
// its own body (no helpers, no named inner functions).
export function select(state: Selection, event: SelectEvent): Selection {
  const order = state.order;
  if (event.type === 'clear') return { order, picked: [], anchor: null, all: false };
  if (event.type === 'all') return { order, picked: order.slice(), anchor: state.anchor, all: true };
  if (event.type === 'page')
    return event.on
      ? { order, picked: order.slice(), anchor: state.anchor, all: state.all }
      : { order, picked: [], anchor: state.anchor, all: false };
  const was = new Set(state.picked);
  const on = !was.has(event.id);
  const to = order.indexOf(event.id);
  const from = event.range && state.anchor !== null ? order.indexOf(state.anchor) : -1;
  const span = from < 0 || to < 0 ? [event.id] : order.slice(Math.min(from, to), Math.max(from, to) + 1);
  for (const id of span) {
    if (on) was.add(id);
    else was.delete(id);
  }
  return { order, picked: order.filter((id) => was.has(id)), anchor: event.id, all: on && state.all };
}

export function countOf(state: Selection, total: number): number {
  return state.all ? total : state.picked.length;
}

// Why an action is off: the server refuses all=1 over its cap, so the bar says so first.
export function capped(all: boolean, total: number, max: number): string | null {
  return all && max > 0 && total > max ? 'Up to ' + max + ' at a time' : null;
}

// What Escape does in the bar. Shipped as source, like select.
export function escapeTo(at: { typing: boolean; stepOpen: boolean; picked: boolean }): 'step' | 'clear' | 'none' {
  if (at.stepOpen) return 'step';
  if (at.typing || !at.picked) return 'none';
  return 'clear';
}

// The totals so far, posted with each chunk after the first; the server adds them to its own.
export type Before = { n: number; skipped: number };
// What one post came back with: a redirect, a refusal, or the running totals and banner link.
export type Reply = { url: string } | { error: string } | { n: number; skipped: number; location: string };
// Posts the chunks in turn and never throws: once a post has gone out, a failure
// is reported, not retried, so no row is acted on twice. Shipped as source, like select.
export async function postChunks(
  chunks: string[][],
  post: (ids: string[], before: Before | null) => Promise<Reply | null>,
  step: (sent: number, total: number) => void,
): Promise<{ url: string } | { error: string }> {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const before = { n: 0, skipped: 0 };
  let sent = 0;
  let location = '';
  for (const chunk of chunks) {
    let reply: Reply | null = null;
    try {
      reply = await post(chunk, chunks.length > 1 ? { n: before.n, skipped: before.skipped } : null);
    } catch {
      reply = null;
    }
    const done = sent ? sent + ' of ' + total + ' done. ' : '';
    if (reply && 'url' in reply && typeof reply.url === 'string') return { url: reply.url };
    if (reply && 'error' in reply && typeof reply.error === 'string') return { error: done + reply.error };
    if (!reply || !('n' in reply) || typeof reply.n !== 'number' || typeof reply.location !== 'string')
      return { error: done + 'That did not work. Reload to see what changed.' };
    before.n = reply.n;
    before.skipped = typeof reply.skipped === 'number' ? reply.skipped : 0;
    location = reply.location;
    sent += chunk.length;
    step(sent, total);
  }
  return { url: location };
}

export function bulkCheck(list: BulkList, id: string, name: string): string {
  return `<label class="pick"><input type="checkbox" name="id" value="${escape(id)}" form="${escape(list.form)}"><span class="vh">Select ${escape(name)}</span></label>`;
}

// `href` is the other mode's URL: ?select=1 to enter, the plain list to leave.
export function bulkTools(list: BulkList, pageCount: number, selecting: boolean, href: string): string {
  if (!pageCount) return '';
  return `<div class="bulktools"><label class="pick" hidden><input type="checkbox" data-bulk-page><span class="vh">Select all ${pageCount} ${escape(list.noun[pageCount === 1 ? 0 : 1])} on this page</span></label><a class="linkbtn" href="${escape(href)}" data-bulk-select>${selecting ? 'Done' : 'Select'}</a></div>`;
}

const toneClass = (tone: BulkAction['tone']) =>
  tone === 'primary' ? 'btn primary' : tone === 'danger' ? 'btn danger' : 'btn';

function actionHtml(action: BulkAction): string {
  const submit = (cls: string) =>
    `<button name="op" value="${escape(action.op)}" class="${cls}"${action.max ? ` data-max="${action.max}"` : ''}>${escape(action.label)}</button>`;
  if (!action.confirm && !action.fields) return submit(toneClass(action.tone));
  return `<details class="bulkstep"><summary class="${toneClass(action.tone)}">${escape(action.label)}</summary><div class="body">${action.fields ?? ''}${
    action.confirm ? `<p class="ask">${escape(action.confirm)}</p>` : ''
  }${submit(action.tone === 'danger' ? 'btn danger' : 'btn primary')}</div></details>`;
}

export function bulkBar(list: BulkList): string {
  const scope = Object.entries(list.scope)
    .map(([name, value]) => `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`)
    .join('');
  const shown = list.actions.slice(0, 3).map(actionHtml).join('');
  const more = list.actions.slice(3);
  return `<form id="${escape(list.form)}" class="bulkbar" data-bulk data-total="${list.total}" data-noun="${escape(list.noun.join('|'))}" method="post" action="${escape(list.action)}">${scope}<input type="hidden" name="all" value=""><p class="bulkcount"><output data-bulk-count aria-live="polite"></output><span class="bulkstatus" data-bulk-status aria-live="polite"></span></p>${
    list.total <= BULK_CAP
      ? `<button type="button" class="linkbtn" data-bulk-all hidden>Select all ${list.total} ${escape(list.noun[list.total === 1 ? 0 : 1])}</button>`
      : ''
  }<button type="reset" class="linkbtn">Clear</button><div class="bulkacts">${shown}${
    more.length
      ? `<details class="bulkmore"><summary class="btn">More</summary><div class="body">${more.map(actionHtml).join('')}</div></details>`
      : ''
  }</div><progress hidden max="1" value="0"></progress></form>`;
}

// The receipt lists' actions; src/batch.ts runs each op.
export type ReceiptOp = 'approve' | 'discard' | 'restore' | 'retry' | 'kind' | 'paid';
const chip = (name: string, value: string, label: string, on = false) =>
  `<label class="chip"><input type="radio" name="${name}" value="${value}"${on ? ' checked' : ''}>${escape(label)}</label>`;
export const RECEIPT_ACTIONS = {
  approve: {
    op: 'approve',
    label: 'Approve',
    tone: 'primary',
    confirm: 'Approve the selected receipts as they are?',
    fields:
      '<label class="bulkfield">Reason<input type="text" name="approval_reason" value="Checked against the original" maxlength="1000"></label>',
  },
  discard: { op: 'discard', label: 'Discard', tone: 'danger' },
  restore: { op: 'restore', label: 'Restore' },
  retry: { op: 'retry', label: 'Read again', max: AI_CAP },
  kind: (from: Kind) => ({
    op: 'kind',
    label: 'Move',
    max: AI_CAP,
    fields: `<div class="reasons" role="group" aria-label="Move to">${chip('to', 'sales', 'Sales invoices', from === 'expense')}${chip('to', 'expense', 'Receipts', from === 'sales')}</div>`,
  }),
  paid: (today: string) => ({
    op: 'paid',
    label: 'Paid',
    tone: 'primary',
    fields: `<label class="bulkfield">Paid on<input type="date" name="paid_outside_on" value="${escape(today)}"></label><label class="bulkfield">How<input type="text" name="paid_outside_note" maxlength="300" placeholder="Stripe payout 14 Oct"></label>`,
  }),
} as const satisfies Record<
  ReceiptOp,
  (BulkAction & { op: ReceiptOp }) | ((...a: never[]) => BulkAction & { op: ReceiptOp })
>;

// Bank's actions; src/batch.ts runs each op.
export type PaymentOp = 'match' | 'exempt' | 'require' | 'unmatch';
export const PAYMENT_ACTIONS = [
  { op: 'match', label: 'Match', tone: 'primary' },
  { op: 'exempt', label: STATUS.notPurchase },
  { op: 'require', label: 'Needs receipt' },
  {
    op: 'unmatch',
    label: 'Remove match',
    tone: 'danger',
    confirm: 'Remove the matches of the selected payments? They will not be matched again on their own.',
  },
] as const satisfies readonly (BulkAction & { op: PaymentOp })[];

// Unknown senders' held mail by email, and Settings > Senders by address.
export type SenderOp = 'allow' | 'ignore' | 'delete' | 'remove' | 'unignore';
export const SENDER_ACTIONS = {
  allow: { op: 'allow', label: 'Allow', tone: 'primary' },
  ignore: { op: 'ignore', label: 'Ignore' },
  delete: { op: 'delete', label: 'Delete', tone: 'danger', confirm: 'Delete the selected emails?' },
  remove: {
    op: 'remove',
    label: 'Remove',
    tone: 'danger',
    confirm: 'Remove the selected senders? Their next emails wait in Review.',
  },
  unignore: { op: 'unignore', label: 'Stop ignoring' },
} as const satisfies { [K in SenderOp]: BulkAction & { op: K } };

// Runs once per bar: reducer state, rendering, keys, long-press and posting.
// A plain string like ADD_JS, since the worker build has no DOM types.
const CLIENT = `({ select, capped, escapeTo, postChunks }) => {
  const typing = (el) => !!(el && el.closest && el.closest('input:not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable]'));
  document.querySelectorAll('form[data-bulk]').forEach((form) => {
    // form.id would return the checkboxes named id, not the attribute.
    const id = form.getAttribute('id');
    const wrap = document.querySelector('[data-bulk-list="' + id + '"]');
    const boxes = Array.from(document.querySelectorAll('input[form="' + id + '"][name=id]'));
    if (!wrap || !boxes.length) return;
    const total = Number(form.dataset.total) || boxes.length;
    const noun = (form.dataset.noun || '|').split('|');
    const count = form.querySelector('[data-bulk-count]');
    const status = form.querySelector('[data-bulk-status]');
    const allButton = form.querySelector('[data-bulk-all]');
    const allInput = form.querySelector('input[name=all]');
    const progress = form.querySelector('progress');
    const page = wrap.querySelector('[data-bulk-page]');
    const toggle = wrap.querySelector('[data-bulk-select]');
    const rowOf = (box) => box.closest('li,tr') || box.parentElement;
    const boxIn = (el) => {
      const row = el && el.closest && el.closest('li,tr');
      return row ? boxes.find((b) => row.contains(b)) : undefined;
    };
    let state = { order: boxes.map((b) => b.value), picked: boxes.filter((b) => b.checked).map((b) => b.value), anchor: null, all: false };
    let sending = false;
    let native = false;
    const say = (text, bad) => {
      status.textContent = text;
      status.classList.toggle('bad', !!bad);
    };
    const close = () => form.querySelectorAll('details[open]').forEach((d) => { d.open = false; });
    const limited = Array.from(form.querySelectorAll('button[data-max]'));
    const render = () => {
      const on = new Set(state.picked);
      boxes.forEach((b) => { b.checked = on.has(b.value); });
      const n = state.all ? total : on.size;
      form.dataset.count = String(n);
      wrap.dataset.count = String(n);
      count.textContent = state.all ? 'All ' + n + ' selected' : n + ' selected';
      allInput.value = state.all ? '1' : '';
      if (page) {
        page.checked = on.size === boxes.length;
        page.indeterminate = on.size > 0 && on.size < boxes.length;
      }
      if (allButton) allButton.hidden = state.all || total <= boxes.length || on.size < boxes.length;
      limited.forEach((b) => {
        const why = capped(state.all, total, Number(b.dataset.max));
        b.disabled = !!why;
        if (why) {
          b.setAttribute('aria-disabled', 'true');
          b.title = why;
        } else {
          b.removeAttribute('aria-disabled');
          b.removeAttribute('title');
        }
      });
      if (!n) close();
    };
    const apply = (event) => {
      state = select(state, event);
      say('');
      render();
    };
    const mode = (on) => {
      if (on) wrap.dataset.selecting = '';
      else delete wrap.dataset.selecting;
      if (toggle) toggle.textContent = on ? 'Done' : 'Select';
    };
    boxes.forEach((b) => b.addEventListener('click', (e) => apply({ type: 'toggle', id: b.value, range: e.shiftKey })));
    if (page) {
      page.closest('label').hidden = false;
      page.addEventListener('change', () => apply({ type: 'page', on: page.checked }));
    }
    if (allButton) allButton.addEventListener('click', () => apply({ type: 'all' }));
    if (toggle)
      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        const on = !('selecting' in wrap.dataset);
        mode(on);
        if (!on) apply({ type: 'clear' });
      });
    form.addEventListener('reset', (e) => {
      e.preventDefault();
      apply({ type: 'clear' });
    });
    const keys = (e) => {
      if (e.key === 'Escape') {
        const open = Array.from(form.querySelectorAll('details[open]'));
        const to = escapeTo({ typing: typing(e.target), stepOpen: open.length > 0, picked: state.picked.length > 0 || state.all });
        if (to === 'step') {
          // Document order lists More before a step nested in it: the last is innermost.
          const step = open[open.length - 1];
          step.open = false;
          step.querySelector('summary').focus();
        } else if (to === 'clear') apply({ type: 'clear' });
        return;
      }
      if (!wrap.contains(e.target) || typing(e.target) || e.altKey) return;
      if ((e.key === 'x' || e.key === 'X') && !e.metaKey && !e.ctrlKey) {
        const box = boxIn(e.target);
        if (!box) return;
        e.preventDefault();
        apply({ type: 'toggle', id: box.value, range: e.shiftKey });
      } else if ((e.key === 'a' || e.key === 'A') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        apply({ type: 'page', on: true });
      }
    };
    wrap.addEventListener('keydown', keys);
    form.addEventListener('keydown', keys);
    let timer = 0;
    let pressed = false;
    wrap.addEventListener('touchstart', (e) => {
      pressed = false;
      clearTimeout(timer);
      const box = boxIn(e.target);
      if (!box || e.touches.length > 1) return;
      timer = setTimeout(() => {
        pressed = true;
        mode(true);
        apply({ type: 'toggle', id: box.value, range: false });
      }, 500);
    }, { passive: true });
    ['touchmove', 'touchend', 'touchcancel'].forEach((t) => wrap.addEventListener(t, () => clearTimeout(timer), { passive: true }));
    // The click that ends a long press must not also open the row or flip the box back.
    wrap.addEventListener('click', (e) => {
      if (!pressed) return;
      pressed = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);
    wrap.addEventListener('contextmenu', (e) => { if (pressed) e.preventDefault(); });
    const busy = (rows, on) => rows.forEach((r) => {
      r.classList.toggle('is-pending', on);
      if (on) r.setAttribute('aria-busy', 'true');
      else r.removeAttribute('aria-busy');
    });
    const send = async (button) => {
      sending = true;
      const max = Number(button.dataset.max) || 0;
      const ids = state.all ? [] : state.picked.slice();
      const rows = boxes.filter((b) => b.checked).map(rowOf);
      busy(rows, true);
      const base = new FormData(form);
      base.delete('id');
      base.set('op', button.value);
      const chunks = [];
      if (!max || state.all) chunks.push(ids);
      else for (let i = 0; i < ids.length; i += max) chunks.push(ids.slice(i, i + max));
      const many = chunks.length > 1;
      if (many) {
        progress.max = ids.length;
        progress.value = 0;
        progress.hidden = false;
      }
      const post = async (chunk, before) => {
        const body = new FormData();
        base.forEach((v, k) => body.append(k, v));
        chunk.forEach((v) => body.append('id', v));
        if (before) {
          body.set('done_before', String(before.n));
          body.set('skipped_before', String(before.skipped));
        }
        const res = await fetch(form.getAttribute('action'), { method: 'POST', body, headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        if (res.redirected) return { url: res.url };
        const type = res.headers.get('Content-Type') || '';
        const json = type.indexOf('json') >= 0 ? await res.json() : null;
        if (res.ok) return json;
        return { error: json && json.error ? json.error : type.indexOf('text/plain') === 0 ? await res.text() : 'That did not work. Try again.' };
      };
      const end = await postChunks(chunks, post, (sent, all) => {
        if (!many) return;
        progress.value = sent;
        say(sent + ' of ' + all + ' ' + noun[1]);
      });
      if ('url' in end) return location.assign(end.url);
      busy(rows, false);
      progress.hidden = true;
      sending = false;
      say(end.error, true);
    };
    // Native submit only when nothing was posted yet: postChunks never throws.
    form.addEventListener('submit', (e) => {
      const button = e.submitter;
      if (native || !window.fetch || !window.FormData || !button || button.name !== 'op') return;
      e.preventDefault();
      if (sending) return;
      send(button).catch(() => {
        native = true;
        if (form.requestSubmit) return form.requestSubmit(button);
        const op = document.createElement('input');
        op.type = 'hidden';
        op.name = 'op';
        op.value = button.value;
        form.append(op);
        HTMLFormElement.prototype.submit.call(form);
      });
    });
    render();
  });
}`;

// The pure helpers the script runs, as source.
export const BULK_HELPERS = `{ select: ${select.toString()}, capped: ${capped.toString()}, escapeTo: ${escapeTo.toString()}, postChunks: ${postChunks.toString()} }`;
export const BULK_JS = `(${CLIENT})(${BULK_HELPERS});`;
