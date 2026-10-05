import { pageDims, type Doc } from '../schema';
import { mm } from './units';

export type LayoutResult = {
  /** Font multiplier applied to flowed elements (1 unless page.fill). */
  scale: number;
  /** Flowed elements (partly) pushed past the last column of their page. */
  overflowing: string[];
};

/**
 * Positions what the browser doesn't: "below" elements go under their anchor's measured
 * bottom. Flowed elements are laid out by the page's multi-column flow box (see Sheet);
 * with page.fill their fonts are scaled by the largest factor that still fits.
 */
export function layout(root: HTMLElement, doc: Doc, relayout: Map<string, (scale: number) => void>): LayoutResult {
  const { W } = pageDims(doc);
  const node = (id: string) => root.querySelector<HTMLElement>(`[data-el="${CSS.escape(id)}"]`)!;
  const byId = new Map(doc.elements.map((e) => [e.id, e]));
  const flowed = doc.elements.filter((e) => e.placement === 'flow');

  const placed = new Set<string>();
  const place = (id: string) => {
    const el = byId.get(id)!;
    if (placed.has(id) || el.placement !== 'below') return;
    place(el.below!);
    const n = node(id);
    const page = n.closest('[data-page]')!.getBoundingClientRect();
    const a = node(el.below!).getBoundingClientRect();
    n.style.top = mm((a.bottom - page.top) / (page.width / W) + el.gap);
    placed.add(id);
  };
  doc.elements.forEach((e) => place(e.id));

  /** Flowed elements with a fragment past the flow box's last column. */
  const overflowing = () =>
    flowed
      .filter((e) => {
        const n = node(e.id);
        const box = n.closest('[data-flowbox]')!.getBoundingClientRect();
        return [...n.getClientRects()].some((r) => r.height > 0 && r.right > box.right + 1);
      })
      .map((e) => e.id);

  let scale = 1;
  if (doc.page.fill && flowed.length) {
    const run = (s: number) => {
      flowed.forEach((e) => relayout.get(e.id)?.(s));
      return overflowing().length === 0;
    };
    let lo = 0.05, hi = 10;
    for (let i = 0; i < 18; i++) {
      const mid = Math.sqrt(lo * hi);
      if (run(mid)) lo = mid;
      else hi = mid;
    }
    scale = lo;
    run(scale);
  }
  return { scale, overflowing: overflowing() };
}
