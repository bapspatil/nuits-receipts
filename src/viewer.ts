// The document viewer: a PDF drawn page by page with PDF.js, or an image, with zoom, fit,
// rotate, find, page thumbnails and print. The server renders the fallback (the PDF's text, or
// the image) and the toolbar inside a <template>; the script swaps the fallback for the pages
// only once the document has loaded, so without script, or when PDF.js fails, nothing is lost.
// PDF.js runs with eval off (CVE-2024-4367) and XFA off, from this origin.
import PDF_JS from './vendor/pdf.txt';
import PDF_WORKER_JS from './vendor/pdf-worker.txt';
import { PDFJS_VERSION } from './vendor/pdfjs-version';
import { button, buttonLink } from './actions';
import { escape } from './ui';

export { PDF_JS, PDF_WORKER_JS };
export const VIEWER_VERSION = `${PDFJS_VERSION}-1`;

type Source = { id: string; media_type: string; filename?: string | null };

// The viewer around a document. fallback is what shows without script. compact is the preview
// pane's: no thumbnails or find, and the toolbar's quieter half.
// raw: where the bytes are read from, when it is not a receipt's original.
export function viewer(
  r: Source,
  fallback: string,
  o: { compact?: boolean; label?: string; raw?: string } = {},
): string {
  const pdf = r.media_type === 'application/pdf';
  const raw = o.raw ?? `/originals/${r.id}?view=raw`;
  const tools = [
    button('zoomOut', { attrs: ' type="button" data-do="out"' }),
    `<output class="vzoom" data-zoom aria-live="polite">100%</output>`,
    button('zoomIn', { attrs: ' type="button" data-do="in"' }),
    button('fit', { attrs: ' type="button" data-do="fit"' }),
    button('rotate', { attrs: ' type="button" data-do="rotate"' }),
    pdf ? `<span class="vpage-of" data-pageof aria-live="polite"></span>` : '',
    pdf && !o.compact
      ? `<form class="vfind" data-find role="search"><label class="vh" for="vfind-${escape(r.id.slice(0, 8))}">Find in the document</label><input id="vfind-${escape(r.id.slice(0, 8))}" type="search" placeholder="Find in the document" maxlength="100" autocomplete="off"><output data-found aria-live="polite"></output></form>`
      : '',
    o.compact ? '' : buttonLink('print', raw, { attrs: ' target="_blank" rel="noopener"' }),
  ].join('');
  return `<section class="viewer${o.compact ? ' compact' : ''}" data-viewer data-type="${pdf ? 'pdf' : 'image'}" aria-label="${escape(o.label ?? (pdf ? 'The PDF' : 'The image'))}"><a data-raw href="${raw}" hidden>${escape(r.filename ?? 'Original')}</a><template data-bar><div class="vbar" role="toolbar" aria-label="Viewer">${tools}</div></template><div class="vfallback">${fallback}</div></section>`;
}
export const VIEWER_SCRIPT = `<script type="module" src="/assets/viewer.js?v=${VIEWER_VERSION}"></script>`;

// Text layer rules from PDF.js's own pdf_viewer.css, which positions the invisible text over each
// page so it can be selected and found; the rest is the viewer's own.
export const VIEWER_CSS = `
.viewer{position:relative;display:flex;flex-direction:column;gap:var(--space-2);min-width:0}
.viewer[data-state=on] .vfallback{display:none}
.vbar{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);padding:var(--space-1) var(--space-2);border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface-raised);position:sticky;top:var(--space-2);z-index:2}
.vbar .btn{min-height:36px;padding:0 var(--space-3);font-size:var(--text-base)}
.vzoom,.vpage-of,.vfind output{font:500 var(--text-sm)/1 var(--font-num);font-variant-numeric:tabular-nums;color:var(--text-muted);min-width:4ch;text-align:center}
.vfind{display:flex;align-items:center;gap:var(--space-2);margin-left:auto}
.vfind input{width:min(240px,40vw);min-height:36px;font-size:var(--text-sm)}
.vbody{display:flex;gap:var(--space-3);min-height:0}
.vthumbs{display:none;flex:none;width:96px;max-height:78vh;overflow:auto;flex-direction:column;gap:var(--space-2);padding:0}
.vthumbs button{display:flex;flex-direction:column;align-items:center;gap:var(--space-1);padding:var(--space-1);border:1px solid var(--border);border-radius:6px;background:var(--surface-raised);font:500 var(--text-xs)/1 var(--font-num);color:var(--text-muted);cursor:pointer}
.vthumbs button[aria-current=true]{outline:2px solid var(--accent);outline-offset:1px}
.vthumbs canvas{width:80px;height:auto;background:var(--slip)}
@media (min-width:1100px){.viewer:not(.compact) .vthumbs.many{display:flex}}
.vstage{flex:1;min-width:0;max-height:78vh;overflow:auto;padding:var(--space-3);border-radius:12px;background:var(--frame-bg);outline-offset:2px}
.compact .vstage{max-height:56vh}
.vpages{display:flex;flex-direction:column;align-items:center;gap:var(--space-3);margin:0 auto;width:max-content;min-width:100%}
.vpg{position:relative;flex:none;background:var(--slip);box-shadow:var(--shadow-raised);--scale-round-x:1px;--scale-round-y:1px}
.vpg canvas{position:absolute;inset:0;width:100%;height:100%}
.vimg{display:block;margin:0 auto;max-width:none;box-shadow:var(--shadow-raised);background:var(--slip);transform-origin:center}
.textLayer{position:absolute;text-align:initial;inset:0;overflow:clip;opacity:1;line-height:1;letter-spacing:normal;word-spacing:normal;text-size-adjust:none;forced-color-adjust:none;transform-origin:0 0;caret-color:CanvasText;z-index:0;--min-font-size:1;--text-scale-factor:calc(var(--total-scale-factor) * var(--min-font-size));--min-font-size-inv:calc(1 / var(--min-font-size))}
.textLayer :is(span,br){color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0% 0%;user-select:text}
.textLayer > :not(.markedContent),.textLayer .markedContent span:not(.markedContent){z-index:1;--font-height:0;font-size:calc(var(--text-scale-factor) * var(--font-height));--scale-x:1;--rotate:0deg;transform:rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv))}
.textLayer .markedContent{display:contents}
.textLayer ::selection{background:color-mix(in srgb,var(--accent) 25%,transparent)}
.textLayer span.hit{background:color-mix(in srgb,var(--warn) 30%,transparent);border-radius:2px}
[data-main-rotation="90"]{transform:rotate(90deg) translateY(-100%)}
[data-main-rotation="180"]{transform:rotate(180deg) translate(-100%,-100%)}
[data-main-rotation="270"]{transform:rotate(270deg) translateX(-100%)}
`;

// The client: a module, so it can import PDF.js from beside itself. Every address is resolved
// against its own URL or the page's links, so an install under APP_BASE_PATH works unchanged.
export const VIEWER_JS = `const v = new URL(import.meta.url).searchParams.get('v') || '';
const asset = (name) => new URL(name + '?v=' + v, import.meta.url).href;
const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
let pdfjs = null;
const loadPdfjs = async () => {
  if (pdfjs) return pdfjs;
  pdfjs = await import(asset('pdf.mjs'));
  pdfjs.GlobalWorkerOptions.workerSrc = asset('pdf-worker.mjs');
  return pdfjs;
};
const viewers = [];
for (const root of document.querySelectorAll('[data-viewer]')) start(root);

function shell(root) {
  const bar = root.querySelector('template[data-bar]').content.firstElementChild.cloneNode(true);
  const body = document.createElement('div');
  body.className = 'vbody';
  const thumbs = document.createElement('nav');
  thumbs.className = 'vthumbs';
  thumbs.setAttribute('aria-label', 'Pages');
  const stage = document.createElement('div');
  stage.className = 'vstage';
  stage.tabIndex = 0;
  stage.setAttribute('role', 'region');
  stage.setAttribute('aria-label', root.getAttribute('aria-label') || 'Document');
  const pages = document.createElement('div');
  pages.className = 'vpages';
  stage.append(pages);
  body.append(thumbs, stage);
  return { bar, body, thumbs, stage, pages };
}

async function start(root) {
  const src = root.querySelector('a[data-raw]').href;
  const ui = shell(root);
  const state = { zoom: 1, fit: true, rotation: 0 };
  const zoomOut = ui.bar.querySelector('[data-zoom]');
  const show = () => {
    root.prepend(ui.bar);
    root.append(ui.body);
    root.dataset.state = 'on';
  };
  try {
    const api = root.dataset.type === 'pdf' ? await pdfViewer(src, ui, state) : await imageViewer(src, ui, state);
    show();
    const relayout = () => {
      api.layout();
      zoomOut.textContent = Math.round(api.scale() * 100) + '%';
    };
    const act = (what) => {
      if (what === 'in' || what === 'out') {
        const now = api.scale();
        const next = what === 'in' ? ZOOMS.find((z) => z > now + 0.01) : [...ZOOMS].reverse().find((z) => z < now - 0.01);
        if (next) state.zoom = next;
        state.fit = false;
      } else if (what === 'fit') state.fit = true;
      else if (what === 'rotate') state.rotation = (state.rotation + 90) % 360;
      relayout();
    };
    ui.bar.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-do]');
      if (b) act(b.dataset.do);
    });
    new ResizeObserver(() => state.fit && relayout()).observe(ui.stage);
    relayout();
    viewers.push({ root, act, api });
  } catch (error) {
    root.dataset.state = 'failed';
    console.warn('viewer', error);
  }
}

async function imageViewer(src, ui, state) {
  const img = new Image();
  img.className = 'vimg';
  img.alt = '';
  img.src = src;
  await img.decode();
  ui.pages.append(img);
  let scale = 1;
  return {
    scale: () => scale,
    layout() {
      const turned = state.rotation % 180 !== 0;
      const w = turned ? img.naturalHeight : img.naturalWidth;
      const room = ui.stage.clientWidth - 24;
      scale = state.fit ? Math.min(1, room / w) : state.zoom;
      img.style.width = img.naturalWidth * scale + 'px';
      img.style.transform = state.rotation ? 'rotate(' + state.rotation + 'deg)' : '';
      const box = turned ? (img.naturalWidth - img.naturalHeight) * scale / 2 : 0;
      img.style.margin = box + 'px auto';
    },
    page: () => 1,
  };
}

async function pdfViewer(src, ui, state) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ url: src, isEvalSupported: false, enableXfa: false, disableAutoFetch: true }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const el = document.createElement('div');
    el.className = 'vpg';
    el.dataset.n = n;
    el.setAttribute('aria-label', 'Page ' + n + ' of ' + doc.numPages);
    ui.pages.append(el);
    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.setAttribute('aria-label', 'Page ' + n);
    const label = document.createElement('span');
    label.textContent = String(n);
    thumb.append(document.createElement('canvas'), label);
    thumb.addEventListener('click', () => el.scrollIntoView({ block: 'start' }));
    ui.thumbs.append(thumb);
    pages.push({ n, page, el, thumb, drawn: 0, task: null, text: null, words: null });
  }
  ui.thumbs.classList.toggle('many', pages.length > 1);
  const pageOf = ui.bar.querySelector('[data-pageof]');
  let scale = 1, current = 1, query = '';
  const visible = new Set();
  const draw = async (p) => {
    if (p.drawn === scale + state.rotation * 10) return;
    p.drawn = scale + state.rotation * 10;
    if (p.task) p.task.cancel();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const view = p.page.getViewport({ scale: scale * ratio, rotation: state.rotation });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(view.width);
    canvas.height = Math.floor(view.height);
    p.task = p.page.render({ canvas, viewport: view });
    try {
      await p.task.promise;
    } catch (e) {
      if (e && e.name === 'RenderingCancelledException') return;
      throw e;
    }
    const layer = document.createElement('div');
    layer.className = 'textLayer';
    const tl = new lib.TextLayer({ textContentSource: p.page.streamTextContent(), container: layer, viewport: p.page.getViewport({ scale, rotation: state.rotation }) });
    await tl.render();
    p.el.replaceChildren(canvas, layer);
    mark(p);
  };
  const mark = (p) => {
    for (const span of p.el.querySelectorAll('.textLayer span')) span.classList.toggle('hit', !!query && span.textContent.toLowerCase().includes(query));
  };
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const p = pages[Number(e.target.dataset.n) - 1];
      if (e.isIntersecting) { visible.add(p); draw(p); } else visible.delete(p);
    }
    const top = [...visible].sort((a, b) => a.n - b.n)[0];
    if (top) setCurrent(top.n);
  }, { root: ui.stage, rootMargin: '300px 0px' });
  const setCurrent = (n) => {
    current = n;
    if (pageOf) pageOf.textContent = 'Page ' + n + ' of ' + pages.length;
    for (const p of pages) p.thumb.setAttribute('aria-current', String(p.n === n));
  };
  for (const p of pages) seen.observe(p.el);
  setCurrent(1);
  const thumbs = new IntersectionObserver(async (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      thumbs.unobserve(e.target);
      const p = pages.find((x) => x.thumb === e.target);
      const view = p.page.getViewport({ scale: 160 / p.page.getViewport({ scale: 1 }).width });
      const canvas = p.thumb.querySelector('canvas');
      canvas.width = Math.floor(view.width);
      canvas.height = Math.floor(view.height);
      p.page.render({ canvas, viewport: view }).promise.catch(() => {});
    }
  }, { root: ui.thumbs });
  for (const p of pages) thumbs.observe(p.thumb);
  const find = ui.bar.querySelector('[data-find]');
  if (find) {
    const field = find.querySelector('input'), found = find.querySelector('[data-found]');
    let at = -1;
    const words = async (p) => p.words ??= (await p.page.getTextContent()).items.map((i) => i.str).join(' ').toLowerCase();
    const search = async (step) => {
      const q = field.value.trim().toLowerCase();
      if (q !== query) { query = q; at = -1; for (const p of pages) mark(p); }
      if (!q) { found.textContent = ''; return; }
      const hits = [];
      for (const p of pages) if ((await words(p)).includes(q)) hits.push(p);
      if (!hits.length) { found.textContent = 'Not found'; return; }
      if (step) {
        at = (at + 1) % hits.length;
        hits[at].el.scrollIntoView({ block: 'start' });
      }
      found.textContent = hits.length === 1 ? 'On page ' + hits[0].n : 'On ' + hits.length + ' pages';
    };
    let timer;
    field.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => search(false), 200); });
    find.addEventListener('submit', (e) => { e.preventDefault(); search(true); });
  }
  return {
    scale: () => scale,
    page: () => current,
    pages: () => pages.length,
    go(n) { const p = pages[Math.min(pages.length, Math.max(1, n)) - 1]; p.el.scrollIntoView({ block: 'start' }); },
    find: () => find && find.querySelector('input').focus(),
    layout() {
      const first = pages[0].page.getViewport({ scale: 1, rotation: state.rotation });
      scale = state.fit ? Math.max(0.25, (ui.stage.clientWidth - 24) / first.width) : state.zoom;
      for (const p of pages) {
        const view = p.page.getViewport({ scale, rotation: state.rotation });
        p.el.style.width = Math.floor(view.width) + 'px';
        p.el.style.height = Math.floor(view.height) + 'px';
        p.el.style.setProperty('--total-scale-factor', String(scale));
        if (visible.has(p)) draw(p);
        else p.drawn = 0;
      }
    },
  };
}

// Keys: + and - zoom, 0 fits, n and p turn the page, f finds, r rotates. Off while typing.
document.addEventListener('keydown', (e) => {
  const viewer = viewers[0];
  if (!viewer || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
  if (document.querySelector('dialog[open]')) return;
  const { act, api } = viewer;
  const k = e.key;
  if (k === '+' || k === '=') act('in');
  else if (k === '-') act('out');
  else if (k === '0') act('fit');
  else if (k === 'r') act('rotate');
  else if (k === 'n' && api.go) api.go(api.page() + 1);
  else if (k === 'p' && api.go) api.go(api.page() - 1);
  else if (k === 'f' && api.find) api.find();
  else return;
  e.preventDefault();
});
`;
