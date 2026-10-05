import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Moveable from 'react-moveable';
import { pageDims, parseDoc, type Doc } from '../schema';
import type { Report } from '../report';
import { Sheet } from '../render/Sheet';
import { Overlay } from '../render/Overlay';
import { Inspector } from './Inspector';
import { newElement, r1, TEMPLATES, uniqueId, type RawDoc, type RawEl } from './model';
import './editor.css';

const ExcalidrawModal = lazy(() => import('./ExcalidrawModal').then((m) => ({ default: m.ExcalidrawModal })));

const PX_PER_MM = 96 / 25.4;
const serialize = (d: RawDoc) => JSON.stringify(d, null, 2) + '\n';

export function Editor({ name }: { name: string }) {
  const [raw, setRaw] = useState<RawDoc | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastGood, setLastGood] = useState<Doc | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | null>(null); // null = fit page width on first render
  const canvasRef = useRef<HTMLDivElement>(null);
  const [overlay, setOverlay] = useState(false);
  const [drawing, setDrawing] = useState<string | null>(null);
  const lastSaved = useRef('');
  const saveTimer = useRef<number>(undefined);
  const moveable = useRef<Moveable>(null);
  const resizeTop = useRef(0);
  // React re-applies positions after each change; keep the handles in sync
  useEffect(() => moveable.current?.updateRect());

  // re-render once the canvas exists (and on resize) so "fit" zoom can measure it
  const [, relayout] = useState(0);
  useEffect(() => {
    const on = () => relayout((n) => n + 1);
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [lastGood !== null]);

  const parsed = useMemo(() => (raw ? parseDoc(raw) : null), [raw]);
  useEffect(() => {
    if (parsed?.doc) setLastGood(parsed.doc);
  }, [parsed]);
  const doc = lastGood;

  // ---- load + live reload when the file changes on disk (e.g. the agent edited it)
  const load = useCallback(async () => {
    const res = await fetch(`/api/doc/${encodeURIComponent(name)}`);
    const text = await res.text();
    if (text === lastSaved.current) return; // our own write echoing back
    try {
      setRaw(JSON.parse(text));
      setLoadError(null);
      lastSaved.current = text;
    } catch (e) {
      setLoadError(`sheets/${name}.json is not valid JSON: ${(e as Error).message}`);
    }
  }, [name]);
  useEffect(() => {
    load();
    const onChange = (d: { name: string }) => d.name === name && load();
    import.meta.hot?.on('sheet:changed', onChange);
    return () => import.meta.hot?.off('sheet:changed', onChange);
  }, [load, name]);

  // ---- edits: update local state immediately, write the file shortly after
  const commit = useCallback((next: RawDoc) => {
    setRaw(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const text = serialize(next);
      lastSaved.current = text;
      fetch(`/api/doc/${encodeURIComponent(name)}`, { method: 'PUT', body: text });
    }, 250);
  }, [name]);

  const patchEl = useCallback((id: string, patch: Record<string, unknown>, stylePatch?: Record<string, unknown>) => {
    if (!raw) return;
    const elements = raw.elements.map((e) => {
      if (e.id !== id) return e;
      const next: RawEl = { ...e, ...patch };
      if (stylePatch) next.style = { ...(e.style ?? {}), ...stylePatch };
      for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
      if (next.style) {
        for (const k of Object.keys(next.style)) if (next.style[k] === undefined) delete next.style[k];
        if (!Object.keys(next.style).length) delete next.style;
      }
      return next;
    });
    commit({ ...raw, elements });
  }, [raw, commit]);

  const selEl = raw?.elements.find((e) => e.id === sel) ?? null;
  const selPage = Number(selEl?.page ?? 1);
  const pageCount = Number(raw?.page?.count ?? 1);

  const addEl = (type: string) => {
    if (!raw) return;
    const el = newElement(raw, type, selEl ? selPage : 1);
    commit({ ...raw, elements: [...raw.elements, el] });
    setSel(el.id);
  };
  const removeSel = () => {
    if (!raw || !sel) return;
    commit({ ...raw, elements: raw.elements.filter((e) => e.id !== sel) });
    setSel(null);
  };
  const duplicateSel = () => {
    if (!raw || !selEl) return;
    const el: RawEl = { ...structuredClone(selEl), id: uniqueId(raw, selEl.id.replace(/\d+$/, '')) };
    if (el.x !== undefined) Object.assign(el, { x: Number(el.x) + 2, y: Number(el.y ?? 0) + 2 });
    const i = raw.elements.indexOf(selEl);
    commit({ ...raw, elements: [...raw.elements.slice(0, i + 1), el, ...raw.elements.slice(i + 1)] });
    setSel(el.id);
  };
  const isFlowed = (e: RawEl) => e.x === undefined && e.below === undefined;
  /** Move the selected flowed element before/after its neighbouring flowed element. */
  const moveInFlow = (dir: -1 | 1) => {
    if (!raw || !selEl) return;
    const els = [...raw.elements];
    const i = els.indexOf(selEl);
    let j = i + dir;
    while (j >= 0 && j < els.length && !(isFlowed(els[j]) && Number(els[j].page ?? 1) === selPage)) j += dir;
    if (j < 0 || j >= els.length) return;
    els.splice(i, 1);
    els.splice(j, 0, selEl);
    commit({ ...raw, elements: els });
  };
  /** Freeze a flowed element where it currently is (it then stays put when the flow changes). */
  const pinSel = () => {
    const m = report?.elements.find((e) => e.id === sel);
    if (m && sel) patchEl(sel, { x: m.x, y: m.y, w: m.w, span: undefined, keep: undefined });
  };
  const unpinSel = () => sel && patchEl(sel, { x: undefined, y: undefined, below: undefined, gap: undefined });
  const setPages = (n: number) => raw && n >= 1 && commit({ ...raw, page: { ...(raw.page ?? {}), count: n } });

  // ---- keyboard: nudge / delete / duplicate
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sel || /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName) || drawing) return;
      const step = e.shiftKey ? 5 : 0.5;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d && selEl) {
        e.preventDefault();
        patchEl(sel, { x: r1(Number(selEl.x) + d[0]), y: r1(Number(selEl.y) + d[1]) });
      } else if (e.key === 'Delete' || e.key === 'Backspace') removeSel();
      else if (e.key === 'd' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        duplicateSel();
      } else if (e.key === 'Escape') setSel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (loadError) return <div className="banner error">{loadError}</div>;
  if (!raw || !doc) return <div className="banner">{parsed?.errors ? parsed.errors.join('\n') : 'loading…'}</div>;

  const { W, H } = pageDims(doc);
  const M = doc.page.margin;
  const fit = canvasRef.current ? (canvasRef.current.clientWidth - 48) / (W * PX_PER_MM) : 1;
  const z = zoom ?? fit;
  const px = PX_PER_MM * z; // px per mm on screen
  const g = doc.guides;
  const colW = g ? (W - 2 * M - (g.columns - 1) * g.gutter) / g.columns : 0;
  const vGuides = [0, M, W - M, W, ...(g ? Array.from({ length: g.columns }, (_, i) => [M + i * (colW + g.gutter), M + i * (colW + g.gutter) + colW]).flat() : [])].map((v) => v * px);
  const hGuides = [0, M, H - M, H].map((v) => v * px);
  const errors = report?.issues.filter((i) => i.severity === 'error').length ?? 0;
  const target = sel ? document.querySelector<HTMLElement>(`[data-el="${CSS.escape(sel)}"]`) : null;

  return (
    <div className="editor">
      <header>
        <b>{name}</b>
        <span className="sep" />
        {Object.keys(TEMPLATES).map((t) => <button key={t} onClick={() => addEl(t)}>+ {t}</button>)}
        <span className="sep" />
        <button onClick={() => setZoom(Math.max(0.25, z / 1.25))}>−</button>
        <span>{Math.round(z * 100)}%</span>
        <button onClick={() => setZoom(Math.min(30, z * 1.25))}>+</button>
        <button onClick={() => setZoom(null)}>fit</button>
        <label><input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} /> grid + ids</label>
        <span className="sep" />
        pages <button onClick={() => setPages(pageCount - 1)}>−</button> {pageCount} <button onClick={() => setPages(pageCount + 1)}>+</button>
        <span className="sep" />
        <span className={errors ? 'bad' : 'good'}>{report ? report.summary : 'checking…'}</span>
      </header>
      {parsed?.errors && <div className="banner error">Schema errors (showing last valid version):{'\n'}{parsed.errors.join('\n')}</div>}
      <main>
        <div ref={canvasRef} className="canvas" onPointerDown={(e) => e.target === e.currentTarget && setSel(null)}>
          <Sheet
            doc={doc}
            unit={`${px}px`}
            onReport={setReport}
            onElementPointerDown={(id) => setSel(id)}
            pageOverlay={(p) => (
              <>
                {overlay ? (
                  <Overlay doc={doc} page={p} report={report} label={11 / px} minor={px >= 12 ? 1 : 5} />
                ) : (
                  <GuideColumns doc={doc} />
                )}
                {target && p === selPage && selEl && !isFlowed(selEl) && (
                  <Moveable
                    ref={moveable}
                    target={target}
                    draggable
                    resizable
                    snappable
                    snapThreshold={6}
                    isDisplaySnapDigit
                    verticalGuidelines={vGuides}
                    horizontalGuidelines={hGuides}
                    elementGuidelines={[...document.querySelectorAll<HTMLElement>(`[data-page="${p}"] .el`)].filter((n) => n !== target)}
                    snapDirections={{ left: true, right: true, top: true, bottom: true, center: true, middle: true }}
                    elementSnapDirections={{ left: true, right: true, top: true, bottom: true }}
                    onDrag={(e) => {
                      e.target.style.left = `${e.left}px`;
                      e.target.style.top = `${e.top}px`;
                    }}
                    onDragEnd={(e) => {
                      if (!e.isDrag) return;
                      const t = e.target as HTMLElement;
                      // dragging pins the element: it stops stacking under its anchor
                      patchEl(sel!, { x: r1(parseFloat(t.style.left) / px), y: r1(parseFloat(t.style.top) / px), below: undefined, gap: undefined });
                    }}
                    onResizeStart={(e) => {
                      resizeTop.current = parseFloat(getComputedStyle(e.target).top);
                    }}
                    onResize={(e) => {
                      e.target.style.width = `${e.width}px`;
                      e.target.style.height = `${e.height}px`;
                      e.target.style.left = `${e.drag.left}px`;
                      e.target.style.top = `${e.drag.top}px`;
                    }}
                    onResizeEnd={(e) => {
                      if (!e.isDrag) return;
                      const t = e.target as HTMLElement;
                      const hChanged = e.lastEvent && Math.abs(e.lastEvent.dist[1]) > 0.5;
                      const topMoved = Math.abs(parseFloat(t.style.top) - resizeTop.current) > 0.5;
                      patchEl(sel!, {
                        x: r1(parseFloat(t.style.left) / px),
                        w: r1(parseFloat(t.style.width) / px),
                        ...(selEl?.below === undefined || topMoved ? { y: r1(parseFloat(t.style.top) / px), below: undefined, gap: undefined } : {}),
                        ...(hChanged || selEl?.h !== undefined ? { h: r1(parseFloat(t.style.height) / px) } : {}),
                      });
                    }}
                  />
                )}
              </>
            )}
          />
        </div>
        <aside>
          {selEl ? (
            <Inspector
              el={selEl}
              issues={report?.issues.filter((i) => i.id === selEl.id) ?? []}
              pageCount={pageCount}
              update={(p) => patchEl(selEl.id, p)}
              updateStyle={(p) => patchEl(selEl.id, {}, p)}
              rename={(id) => {
                if (!/^[A-Za-z0-9_.-]+$/.test(id) || raw.elements.some((e) => e.id === id)) return;
                patchEl(selEl.id, { id });
                setSel(id);
              }}
              remove={removeSel}
              duplicate={duplicateSel}
              editDrawing={() => setDrawing(selEl.id)}
              flowed={isFlowed(selEl)}
              moveInFlow={moveInFlow}
              pin={pinSel}
              unpin={unpinSel}
            />
          ) : (
            <IssueList report={report} onPick={setSel} />
          )}
        </aside>
      </main>
      {drawing && (
        <Suspense fallback={<div className="modal">loading editor…</div>}>
          <ExcalidrawModal
            elements={(raw.elements.find((e) => e.id === drawing)?.elements as Record<string, unknown>[]) ?? []}
            onSave={(els) => {
              patchEl(drawing, { elements: els });
              setDrawing(null);
            }}
            onClose={() => setDrawing(null)}
          />
        </Suspense>
      )}
    </div>
  );
}

function GuideColumns({ doc }: { doc: Doc }) {
  const g = doc.guides;
  if (!g) return null;
  const { W, H } = pageDims(doc);
  const M = doc.page.margin;
  const colW = (W - 2 * M - (g.columns - 1) * g.gutter) / g.columns;
  return (
    <svg className="overlay" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {Array.from({ length: g.columns }, (_, i) => (
        <rect key={i} x={M + i * (colW + g.gutter)} y={M} width={colW} height={H - 2 * M} fill="#08f" fillOpacity={0.035} />
      ))}
    </svg>
  );
}

function IssueList({ report, onPick }: { report: Report | null; onPick: (id: string) => void }) {
  if (!report) return <p className="muted">rendering…</p>;
  return (
    <div className="inspector">
      <h4>{report.summary}</h4>
      {report.issues.length === 0 && <p className="muted">No problems. Click an element to edit it.</p>}
      {report.issues.map((i, n) => (
        <div key={n} className={`issue ${i.severity}`} onClick={() => i.id && onPick(i.id)}>
          <b>{i.id}</b> {i.kind}: {i.msg}
        </div>
      ))}
      <h4>Pages</h4>
      {report.pages.map((p) => <div key={p.page} className="muted">page {p.page}: {p.fill} filled</div>)}
    </div>
  );
}
