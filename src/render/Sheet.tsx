import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { columnsOf, pageDims, type Doc } from '../schema';
import { buildReport, type Report } from '../report';
import { ElementView, type Epoch } from './ElementView';
import { measure } from './measure';
import { layout } from './layout';
import { mm } from './units';

/**
 * Renders every page of a doc. `unit` is the CSS length of one millimetre.
 * `onReport` fires once all elements have rendered (and after every change).
 */
export function Sheet({ doc, unit, onReport, pageOverlay, onElementPointerDown }: {
  doc: Doc;
  unit: string;
  onReport?: (r: Report) => void;
  pageOverlay?: (page: number) => ReactNode;
  onElementPointerDown?: (id: string, e: React.PointerEvent) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const { W, H } = pageDims(doc);
  const reportRef = useRef(onReport);
  reportRef.current = onReport;

  const epoch = useMemo<Epoch>(() => {
    let done = false;
    const e: Epoch = {
      settled: new Set(),
      relayout: new Map(),
      check: () => {
        if (done || !root.current || doc.elements.some((el) => !e.settled.has(el.id))) return;
        done = true;
        // fonts used only by some glyphs (emoji, bold, italic) load after first layout
        document.fonts.ready.then(() => {
          if (!root.current) return;
          e.relayout.forEach((fn) => fn(1));
          const result = layout(root.current, doc, e.relayout);
          requestAnimationFrame(() => {
            if (root.current) reportRef.current?.(buildReport(doc, measure(root.current, doc), result));
          });
        });
      },
    };
    return e;
  }, [doc, unit]);

  useEffect(() => epoch.check(), [epoch]);

  const pages = Array.from({ length: doc.page.count }, (_, i) => i + 1);
  const M = doc.page.margin;
  const cols = columnsOf(doc);
  const gutter = doc.guides?.gutter ?? 0;
  // The flow box is laid out FLOW_K times larger and scaled down, like text blocks
  // (see ElementView): keeps tiny text and KaTeX exact while columns fragment it.
  const minFs = Math.min(...doc.elements.filter((e) => e.placement === 'flow').map((e) => e.style.fontSize ?? doc.defaults.fontSize));
  const flowK = Math.min(60, Math.max(1, 24 / minFs));
  const view = (el: Doc['elements'][number]) => (
    <ElementView key={el.id} el={el} doc={doc} unit={unit} epoch={epoch} colW={el.span ? W - 2 * M : cols[0].w} onPointerDown={onElementPointerDown} />
  );
  return (
    <div ref={root} className={`sheet theme-${doc.theme}`} style={{ ['--u' as string]: unit }}>
      {pages.map((p) => (
        <div key={p} className="page" data-page={p} style={{ width: mm(W), height: mm(H) }}>
          <div className="flowwrap" style={{ left: mm(M), top: mm(M), width: mm(W - 2 * M), height: mm(H - 2 * M) }}>
            <div
              className="flowbox"
              data-flowbox={p}
              style={{
                ['--u' as string]: `calc(${flowK} * ${unit})`,
                width: mm(W - 2 * M),
                height: mm(H - 2 * M),
                columnCount: cols.length,
                columnGap: mm(gutter),
                columnRule: doc.guides?.rule ? `${mm(0.1)} solid #ccc` : undefined,
                transform: `scale(${1 / flowK})`,
              }}
            >
              {doc.elements.filter((el) => el.page === p && el.placement === 'flow').map(view)}
            </div>
          </div>
          {doc.elements.filter((el) => el.page === p && el.placement !== 'flow').map(view)}
          {pageOverlay?.(p)}
        </div>
      ))}
    </div>
  );
}
