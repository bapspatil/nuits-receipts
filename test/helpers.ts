import { env } from 'cloudflare:workers';
import { signer } from '../src/signing';
import worker from '../src/index';
export const authorization = 'Basic ' + btoa('owner:local-dummy-password');
export function request(path: string, init: RequestInit = {}) {
  return worker.fetch(
    new Request('http://localhost' + path, {
      ...init,
      headers: {
        Authorization: authorization,
        Origin: 'http://localhost',
        ...init.headers,
      },
    }),
    env,
  );
}
export function pdfBytes() {
  return Uint8Array.from(atob(env.SAMPLE_PDF), (c) => c.charCodeAt(0));
}
export async function uploadPdf() {
  const form = new FormData();
  form.set('file', new File([pdfBytes()], 'sample.pdf', { type: 'application/pdf' }));
  return request('/upload', { method: 'POST', body: form });
}

export function confirmationForm(html: string): FormData {
  return htmlForm(html, '/imports/csv/confirm');
}
export function htmlForm(html: string, action: string): FormData {
  const form = html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g);
  const decode = (s: string) =>
    s
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&#x27;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  const attributes = (tag: string) =>
    Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1]!, decode(m[2]!)]));
  const block = [...form].find(
    (m) => attributes(m[1]!).action === action || m[2]!.includes('formaction="' + action + '"'),
  )?.[2];
  if (block === undefined) throw new Error('Form not found: ' + action);
  const result = new FormData();
  for (const match of block.matchAll(/<input\b[^>]*>/g)) {
    const a = attributes(match[0]);
    if (a.name && a.type !== 'file' && !(['checkbox', 'radio'].includes(a.type ?? '') && !/\bchecked\b/.test(match[0])))
      result.set(a.name, a.value ?? '');
  }
  for (const match of block.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
    const a = attributes(match[1]!),
      all = [...match[2]!.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)];
    const picked = all.find((o) => /\bselected\b/.test(o[1]!)) ?? all[0];
    if (a.name && picked) result.set(a.name, attributes(picked[1]!).value ?? decode(picked[2]!));
  }
  return result;
}
// The receipt id in a redirect to /receipts/<id>, ignoring the ?done= feedback params.
export function idFrom(response: Response): string {
  return new URL(response.headers.get('Location')!, 'http://localhost').pathname.split('/').at(-1)!;
}
// A feedback link the way the app would have issued it, so a test can open ?done= pages.
// base is an APP_BASE_PATH prefix already on path; it is not part of what is signed.
export async function signed(path: string, base = '', now = Date.now()): Promise<string> {
  return base + (await signer(env).sign(path.slice(base.length), now));
}
// A redirect's Location without the iat and sig that sign its ?done= link.
export function unsigned(location: string | null): string {
  return (location ?? '').replace(/&(iat|sig)=[^&#]*/g, '');
}
// Also without the at and op an Undo names the action by, since at changes on every run; a test
// that undoes reads them from the page the redirect lands on.
export const locationOf = (response: Response) =>
  unsigned(response.headers.get('Location')).replace(/&at=[^&#]*&op=[^&#]*/, '');

// Like a browser: every control that names a form by id (form="…"), wherever it sits on the page.
// Settings is one form whose controls are spread over its sections.
export function formById(html: string, id: string): FormData {
  const decode = (s: string) =>
    s
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&#x27;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  const attr = (tag: string, name: string) => {
    const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
    return m ? decode(m[1]!) : null;
  };
  const form = new FormData();
  const mine = (tag: string) => attr(tag, 'form') === id;
  for (const [tag] of html.matchAll(/<input\b[^>]*>/g)) {
    const name = attr(tag, 'name');
    if (!name || !mine(tag) || (['checkbox', 'radio'].includes(attr(tag, 'type') ?? '') && !/\bchecked\b/.test(tag)))
      continue;
    form.append(name, attr(tag, 'value') ?? '');
  }
  for (const m of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g))
    if (mine(m[1]!)) form.append(attr(m[1]!, 'name')!, decode(m[2]!));
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
    if (!mine(m[1]!)) continue;
    const options = [...m[2]!.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)];
    const picked = options.find((o) => /\bselected\b/.test(o[1]!)) ?? options[0]!;
    form.append(attr(m[1]!, 'name')!, attr(picked[1]!, 'value') ?? decode(picked[2]!));
  }
  return form;
}
