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
      const accountant = page.locator('main a', { hasText: /accountant/i });
      if (await accountant.count()) {
        await rec.goto('/');
        await rec.click(accountant);
        await rec.fill(page.locator('[name=ACCOUNTANT_LABEL]'), 'Example Accounting Oy');
        await rec.click(page.locator('form:has([name=ACCOUNTANT_LABEL]) button.btn'));
      } else rec.note('No accountant step on Home after the first receipt.');
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
      rec.note(`Home on arrival (current month): ${home.slice(0, 140)}`);
      await rec.click(nav(page, '/review'));
      const queue = await page.locator('main a[href^="/receipts/"]').count();
      rec.note(`Review lists ${queue} receipts.`);
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
      await rec.click(button(page, 'Check the file'));
      await rec.click(page.getByRole('button', { name: /^Import \d+ payments$/ }));
      rec.note(`After import: ${(await page.locator('main p.summary').first().innerText()).trim()}`);
      rec.note(`Import banner: ${(await page.locator('main [role=status]').first().innerText()).replace(/\s+/g, ' ').trim()}`);
      const row = (merchant) => page.locator('li.pay', { hasText: merchant });
      // A likely pair is one button: "Match", or "Match anyway" when the names differ.
      const likely = row('DOMAINDESK').getByRole('button', { name: /^Match( anyway)?$/ });
      if (await likely.count()) {
        rec.note(`DOMAINDESK offers: ${(await likely.innerText()).trim()}. ${(await row('DOMAINDESK').locator('.likely__why').innerText()).trim()}`);
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
      await rec.click(page.locator('main a[href="/invoices"]'));
      await rec.click(page.locator('main a[href^="/add"]'));
      if (!(await page.locator('input[name=kind][value=sales]').isChecked()))
        await rec.click(page.locator('input[name=kind][value=sales]'));
      await rec.upload(page.locator('input[name=file]'), file);
      await rec.click(button(page, 'Add files'));
      await page.waitForTimeout(2000);
      rec.note(
        `After upload: ${new URL(page.url()).pathname} says "${(await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 160)}"`,
      );
      if (await button(page, approve).count()) await fixAndApprove(page, rec);
      await rec.click(nav(page, '/payments'));
      if (!page.url().includes('2026-09')) await rec.click(page.locator('main a[href$="month=2026-09"]'));
      if (!(await page.locator('li.pay', { hasText: 'Sample Client Oy' }).count()))
        await rec.click(page.locator('main a[href*="show=all"]'));
      const money = page.locator('li.pay', { hasText: 'Sample Client Oy' });
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
      await rec.click(page.locator('main a[href$="month=2026-09"]'));
      rec.note(`Home for September: ${(await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 200)}`);
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
// A keyboard-only run from Review to the first receipt: Tab to it, open it, Tab into a field, type,
// and press Enter. Enter must approve (this receipt is incomplete, so the refusal comes back in
// place); Skip, Discard or Read again would redirect or post elsewhere.
async function keyboardCheck(page, base) {
  await page.goto(base + '/review');
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
  console.log('keyboard: Review to first receipt, fill a field, Enter approves');
}

// Put three payments back to "Missing" so Bank shows likely pairs, a Match all and a payment nothing fits.
async function unsettleBank(page, base) {
  const bank = () => page.goto(base + '/payments?month=2026-09&show=all');
  const open = async (merchant, button) => {
    const row = page.locator('li.pay', { hasText: merchant });
    await row.locator('summary', { hasText: 'More' }).click();
    await row.getByRole('button', { name: button }).click();
    await page.waitForLoadState('load');
    await bank();
  };
  await bank();
  // First, so its reconcile cannot match the others again.
  await open('Sample Missing Vendor', 'Needs a receipt');
  for (const merchant of ['Sample Cloud Lantern Oy', 'DOMAINDESK', 'Sample Train Line'])
    await open(merchant, 'Remove match');
}

export async function tourScreens(page, base, { sendEmail, receiptHtml }) {
  await sendEmail(
    'tour-flagged',
    'owner@example.com',
    receiptHtml({ vendor: 'Sample Poster Studio', issue_date: '2026-09-21' }),
  );
  await page.waitForTimeout(1500);
  await page.goto(base + '/review');
  const flagged = await page.locator('main a[href^="/receipts/"]').first().getAttribute('href');
  await page.goto(base + '/invoices?month=2026-09');
  const invoice = await page.locator('main a[href^="/receipts/"]').first().getAttribute('href');
  await page.goto(base + '/receipts?month=2026-09');
  const ready = await page
    .locator('main a[href^="/receipts/"]')
    .evaluateAll(
      (links, skip) => links.map((a) => a.getAttribute('href')).find((h) => h && !skip.includes(h)),
      [flagged, invoice],
    );
  await keyboardCheck(page, base);
  return [
    { name: 'receipt-flagged', path: flagged },
    { name: 'home-sep', path: '/?month=2026-09' },
    { name: 'home-oct', path: '/' },
    { name: 'review', path: '/review' },
    { name: 'receipts', path: '/receipts?month=2026-09' },
    { name: 'receipt-ready', path: ready },
    { name: 'invoice-paid', path: invoice },
    { name: 'bank', path: '/payments?month=2026-09&show=all' },
    { name: 'import', path: '/import' },
    { name: 'add', path: '/add' },
    { name: 'invoices', path: '/invoices?month=2026-09' },
    { name: 'settings', path: '/settings' },
    // Last: it undoes the matches, so the screens above keep the settled month.
    { name: 'bank-likely', path: '/payments?month=2026-09&show=missing', prepare: () => unsettleBank(page, base) },
  ];
}
