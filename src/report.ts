import { pageDims, type Doc } from './schema';
import type { Measured } from './render/measure';
import type { LayoutResult } from './render/layout';

export type Rect = { x: number; y: number; w: number; h: number };
export type Issue = { severity: 'error' | 'warning'; id?: string; kind: string; msg: string };
export type PageStats = { page: number; fill: string; free: Rect[] };
export type Report = {
  ok: boolean;
  summary: string;
  /** Font multiplier page.fill applied to flowed elements. */
  fillScale: number;
  issues: Issue[];
  pages: PageStats[];
  elements: (Rect & { id: string; page: number; fontSize: number; parts: Rect[] })[];
};

const TOL = 0.1; // mm; below this, overflow/overlap is rounding noise
const f = (n: number) => String(Math.round(n * 10) / 10);

export function buildReport(doc: Doc, measured: Measured[], layout: LayoutResult): Report {
  const { W, H } = pageDims(doc);
  const M = doc.page.margin;
  const issues: Issue[] = [];
  const byId = new Map(doc.elements.map((e) => [e.id, e]));

  for (const m of measured) {
    const el = byId.get(m.id)!;
    for (const e of m.errors) issues.push({ severity: 'error', id: m.id, kind: 'render', msg: e });
    for (const w of m.warnings) issues.push({ severity: 'warning', id: m.id, kind: 'render', msg: w });
    if (m.overflowY > TOL)
      issues.push({
        severity: 'error', id: m.id, kind: 'overflow',
        msg: `content is ${f(m.overflowY)}mm taller than the box (h=${f(m.h)}). Fix: h=${f(m.h + m.overflowY + 0.2)}, h:"auto", smaller style.fontSize, or fit:"shrink".`,
      });
    if (m.overflowX > TOL)
      issues.push({
        severity: 'error', id: m.id, kind: 'overflow',
        msg: `content is ${f(m.overflowX)}mm wider than the box (w=${f(m.w)})${el.style.columns ? ' (fixed-h column boxes overflow sideways)' : ''}${m.widest ? `; too wide: "${m.widest}" (formulas don't wrap: split into several $..$, or move to a latex element)` : ''}. Fix: w=${f(m.w + m.overflowX + 0.2)}, smaller style.fontSize, or fit:"shrink".`,
      });
    if (layout.overflowing.includes(m.id)) {
      issues.push({
        severity: 'error', id: m.id, kind: 'flow-full',
        msg: `flowed element ends at y=${f(m.y + m.h)}, past the bottom of page ${m.page}'s content area. Move some flowed elements to another page ("page": n), add a page, use smaller fonts, or set page.fill:true.`,
      });
      continue;
    }
    const right = m.x + m.w, bottom = m.y + m.h;
    if (m.x < -TOL || m.y < -TOL || right > W + TOL || bottom > H + TOL)
      issues.push({
        severity: 'error', id: m.id, kind: 'off-page',
        msg: `box x ${f(m.x)}..${f(right)}, y ${f(m.y)}..${f(bottom)} leaves the ${f(W)}x${f(H)} page.`,
      });
    else if (m.x < M - TOL || m.y < M - TOL || right > W - M + TOL || bottom > H - M + TOL)
      issues.push({
        severity: 'warning', id: m.id, kind: 'margin',
        msg: `box x ${f(m.x)}..${f(right)}, y ${f(m.y)}..${f(bottom)} enters the ${f(M)}mm margin (content area x ${f(M)}..${f(W - M)}, y ${f(M)}..${f(H - M)}).`,
      });
    if (el.fit === 'shrink' && m.fontSize < (el.style.fontSize ?? doc.defaults.fontSize))
      if (m.fontSize <= el.minFontSize + 0.01)
        issues.push({ severity: 'warning', id: m.id, kind: 'shrink-floor', msg: `fit:"shrink" hit minFontSize ${el.minFontSize}pt; content may still overflow.` });
  }

  for (let i = 0; i < measured.length; i++)
    for (let j = i + 1; j < measured.length; j++) {
      const a = measured[i], b = measured[j];
      const ea = byId.get(a.id)!, eb = byId.get(b.id)!;
      if (a.page !== b.page || ea.allowOverlap || eb.allowOverlap) continue;
      if (ea.placement === 'flow' && eb.placement === 'flow') continue; // the column flow can't overlap itself
      hit: for (const pa of a.parts)
        for (const pb of b.parts) {
          const ix = Math.min(pa.x + pa.w, pb.x + pb.w) - Math.max(pa.x, pb.x);
          const iy = Math.min(pa.y + pa.h, pb.y + pb.h) - Math.max(pa.y, pb.y);
          if (ix > TOL && iy > TOL) {
            const flowNote = ea.placement === 'flow' || eb.placement === 'flow'
              ? ' Flowed content fills the columns in order, so put fixed elements below the end of the last column (see free areas) or move them to another page.'
              : ' Move/resize one, or set allowOverlap:true on purpose.';
            issues.push({
              severity: 'error', id: a.id, kind: 'overlap',
              msg: `overlaps "${b.id}" by ${f(ix)}x${f(iy)}mm at x=${f(Math.max(pa.x, pb.x))}, y=${f(Math.max(pa.y, pb.y))}.${flowNote}`,
            });
            break hit;
          }
        }
    }

  const pages: PageStats[] = [];
  for (let p = 1; p <= doc.page.count; p++) pages.push(pageStats(p, measured.filter((m) => m.page === p).flatMap((m) => m.parts), W, H, M));

  const errs = issues.filter((i) => i.severity === 'error').length;
  const warns = issues.length - errs;
  return {
    ok: errs === 0,
    summary: `${measured.length} elements, ${errs} errors, ${warns} warnings`,
    fillScale: Math.round(layout.scale * 1000) / 1000,
    issues,
    pages,
    elements: measured.map((m) => ({ id: m.id, page: m.page, x: m.x, y: m.y, w: m.w, h: m.h, fontSize: m.fontSize, parts: m.parts })),
  };
}

/** Fill ratio of the content area plus the largest empty rectangles (1mm grid). */
function pageStats(page: number, boxes: Rect[], W: number, H: number, M: number): PageStats {
  const x0 = Math.ceil(M), y0 = Math.ceil(M);
  const cols = Math.floor(W - M) - x0, rows = Math.floor(H - M) - y0;
  const occ = new Uint8Array(cols * rows);
  const mark = (r: Rect) => {
    const c1 = Math.max(0, Math.floor(r.x - x0)), c2 = Math.min(cols, Math.ceil(r.x + r.w - x0));
    const r1 = Math.max(0, Math.floor(r.y - y0)), r2 = Math.min(rows, Math.ceil(r.y + r.h - y0));
    for (let y = r1; y < r2; y++) occ.fill(1, y * cols + c1, y * cols + Math.max(c1, c2));
  };
  boxes.forEach(mark);
  let used = 0;
  for (const v of occ) used += v;
  const free: Rect[] = [];
  while (free.length < 6) {
    const r = largestEmpty(occ, cols, rows);
    if (!r || r.w * r.h < 30) break;
    const rect = { x: r.x + x0, y: r.y + y0, w: r.w, h: r.h };
    mark(rect);
    if (r.w >= 3 && r.h >= 3) free.push(rect); // skip gutter slivers
  }

  return { page, fill: `${Math.round((100 * used) / (cols * rows))}%`, free };
}

/** Maximal all-zero rectangle via the histogram/stack method. */
function largestEmpty(occ: Uint8Array, cols: number, rows: number): Rect | null {
  const hgt = new Int32Array(cols);
  let best: Rect | null = null, bestA = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) hgt[x] = occ[y * cols + x] ? 0 : hgt[x] + 1;
    const stack: number[] = [];
    for (let x = 0; x <= cols; x++) {
      const hx = x < cols ? hgt[x] : 0;
      while (stack.length && hgt[stack[stack.length - 1]] >= hx) {
        const top = stack.pop()!;
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const a = hgt[top] * (x - left);
        if (a > bestA) {
          bestA = a;
          best = { x: left, y: y - hgt[top] + 1, w: x - left, h: hgt[top] };
        }
      }
      stack.push(x);
    }
  }
  return best;
}
