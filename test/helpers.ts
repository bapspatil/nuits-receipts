import { env } from 'cloudflare:workers';
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
