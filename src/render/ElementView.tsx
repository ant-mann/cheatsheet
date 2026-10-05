import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DIAGRAMS, PT_PER_MM, type Doc, type El } from '../schema';
import { asyncHtml, syncHtml, type Rendered } from './content';
import { contentOverflow } from './measure';
import { mm, pt } from './units';

export type Epoch = {
  settled: Set<string>;
  check: () => void;
  /** Re-apply an element's font size multiplied by `scale` (used by page.fill). */
  relayout: Map<string, (scale: number) => void>;
};

const FLOW_TYPES = new Set(['text', 'latex']);

function contentKey(el: El): string {
  switch (el.type) {
    case 'text': return el.md;
    case 'latex': return `${el.display}${el.tex}`;
    case 'mermaid': return el.src;
    case 'excalidraw': return JSON.stringify(el.elements);
    case 'svg': return el.svg;
    case 'image': return el.src;
  }
}

type Content = Rendered & { error: string | null };

function useContent(el: El): Content | null {
  const key = el.type + '\0' + contentKey(el);
  const sync = useMemo<Content | null>(() => {
    try {
      const html = syncHtml(el);
      return html === null ? null : { html, error: null };
    } catch (e) {
      return { html: '', error: (e as Error).message };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const [async, setAsync] = useState<(Content & { key: string }) | null>(null);
  useEffect(() => {
    if (sync) return;
    let live = true;
    asyncHtml(el).then(
      (r) => live && setAsync({ key, ...r, error: null }),
      (e) => live && setAsync({ key, html: '', error: String(e?.message ?? e) }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (sync) return sync;
  return async?.key === key ? async : null;
}

/**
 * Text/LaTeX are laid out at >= LAYOUT_PT and scaled down with a transform.
 * Chrome text layout is linear, but KaTeX's table layout and px minimums are not:
 * at a few pt they misplace glyphs. Laying out large makes tiny text exact.
 */
const LAYOUT_PT = 12;

// upscale: lay out at >= LAYOUT_PT and scale down (off inside the flow box, which is scaled as a whole)
type Box = { outer: HTMLElement; inner: HTMLElement; upscale: boolean; fixedH: boolean; gap: number | undefined };

function applyFontSize({ outer, inner, upscale, fixedH, gap }: Box, fs: number) {
  const k = upscale ? Math.max(1, LAYOUT_PT / fs) : 1;
  const st = inner.style;
  st.fontSize = pt(fs * k);
  st.width = k === 1 ? '' : `${100 * k}%`;
  st.height = fixedH ? `${100 * k}%` : '';
  st.transform = k === 1 ? '' : `scale(${1 / k})`;
  st.columnGap = gap === undefined ? '' : mm(gap * k);
  if (!fixedH) {
    // the transform doesn't shrink the layout box, so size the outer box from the scaled content
    outer.style.height = '';
    if (k !== 1) {
      const cs = getComputedStyle(outer);
      const extra = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((a, p) => a + parseFloat(cs[p as 'paddingTop']), 0);
      outer.style.height = `${inner.getBoundingClientRect().height + extra}px`;
    }
  }
}

/** Largest font size (pt) in [min, max] whose content fits the box (or only its width). */
function shrinkToFit(b: Box, max: number, min: number, widthOnly = false): number {
  const fits = (fs: number) => {
    applyFontSize(b, fs);
    const o = contentOverflow(b.inner);
    return o.x <= 0.1 && (widthOnly || o.y <= 0.1);
  };
  if (fits(max)) return max;
  let lo = min, hi = max;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  const fs = Math.floor(lo * 100) / 100;
  applyFontSize(b, fs);
  return fs;
}

/**
 * Diagrams are sized so their labels render at `fs` pt; `w` (if any) caps the width,
 * and a fixed `h` caps the height. Returns the effective label size in pt.
 */
function sizeDiagram(outer: HTMLElement, el: El, natural: NonNullable<Rendered['natural']>, fs: number, pad: number, maxW: number): number {
  const naturalW = (natural.w * fs) / PT_PER_MM / natural.font;
  const naturalH = (naturalW * natural.h) / natural.w;
  let w = Math.min(naturalW, (el.w ?? Infinity) - 2 * pad, maxW - 2 * pad);
  if (el.h !== 'auto') w = Math.min(w, (naturalW * (el.h - 2 * pad)) / naturalH);
  outer.style.width = mm(w + 2 * pad);
  return (fs * w) / naturalW;
}

export function ElementView({ el, doc, unit, epoch, colW, onPointerDown }: {
  el: El;
  doc: Doc;
  unit: string; // re-measure when the zoom changes
  colW: number; // width available to a flowed element (mm)
  epoch: Epoch;
  onPointerDown?: (id: string, e: React.PointerEvent) => void;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const s = el.style;
  const content = useContent(el);
  const baseFs = s.fontSize ?? doc.defaults.fontSize;
  const fixedH = el.h !== 'auto';
  const flow = FLOW_TYPES.has(el.type);
  const diagram = DIAGRAMS.has(el.type);
  const inFlow = el.placement === 'flow';

  useLayoutEffect(() => {
    if (!content) return;
    const relayout = (scale: number) => {
      const o = outer.current!;
      const fs = baseFs * scale;
      let actual = fs;
      if (diagram && content.natural) actual = sizeDiagram(o, el, content.natural, fs, s.padding ?? 0, inFlow ? colW : Infinity);
      else {
        const b: Box = { outer: o, inner: inner.current!, upscale: flow && !inFlow, fixedH, gap: s.columns ? (s.columnGap ?? 1.5) : undefined };
        if (el.fit === 'shrink' && fixedH) actual = shrinkToFit(b, fs, el.minFontSize);
        // flowed text never sticks out of its column: a too-wide formula shrinks its own block
        else if (el.placement === 'flow') actual = shrinkToFit(b, fs, el.minFontSize, true);
        else applyFontSize(b, fs);
      }
      o.dataset.fontSize = String(Math.round(actual * 100) / 100);
      o.dataset.requested = String(Math.round(fs * 100) / 100);
    };
    relayout(1);
    epoch.relayout.set(el.id, relayout);
    epoch.settled.add(el.id);
    epoch.check();
    // only on real changes: a re-run after layout would undo page.fill scaling
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, el, epoch, unit, colW]);

  return (
    <div
      ref={outer}
      className={`el el-${el.type}${el.keep ? ' keep' : ''}${el.span ? ' span' : ''}${s.card ? ' card' : ''}`}
      data-el={el.id}
      data-error={content?.error ?? undefined}
      onPointerDown={onPointerDown && ((e) => onPointerDown(el.id, e))}
      style={{
        // flowed elements sit in the page's flow box; "below" gets its top from layout()
        left: !inFlow ? mm(el.x!) : undefined,
        top: el.placement === 'abs' ? mm(el.y!) : undefined,
        marginTop: inFlow ? mm(el.gap) : undefined,
        width: !diagram && el.w !== undefined ? mm(el.w) : undefined,
        height: fixedH ? mm(el.h as number) : undefined,
        padding: s.padding !== undefined ? mm(s.padding) : undefined,
        border: typeof s.border === 'string' ? s.border : undefined,
        boxShadow: s.border === true ? `inset 0 0 0 ${mm(0.1)} ${s.accent ?? '#888'}` : undefined,
        borderRadius: s.radius !== undefined ? mm(s.radius) : undefined,
        background: s.bg,
        color: s.color ?? doc.defaults.color,
        fontFamily: (s.font ?? doc.defaults.font) ? `${s.font ?? doc.defaults.font}, 'Noto Emoji Variable'` : undefined, // else the theme's
        lineHeight: s.lineHeight ?? doc.defaults.lineHeight,
        textAlign: s.align,
        fontWeight: s.bold ? 700 : undefined,
        fontStyle: s.italic ? 'italic' : undefined,
        ['--accent' as string]: s.accent,
      }}
    >
      <div
        ref={inner}
        data-inner=""
        className={flow ? 'flow' : fixedH ? 'fig fixed' : 'fig'}
        style={{ columnCount: s.columns, columnFill: s.columns && fixedH ? 'auto' : undefined }}
        dangerouslySetInnerHTML={{ __html: content?.error ? `<span class="render-error">${escapeHtml(content.error)}</span>` : (content?.html ?? '') }}
      />
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
