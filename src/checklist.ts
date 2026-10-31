// The setup checklist on Home: five things a new install needs, each worked
// out from what is already stored, so nothing new is saved and nothing can
// drift. It shows until all five are done.
import { listAccounts } from './accounts';
import { config } from './config';
import type { Env } from './env';
import { type StepState } from './status';
import { escape, stepWord } from './ui';

export type SetupStep = {
  id: 'business' | 'email' | 'accountant' | 'bank' | 'statement';
  done: boolean;
  // The action in plain words, and the same step once done.
  action: string;
  finished: string;
  // One line on why it matters.
  why: string;
  href: string;
};

export async function setupSteps(env: Env): Promise<SetupStep[]> {
  const settings = config(env);
  const [accounts, state, logged] = await Promise.all([
    listAccounts(env.DB),
    env.DB.prepare(
      "SELECT EXISTS(SELECT 1 FROM receipts WHERE source='email') mail, EXISTS(SELECT 1 FROM imports WHERE status='complete') statement",
    ).first<{ mail: number; statement: number }>(),
    // Email Routing can't be asked of Cloudflare, so an email that reached the app is the proof, even one that was not kept.
    // The log has a row for every email that arrived, kept or not. Missing before its migration.
    env.DB.prepare('SELECT EXISTS(SELECT 1 FROM inbound_mail) n')
      .first<number>('n')
      .catch(() => 0),
  ]);
  const address = !!settings.receiptAddress;
  // The migration seeds one account, "Bank account"; until it is renamed or another is added, the person has none of their own.
  const own = accounts.some((a) => !(a.id === 'default-account' && a.label === 'Bank account' && !a.bank_name));
  const routed = address && (!!state?.mail || !!logged);
  return [
    {
      id: 'business',
      done: settings.sellerNames.length > 0,
      action: 'Add your business name',
      finished: 'Business name added',
      why: 'So invoices you send are told apart from receipts.',
      href: '/settings#f-SELLER_NAMES',
    },
    {
      id: 'email',
      done: routed,
      action: address ? 'Confirm Email Routing in Cloudflare' : 'Set your receipt address',
      finished: 'Email Routing confirmed',
      why: routed
        ? 'An email reached the app, so it works.'
        : address
          ? 'Then forward one receipt to check it. Any email that reaches the app completes this.'
          : 'So receipts you forward are read.',
      href: address ? '/settings?routing=1#setup-email' : '/settings#f-RECEIPT_ADDRESS',
    },
    {
      id: 'accountant',
      done: settings.accountantLabel !== 'your accountant',
      action: 'Name your accountant',
      finished: 'Accountant named',
      why: 'So each month says who it goes to.',
      href: '/settings#f-ACCOUNTANT_LABEL',
    },
    {
      id: 'bank',
      done: own || !!state?.statement,
      action: 'Add your bank account',
      finished: 'Bank account added',
      why: 'So payments from your statement have a home.',
      href: '/settings#accounts',
    },
    {
      id: 'statement',
      done: !!state?.statement,
      action: 'Import your first bank statement',
      finished: 'First statement imported',
      why: 'So the app can match payments to receipts.',
      href: '/import',
    },
  ];
}

// Null once everything is done. The first step still to do is the one marked Next.
export function setupChecklist(steps: readonly SetupStep[]): string | null {
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const next = steps.find((s) => !s.done)?.id;
  const rows = (list: readonly SetupStep[]) =>
    list
      .map((s) => {
        const state: StepState = s.done ? 'done' : s.id === next ? 'now' : 'todo';
        return `<li class="step ${state}"><a href="${s.href}">${stepWord(state)}<b>${escape(s.done ? s.finished : s.action)}</b><span>${escape(s.why)}</span></a></li>`;
      })
      .join('');
  // What is left comes first; what is finished folds below it, so the month is not pushed down.
  const finished = steps.filter((s) => s.done);
  const folded = finished.length
    ? `<details class="finished"><summary>${finished.length} done</summary><ol class="steps checklist">${rows(finished)}</ol></details>`
    : '';
  return `<section class="setup" aria-labelledby="setup-h setup-n"><div class="sethead"><h2 id="setup-h">Finish setting up</h2><p id="setup-n">${done} of ${steps.length} done</p></div><ol class="steps checklist">${rows(steps.filter((s) => !s.done))}</ol>${folded}<p class="small"><a href="/help">New here? See what the words mean.</a></p></section>`;
}
