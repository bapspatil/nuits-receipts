// The five journeys as a person does them in the current UI. When the UI
// changes, change the steps here and keep the journey names, so runs stay
// comparable. Seeding (mail arriving, files on disk) is never counted.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const scratch = mkdtempSync(join(tmpdir(), 'ux-journeys-'));
const nav = (page, href) => page.locator(`nav a[href="${href}"]:visible`);
const button = (page, name) => page.getByRole('button', { name, exact: true });
const approve = /^Approve (receipt|invoice)$/;
const link = (page, name) => page.getByRole('link', { name, exact: true });

async function pdf(name, lines) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Courier);
  const p = doc.addPage([420, 300]);
  lines.forEach((line, i) => p.drawText(line, { x: 24, y: 270 - i * 16, size: 10, font }));
  const file = join(scratch, name);
  writeFileSync(file, await doc.save());
  return file;
}

// What a careful person types after looking at the original.
const CORRECTIONS = {
  'Sample Coffee Corner': { issue_date: '2026-09-10' },
  'Sample Train Line': { net: '21.27', vat: '2.13', vat_rate: '10' },
  'Sample Print Shop': { currency: 'EUR', total: '30.00', net: '23.90', vat: '6.10', vat_rate: '25.5' },
  'Sample Client Oy': {},
};

async function fixAndApprove(page, rec) {
  const vendor = (await page.locator('h1').first().innerText()).trim();
  const values = CORRECTIONS[vendor] ?? {};
  for (const [name, value] of Object.entries(values)) {
    const input = page.locator(`form.fix [name="${name}"]`).first();
    if (!(await input.isVisible()))
      await rec.click(page.locator('form.fix summary', { hasText: /^(All fields|Other fields|Edit)$/ }));
    if ((await input.evaluate((e) => e.tagName)) === 'SELECT') await rec.select(input, value);
    else await rec.fill(input, value);
  }
  await rec.click(button(page, approve));
  return vendor;
}

export const journeys = [
  {
    name: 'd. First run to first receipt read',
    async run(page, rec, { SAMPLES }) {
      await rec.goto('/');
      const steps = await page.locator('main').innerText();
      rec.note(`Welcome screen says: ${steps.replace(/\s+/g, ' ').slice(0, 160)}`);
      await rec.upload(page.locator('main input[type=file]'), join(SAMPLES, 'sample.pdf'));
      await rec.click(button(page, 'Upload'));
      rec.note(
        `Landed on ${new URL(page.url()).pathname.replace(/[a-f0-9]{64}/, ':id')} with title "${await page.locator('h1').first().innerText()}"`,
      );
      await rec.goto('/');
      rec.note(
        `Home after the first receipt: ${(await page.locator('main .setup').innerText()).replace(/\s+/g, ' ').slice(0, 220)}`,
      );
      await rec.click(page.locator('main .setup a', { hasText: /accountant/i }));
      await rec.fill(page.locator('[name=ACCOUNTANT_LABEL]'), 'Example Accounting Oy');
      await rec.click(page.locator('.sbar button.btn'));
      rec.note(`Saved: ${(await page.locator('main [role=status]').first().innerText()).trim()}`);
    },
  },
  {
    name: 'a. Mail arrives, every receipt approved',
    async seed(page, { MAIL, sendEmail, receiptHtml }) {
      for (const [i, fields] of MAIL.entries())
        await sendEmail(`receipt-${i}`, 'owner@example.com', receiptHtml(fields));
      await page.waitForTimeout(1500);
    },
    async run(page, rec, helpers) {
      await this.seed(page, helpers);
      await rec.goto('/');
      const home = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
      rec.note(`Home on arrival (oldest month not sent): ${home.slice(0, 200)}`);
      await rec.click(page.locator('main .steps a[href^="/receipts?view=todo"]'));
      const queue = await page.locator('main a[href^="/receipts/"]').count();
      rec.note(`Receipts To do lists ${queue} receipts.`);
      await rec.click(page.locator('main a.btn.primary[href^="/receipts/"]'));
      const approved = [];
      for (let i = 0; i < 10 && /\/receipts\/[a-f0-9]{64}/.test(page.url()); i++)
        approved.push(await fixAndApprove(page, rec));
      rec.note(`Approved ${approved.length}: ${approved.join(', ')}. Ended on ${new URL(page.url()).pathname}.`);
    },
  },
  {
    name: 'b. Bank statement imported, every payment settled',
    async run(page, rec, { BANK }) {
      const file = join(scratch, 'statement.csv');
      writeFileSync(file, BANK);
      await rec.click(nav(page, '/payments'));
      await rec.click(link(page, 'Import statement'));
      await rec.upload(page.locator('input[name=file]'), file);
      await rec.click(button(page, 'Import statement'));
      rec.note(`After import: ${(await page.locator('main p.summary').first().innerText()).trim()}`);
      rec.note(
        `Import banner: ${(await page.locator('main [role=status]').first().innerText()).replace(/\s+/g, ' ').trim()}`,
      );
      const row = (merchant) => page.locator('li.row', { hasText: merchant });
      // A likely pair is one button: "Match", or "Match anyway" when the names differ.
      const likely = row('DOMAINDESK').getByRole('button', { name: /^Match( anyway)?$/ });
      if (await likely.count()) {
        rec.note(
          `DOMAINDESK offers: ${(await likely.innerText()).trim()}. ${(await row('DOMAINDESK').locator('.likely__why').innerText()).trim()}`,
        );
        await rec.click(likely);
      }
      if (await row('Sample Missing Vendor').getByRole('button', { name: 'Not a purchase' }).count())
        await rec.click(row('Sample Missing Vendor').getByRole('button', { name: 'Not a purchase' }));
      rec.note(`Finally: ${(await page.locator('main p.summary').first().innerText()).trim()}`);
    },
  },
  {
    name: 'e. Sales invoice added, money in matched',
    async run(page, rec) {
      const file = await pdf('invoice.pdf', [
        'vendor: Example Studio Oy',
        'client: Sample Client Oy',
        'invoice_number: INV-2026-001',
        'issue_date: 2026-09-10',
        'due_date: 2026-09-24',
        'currency: EUR',
        'net: 100.00',
        'vat_rate: 25.5',
        'vat_amount: 25.50',
        'total: 125.50',
      ]);
      await rec.click(nav(page, '/receipts'));
      // Receipts opens on To do; the kind tabs are in All.
      await rec.click(page.locator('main a[data-view="all"]'));
      await rec.click(page.locator('main nav.seg a[href*="kind=sales"]'));
      await rec.click(link(page, 'Add invoice'));
      if (!(await page.locator('input[name=kind][value=sales]').isChecked()))
        await rec.click(page.locator('input[name=kind][value=sales]'));
      await rec.upload(page.locator('input[name=file]'), file);
      await rec.click(button(page, 'Upload'));
      await page.waitForTimeout(2000);
      rec.note(
        `After upload: ${new URL(page.url()).pathname} says "${(await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 160)}"`,
      );
      if (await button(page, approve).count()) await fixAndApprove(page, rec);
      await rec.click(nav(page, '/payments'));
      if (!(await page.locator('main h1', { hasText: 'September' }).count()))
        await rec.click(page.locator('main a[href$="month=2026-09"]'));
      if (!(await page.locator('li.row', { hasText: 'Sample Client Oy' }).count()))
        await rec.click(page.locator('main a[href*="view=all"]'));
      const money = page.locator('li.row', { hasText: 'Sample Client Oy' });
      rec.note(`Money-in row: ${(await money.innerText()).replace(/\s+/g, ' ').trim()}`);
      if (await money.locator('select').count()) {
        await rec.select(money.locator('select'), { index: 1 });
        await rec.click(money.getByRole('button', { name: 'Match' }));
      }
    },
  },
  {
    name: 'c. September closed and marked sent',
    async run(page, rec) {
      await rec.click(nav(page, '/'));
      rec.note(
        `Home on arrival (September, the oldest month not sent): ${(await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 200)}`,
      );
      const download = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
      const zip = page
        .getByRole('link', { name: /ZIP|Download/ })
        .or(page.getByRole('button', { name: /ZIP|Download/ }));
      await zip.first().click();
      rec.clicks++;
      const file = await download;
      rec.note(file ? `Downloaded ${file.suggestedFilename()}` : 'No download started');
      await page.waitForLoadState('load');
      await rec.click(button(page, 'Mark as sent').or(page.getByRole('button', { name: /sent/ })));
    },
  },
];

// Screens to photograph and axe-check after the journeys, with real ids.
// A keyboard-only run from Receipts To do to the first receipt: Tab to Start checking, open it, Tab into a field, type,
// and press Enter. Enter must approve (this receipt is incomplete, so the refusal comes back in
// place); Skip, Discard or Read again would redirect or post elsewhere.
async function keyboardCheck(page, base) {
  await page.goto(base + '/receipts?view=todo');
  for (
    let i = 0;
    i < 40 && !(await page.evaluate(() => document.activeElement?.matches('main a.btn.primary[href^="/receipts/"]')));
    i++
  )
    await page.keyboard.press('Tab');
  await Promise.all([page.waitForURL(/\/receipts\/[a-f0-9]{64}/), page.keyboard.press('Enter')]);
  for (
    let i = 0;
    i < 40 && !(await page.evaluate(() => document.activeElement?.matches('form.fix input[name=total]')));
    i++
  )
    await page.keyboard.press('Tab');
  await page.keyboard.type('30.00');
  const [post] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && /\/receipts\/[a-f0-9]{64}$/.test(r.url())),
    page.keyboard.press('Enter'),
  ]);
  if (post.status() !== 422 || !(await page.locator('main [role=alert]').innerText()).includes('Nothing was saved'))
    throw new Error(`Enter in a field did not approve (status ${post.status()}, now at ${page.url()})`);
  console.log('keyboard: Receipts To do to first receipt, fill a field, Enter approves');
}

// Put three payments back to "Missing" so Bank shows likely pairs, a Match all and a payment nothing fits.
async function unsettleBank(page, base) {
  const bank = () => page.goto(base + '/payments?month=2026-09&view=all');
  const open = async (merchant, button) => {
    const row = page.locator('li.row', { hasText: merchant });
    await row.locator('summary', { hasText: 'More' }).click();
    await row.getByRole('button', { name: button }).click();
    await page.waitForLoadState('load');
    await bank();
  };
  await bank();
  // First, so its reconcile cannot match the others again.
  await open('Sample Missing Vendor', 'Needs a receipt');
  for (const merchant of ['Sample Cloud Lantern Oy', 'DOMAINDESK', 'Sample Train Line'])
    await open(merchant, 'Unmatch');
}

// Settings is one form with one Save: an edit in one section and one in another go out together,
// so there is nothing to warn about. Typing in two sections and saving once keeps both.
async function unsavedCheck(page, base) {
  await page.goto(base + '/settings#f-ACCOUNTANT_LABEL');
  await page.locator('[name=ACCOUNTANT_LABEL]').fill('Unsaved Accounting Oy');
  const saves = await page.locator('main button.btn.primary, main .sbar button.btn').count();
  if (saves !== 1) throw new Error(`Settings should have one Save, found ${saves}`);
  await page.locator('.sbar button.btn').click();
  await page.waitForLoadState('load');
  if ((await page.locator('[name=ACCOUNTANT_LABEL]').inputValue()) !== 'Unsaved Accounting Oy')
    throw new Error('Settings did not keep the edit after the one Save');
  console.log('settings: one Save keeps the edit');
}

// Put the accountant back to unset, so Home shows the setup checklist with one step left.
async function unsetAccountant(page, base) {
  await page.goto(base + '/settings#f-ACCOUNTANT_LABEL');
  const reset = page.locator('button[name=reset][value=ACCOUNTANT_LABEL]');
  if (await reset.count()) {
    await reset.click();
    await page.waitForLoadState('load');
  }
}

export async function tourScreens(page, base, { sendEmail, receiptHtml }) {
  await sendEmail(
    'tour-flagged',
    'owner@example.com',
    receiptHtml({ vendor: 'Sample Poster Studio', issue_date: '2026-09-21' }),
  );
  await page.waitForTimeout(1500);
  // One email from a sender that is not allowed, then ignored, so Settings > Mail we didn't keep has a row.
  await sendEmail(
    'tour-unknown',
    'billing@unknown-shop.example',
    receiptHtml({ vendor: 'Sample Unknown Shop', issue_date: '2026-09-22' }),
  );
  await page.waitForTimeout(1000);
  await page.goto(base + '/receipts?view=todo');
  const ignore = page.locator('details', {
    has: page.locator('summary[aria-label="Ignore billing@unknown-shop.example"]'),
  });
  await ignore.locator('summary').click();
  await ignore.getByRole('button', { name: 'Ignore and delete' }).click();
  await page.waitForLoadState('load');
  await page.goto(base + '/receipts?view=todo');
  const flagged = await page.locator('main a[href^="/receipts/"]').first().getAttribute('href');
  await page.goto(base + '/receipts?view=all&kind=sales&month=2026-09');
  const invoice = await page.locator('main a[href^="/receipts/"]').first().getAttribute('href');
  await page.goto(base + '/receipts?view=all&month=2026-09');
  const ready = await page
    .locator('main a[href^="/receipts/"]')
    .evaluateAll(
      (links, skip) => links.map((a) => a.getAttribute('href')).find((h) => h && !skip.includes(h)),
      [flagged, invoice],
    );
  await keyboardCheck(page, base);
  await unsavedCheck(page, base);
  return [
    { name: 'receipt-flagged', path: flagged },
    { name: 'home-sep', path: '/?month=2026-09' },
    { name: 'home-arrival', path: '/' },
    { name: 'home-oct', path: `/?month=${new Date().toISOString().slice(0, 7)}` },
    { name: 'receipts-todo', path: '/receipts?view=todo' },
    { name: 'receipts', path: '/receipts?view=all&month=2026-09' },
    { name: 'receipt-ready', path: ready },
    { name: 'invoice-paid', path: invoice },
    { name: 'bank', path: '/payments?month=2026-09&view=all' },
    { name: 'import', path: '/import' },
    { name: 'add', path: '/add' },
    { name: 'invoices', path: '/receipts?view=all&kind=sales&month=2026-09' },
    { name: 'settings', path: '/settings' },
    { name: 'settings-mail', path: '/settings?open=senders#mail' },
    // Last: it undoes the matches, so the screens above keep the settled month.
    { name: 'bank-likely', path: '/payments?month=2026-09&view=todo', prepare: () => unsettleBank(page, base) },
    { name: 'help', path: '/help' },
    { name: 'help-flags', path: '/help#flag-missing_vendor' },
    { name: 'home-setup', path: '/?month=2026-09', prepare: () => unsetAccountant(page, base) },
  ];
}

// ---------- Journey f: the owner's month close on a busy month ----------
// Runs last, on its own month (see BUSY_MONTH in ux-journeys.mjs), so a-e keep their small data.
// It reads docs/app-v4/CONTRACT.md. A part of the contract the app does not have yet is a missed
// check, never a crash, so the same journey baselines main and proves each later PR.
const OPEN_PAYMENTS = 60;
const rowIds = (page) =>
  page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-row]')].map((e) => e.dataset.row);
    const boxes = [...document.querySelectorAll('input[name=id][type=checkbox]')].map((e) => e.value);
    return (rows.length ? rows : boxes).filter((id) => /^[a-f0-9]{64}$/.test(id));
  });

// The list holding the bar that runs op: the contract's container, or today's data-bulk-list wrapper.
async function selectPage(page, rec, op) {
  const bar = page.locator(`form[data-bulk]:has(button[name=op][value=${op}])`).first();
  const scope = page.locator(`[data-list], [data-bulk-list="${await bar.getAttribute('id')}"]`).first();
  const toggle = scope.locator('a[data-bulk-select]');
  if (await toggle.first().isVisible()) await rec.click(toggle);
  await scope.locator('input[data-bulk-page]').first().check();
  rec.clicks++;
}
async function bulkClick(page, rec, selector) {
  await Promise.all([
    page.waitForURL((u) => u.searchParams.has('done'), { timeout: 10000 }),
    page.locator(selector).first().click(),
  ]);
  rec.clicks++;
  await page.waitForLoadState('load');
  rec.screen();
}
const section = async (rec, name, run) => {
  try {
    await run();
  } catch (error) {
    rec.check(false, `${name} could not be driven: ${String(error.message).split('\n')[0]}`);
  }
};

async function bankTodo(page, rec, month) {
  await rec.goto(`/payments?month=${month}&view=todo`);
  const contract = await page.locator('[data-list="bank-todo"]').count();
  rec.check(contract === 1, 'Bank has a To do list (data-list="bank-todo")');
  if (!contract) await rec.goto(`/payments?month=${month}&view=todo`);
  const total = contract ? Number(await page.locator('[data-list="bank-todo"]').getAttribute('data-total')) : null;
  rec.check(total === OPEN_PAYMENTS, `Bank To do counts all ${OPEN_PAYMENTS} open payments (data-total=${total})`);
  const first = await rowIds(page);
  rec.check(
    first.length === 50,
    `Bank To do shows the first 50 of ${OPEN_PAYMENTS} open payments (shows ${first.length})`,
  );
  await selectPage(page, rec, 'exempt');
  const acted = await rowIds(page);
  await page.evaluate(() => window.scrollTo(0, Math.round(document.documentElement.scrollHeight * 0.4)));
  // Where the first resolved row still on screen stands, in the viewport. The row that takes its
  // place should stand about there: the list moved up, the person's eye did not.
  const anchorTop = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-row]')].filter((r) => r.querySelector('input[name=id]:checked'));
    const seen = rows.find((r) => r.getBoundingClientRect().bottom > 0);
    return seen ? Math.round(seen.getBoundingClientRect().top) : null;
  });
  await bulkClick(page, rec, 'form[data-bulk] button[name=op][value=exempt]');
  const remaining = OPEN_PAYMENTS - acted.length;
  const after = await rowIds(page);
  rec.note(`Bank To do: ${acted.length} selected, ${after.length} rows after, ${remaining} still open.`);
  rec.check(
    after.length === Math.min(50, remaining),
    `Bank To do refills to ${Math.min(50, remaining)} rows after ${acted.length} are resolved (shows ${after.length})`,
  );
  rec.check(!after.some((id) => acted.includes(id)), 'No resolved payment is still listed');
  const text = await page.locator('main').innerText();
  rec.check(
    !/Every payment has a receipt/.test(text),
    `Bank does not say every payment has a receipt while ${remaining} are open`,
  );
  const nextTop = await page.evaluate(() => {
    const row = document.querySelector(':target') ?? document.activeElement?.closest?.('[data-row]');
    return row ? Math.round(row.getBoundingClientRect().top) : null;
  });
  const drift = anchorTop === null || nextTop === null ? null : nextTop - anchorTop;
  rec.check(
    drift !== null && Math.abs(drift) <= 200,
    `Scroll stays put (the next row is ${drift} px from where the first resolved row was)`,
  );
  const focused = await page.evaluate(() => document.activeElement?.closest?.('[data-row]')?.dataset.row ?? null);
  rec.check(focused !== null && !acted.includes(focused), 'Focus is inside the next open row');
}

async function receiptsTodo(page, rec, month, { busyReceipts, isComplete, isTodo }) {
  await rec.goto('/receipts?view=todo');
  const contract = await page.locator('[data-list="receipts-todo"]').count();
  rec.check(contract === 1, 'Receipts has a To do list (data-list="receipts-todo")');
  const seeded = new Set(
    busyReceipts(month)
      .filter((r) => isTodo(r) && isComplete(r))
      .map((r) => r.id),
  );
  await selectPage(page, rec, 'approve');
  const acted = (await rowIds(page)).filter((id) => seeded.has(id));
  rec.check(
    acted.length === seeded.size,
    `Receipts To do lists all ${seeded.size} approvable receipts (lists ${acted.length})`,
  );
  const approve = page.locator('form[data-bulk] button[name=op][value=approve]').first();
  if (!(await approve.isVisible()))
    await page.locator('form[data-bulk] details:has(button[value=approve]) > summary').first().click();
  await bulkClick(page, rec, 'form[data-bulk] button[name=op][value=approve]');
  const after = await rowIds(page);
  rec.check(!after.some((id) => acted.includes(id)), `The ${acted.length} approved receipts are gone from To do`);
  const undo = page.locator('[role=status] form[action$="/undo"] button').first();
  const offered = (await undo.count()) > 0;
  rec.check(offered, 'The banner offers Undo');
  if (!offered) return;
  await Promise.all([page.waitForLoadState('load'), undo.click()]);
  rec.clicks++;
  rec.screen();
  const back = await rowIds(page);
  rec.check(
    acted.every((id) => back.includes(id)),
    'Undo brings the approved receipts back into To do',
  );
}

export const busyJourney = {
  name: 'f. Busy month',
  async run(page, rec, helpers) {
    page.setDefaultTimeout(5000);
    const month = helpers.BUSY_MONTH;
    const seed = await import('./busy-month.mjs');
    await section(rec, 'Bank To do', () => bankTodo(page, rec, month));
    await section(rec, 'Receipts To do', () => receiptsTodo(page, rec, month, seed));
  },
};
