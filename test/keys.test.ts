import { expect, test } from 'vitest';
import { idFrom, request, uploadPdf } from './helpers';

const SCRIPT_TAG = '<script src="/assets/keys.js" defer></script>';

test('keys.js is served, every page includes it once, and the shortcut sheet is closed by default', async () => {
  const id = idFrom(await uploadPdf());
  for (const path of ['/', '/receipts', '/payments', '/settings', '/help', `/receipts/${id}`]) {
    const html = await (await request(path)).text();
    expect(html.split(SCRIPT_TAG).length - 1, path).toBe(1);
    expect(html.split('<dialog id="keys-sheet"').length - 1, path).toBe(1);
    expect(html, path).toMatch(/<dialog id="keys-sheet"(?![^>]*\sopen)[^>]*>/);
    expect(html, path).toMatch(
      /<header><h2 id="keys-sheet-title" tabindex="-1">Keyboard shortcuts<\/h2><form method="dialog"><button[^>]*>.*?Close.*?<\/button><\/form><\/header>/s,
    );
  }
  const script = await request('/assets/keys.js');
  expect(script.headers.get('Content-Type')).toContain('text/javascript');
  const js = await script.text();
  expect(js).toContain("sheet.querySelector('h2').focus()");
  expect(js).toContain('sheet.scrollTop = 0');
  expect(js).toContain('(hover: none) and (pointer: coarse)');
  expect(js).toContain("addEventListener('pageshow'");
  expect(js).toContain("addEventListener('submit'");
});

test('Help lists the keyboard shortcuts', async () => {
  const html = await (await request('/help')).text();
  expect(html).toContain('id="keyboard"');
  expect(html).toContain('<dt id="keys-0-0">j and k</dt>');
  expect(html).toContain('<dt id="keys-1-0">a</dt>');
});
