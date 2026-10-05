import { pageDims, type Doc } from '../schema';

type Box = { x: number; y: number; w: number; h: number };

export type Measured = Box & {
  id: string;
  page: number;
  /** Column fragments of a flowed element that breaks across columns (else just one). */
  parts: Box[];
  overflowX: number;
  overflowY: number;
  fontSize: number;
  errors: string[];
  warnings: string[];
  widest: string | null; // text of the first run sticking out on the right
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Column geometry (screen px) of the multi-column context `inner` lays out in: the page's
 * flow box for flowed elements, else (and for span:"all") the element's own box.
 */
function columnsAround(inner: HTMLElement) {
  const mc = inner.closest('.el.span') ? inner : (inner.closest<HTMLElement>('[data-flowbox]') ?? inner);
  const r = mc.getBoundingClientRect();
  const cs = getComputedStyle(mc);
  const n = parseInt(cs.columnCount) || 1;
  const k = r.width / mc.offsetWidth || 1; // transforms scale the computed px values
  const gap = n > 1 ? (parseFloat(cs.columnGap) || 0) * k : 0;
  const colW = (r.width - (n - 1) * gap) / n;
  /** Right edge of the column a fragment starting at `left` sits in; null if past the last column. */
  const colRight = (left: number) => {
    if (left >= r.right - 0.5) return null;
    const c = Math.max(0, Math.min(n - 1, Math.floor((left - r.left + 0.5) / (colW + gap))));
    return r.left + c * (colW + gap) + colW;
  };
  return { colRight };
}

/**
 * How far (px) content sticks out of an element's box. Vertical extent uses child
 * block boxes (line boxes), not glyph extents, so tight line-heights don't read as
 * overflow. Horizontal extent checks every line fragment against its own column.
 */
export function contentOverflow(inner: HTMLElement): { x: number; y: number } {
  const ir = inner.getBoundingClientRect();
  let bottom = ir.top;
  for (const c of inner.children) bottom = Math.max(bottom, c.getBoundingClientRect().bottom);
  const { colRight } = columnsAround(inner);
  const range = document.createRange();
  range.selectNodeContents(inner);
  let x = 0;
  for (const r of range.getClientRects()) {
    const right = r.width > 0 ? colRight(r.left) : null;
    if (right !== null) x = Math.max(x, r.right - right);
  }
  return { x, y: Math.max(0, bottom - ir.bottom) };
}

/** First formula or text that extends past its column's right edge, as a short snippet. */
function widestRun(inner: HTMLElement): string | null {
  const { colRight } = columnsAround(inner);
  const sticksOut = (rects: Iterable<DOMRect>) => [...rects].some((r) => {
    const right = r.width > 0 ? colRight(r.left) : null;
    return right !== null && r.right > right + 0.5;
  });
  for (const k of inner.querySelectorAll<HTMLElement>('.katex, td, th'))
    if (sticksOut(k.getClientRects())) return snippet(k.textContent ?? '');
  const walker = document.createTreeWalker(inner, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    range.selectNodeContents(n);
    if (sticksOut(range.getClientRects())) return snippet(n.textContent ?? '');
  }
  return null;
}
const snippet = (t: string) => (t.length > 50 ? t.slice(0, 50) + '…' : t);

/** Read rendered geometry (mm) of every element straight from the DOM. */
export function measure(root: HTMLElement, doc: Doc): Measured[] {
  const { W } = pageDims(doc);
  return doc.elements.map((el) => {
    const o = root.querySelector<HTMLElement>(`[data-el="${CSS.escape(el.id)}"]`)!;
    const page = o.closest<HTMLElement>('[data-page]')!.getBoundingClientRect();
    const k = page.width / W;
    const box = (r: DOMRect): Box => ({ x: r2((r.left - page.left) / k), y: r2((r.top - page.top) / k), w: r2(r.width / k), h: r2(r.height / k) });
    const parts = [...o.getClientRects()].filter((r) => r.height > 0).map(box);
    const inner = o.querySelector<HTMLElement>('[data-inner]')!;
    const over = contentOverflow(inner);
    const errors: string[] = [];
    if (o.dataset.error) errors.push(o.dataset.error);
    inner.querySelectorAll<HTMLElement>('.katex-error').forEach((e) => errors.push(`LaTeX: ${e.title || e.textContent}`));
    const warnings: string[] = [];
    const req = Number(o.dataset.requested);
    if (el.placement === 'flow' && (el.type === 'text' || el.type === 'latex') && Number(o.dataset.fontSize) < req * 0.9)
      warnings.push(`shrunk from ${req}pt to ${o.dataset.fontSize}pt so a formula fits the column width (split the formula, or give the block "span": "all")`);
    if (el.type === 'text') {
      if (/^\s*\|?\s*:?-{3,}/m.test(el.md) && !inner.querySelector('table')) warnings.push('markdown table did not parse');
      const text = [...inner.childNodes].map((n) => (n as HTMLElement).innerText ?? n.textContent).join('');
      if (text.includes('$'))
        warnings.push('a literal "$" was rendered: math delimiters are unbalanced. In tables, "|" inside $..$ splits the cell: use \\vert or \\mid');
    }
    return {
      id: el.id,
      page: el.page,
      ...(parts[0] ?? box(o.getBoundingClientRect())),
      parts,
      overflowX: r2(over.x / k),
      overflowY: el.h === 'auto' ? 0 : r2(over.y / k),
      fontSize: Number(o.dataset.fontSize),
      errors,
      warnings,
      widest: over.x > 0 ? widestRun(inner) : null,
    };
  });
}
