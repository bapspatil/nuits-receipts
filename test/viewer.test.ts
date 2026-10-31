import { expect, test } from 'vitest';
import { viewer, VIEWER_JS } from '../src/viewer';

test('the PDF viewer keeps its phone controls and keyboard find accessible', () => {
  const html = viewer({ id: 'synthetic', media_type: 'application/pdf' }, 'Fallback');
  expect(html).toContain('data-do="out" aria-label="Zoom out" title="Zoom out"');
  expect(html).toContain('data-do="in" aria-label="Zoom in" title="Zoom in"');
  expect(html).toContain('aria-label="Find in the document" title="Find in the document"');
  expect(html).toMatch(/<details class="vmore">.*data-zoom.*data-pageof.*Print/s);
  expect(VIEWER_JS).toContain("find.closest('details').open = true");
});
