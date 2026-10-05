import katex from 'katex';
import { Marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import type { El } from '../schema';

// output 'html': KaTeX's hidden MathML copy is laid out full-width and skews measurement
const md = new Marked({ gfm: true, breaks: true }).use(markedKatex({ throwOnError: false, nonStandard: true, output: 'html' }));

/** Synchronous HTML for text/latex/svg; null for types that render asynchronously. */
export function syncHtml(el: El): string | null {
  switch (el.type) {
    case 'text':
      // "> [!warn] ..." callouts (also ok, bad, info, trigger); colour check/cross/warning symbols
      return md
        .parse(el.md, { async: false })
        .replace(/<blockquote>\s*<p>\[!(\w+)\]\s*/g, '<blockquote class="c-$1"><p>')
        .replace(/[✔✓✅]\uFE0F?/gu, '<span class="sym-ok">$&</span>')
        .replace(/[❌✗✘]\uFE0F?/gu, '<span class="sym-bad">$&</span>')
        .replace(/⚠\uFE0F?/gu, '<span class="sym-warn">$&</span>');
    case 'latex':
      return katex.renderToString(el.tex, { displayMode: el.display, throwOnError: false, output: 'html' });
    case 'svg':
      return normalizeSvg(el.svg);
    default:
      return null;
  }
}

/**
 * Diagram output. `natural` is the drawing's own size (viewBox units) and its label
 * font size in the same units, so the renderer can size the diagram from a pt font size.
 */
export type Rendered = { html: string; natural?: { w: number; h: number; font: number } };

// Mermaid layout spacing, tightened for dense sheets (mermaid defaults are 50/50/8).
const MERMAID_CONFIG = {
  themeVariables: { fontSize: '20px' },
  flowchart: { curve: 'linear', nodeSpacing: 18, rankSpacing: 22, padding: 6, diagramPadding: 2 },
};

export async function asyncHtml(el: El): Promise<Rendered> {
  if (el.type === 'mermaid' || el.type === 'excalidraw') {
    // serve Excalidraw's fonts locally instead of from its CDN
    (window as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = '/node_modules/@excalidraw/excalidraw/dist/prod/';
    const ex = await import('@excalidraw/excalidraw');
    let elements, files = null;
    if (el.type === 'mermaid') {
      // mermaid is drawn by Excalidraw too, so every diagram shares the hand-drawn look
      const { parseMermaidToExcalidraw } = await import('@excalidraw/mermaid-to-excalidraw');
      const res = await parseMermaidToExcalidraw(el.src, MERMAID_CONFIG as never);
      elements = ex.convertToExcalidrawElements(res.elements as never, { regenerateIds: false });
      files = (res.files ?? null) as never;
    } else elements = toExcalidrawElements(ex, el.elements);
    const svg = await ex.exportToSvg({
      elements,
      appState: { exportBackground: false, exportWithDarkMode: false },
      files,
      exportPadding: 4,
    });
    const html = normalizeSvg(svg.outerHTML);
    const [, , w, h] = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
    const sizes = elements.filter((e) => e.type === 'text').map((e) => (e as { fontSize: number }).fontSize).sort((a, b) => a - b);
    return { html, natural: { w, h, font: sizes.length ? sizes[sizes.length >> 1] : 20 } };
  }
  if (el.type === 'image') {
    const src = /^(https?:|data:)/.test(el.src) ? el.src : '/' + el.src.replace(/^\.?\//, '');
    await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = resolve;
      img.onerror = () => reject(new Error(`cannot load image "${el.src}" (paths are relative to the project root)`));
      img.src = src;
    });
    return { html: `<img src="${src.replace(/"/g, '&quot;')}">` };
  }
  throw new Error(`no async renderer for ${el.type}`);
}

type ExcalidrawModule = typeof import('@excalidraw/excalidraw');

/**
 * Elements are either skeletons (what an agent writes: type, x, y, width, height,
 * label, start/end bindings) or full scene elements (what the drawing editor saves).
 */
export function toExcalidrawElements(ex: ExcalidrawModule, elements: Record<string, unknown>[]) {
  return elements.every((e) => typeof e.version === 'number')
    ? ex.restoreElements(elements as never, null)
    : ex.convertToExcalidrawElements(elements as never, { regenerateIds: false });
}

/** Make an SVG scale to its container: guarantee a viewBox, drop fixed width/height. */
export function normalizeSvg(src: string): string {
  const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName !== 'svg' || doc.querySelector('parsererror')) throw new Error('invalid SVG markup');
  if (!svg.getAttribute('viewBox')) {
    const w = parseFloat(svg.getAttribute('width') ?? '');
    const h = parseFloat(svg.getAttribute('height') ?? '');
    if (!(w > 0 && h > 0)) throw new Error('SVG needs a viewBox or numeric width/height');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.style.removeProperty('max-width');
  return new XMLSerializer().serializeToString(svg);
}
