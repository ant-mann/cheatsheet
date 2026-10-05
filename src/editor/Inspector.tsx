import { useEffect, useState } from 'react';
import type { Issue } from '../report';
import type { RawEl } from './model';

type Patch = (patch: Record<string, unknown>) => void;

/** Number input that tolerates partial typing ("0.") and commits only valid numbers. */
function NumField({ label, value, onChange, step = 0.1, placeholder }: {
  label: string;
  value: unknown;
  onChange: (v: number | undefined) => void;
  step?: number;
  placeholder?: string;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => setText(value === undefined ? '' : String(value)), [value]);
  const commit = (t: string) => {
    setText(t);
    if (t.trim() === '') onChange(undefined);
    else if (Number.isFinite(Number(t))) onChange(Number(t));
  };
  const bump = (d: number) => commit(String(Math.round(((Number(text) || 0) + d) * 1000) / 1000));
  return (
    <label className="field">
      <span>{label}</span>
      <input value={text} placeholder={placeholder} onChange={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') { e.preventDefault(); bump(e.shiftKey ? step * 10 : step); }
          if (e.key === 'ArrowDown') { e.preventDefault(); bump(e.shiftKey ? -step * 10 : -step); }
        }} />
      <button onClick={() => bump(-step)}>−</button>
      <button onClick={() => bump(step)}>+</button>
    </label>
  );
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: unknown; onChange: (v: string | undefined) => void; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value === undefined ? '' : String(value)} placeholder={placeholder} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)} />
    </label>
  );
}

function Check({ label, value, onChange }: { label: string; value: unknown; onChange: (v: boolean | undefined) => void }) {
  return (
    <label className="field check">
      <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked || undefined)} />
      <span>{label}</span>
    </label>
  );
}

const CONTENT_KEY: Record<string, string> = { text: 'md', latex: 'tex', mermaid: 'src', svg: 'svg', image: 'src' };

export function Inspector({ el, issues, pageCount, update, updateStyle, rename, remove, duplicate, editDrawing, flowed, moveInFlow, pin, unpin }: {
  el: RawEl;
  issues: Issue[];
  pageCount: number;
  update: Patch;
  updateStyle: Patch;
  rename: (id: string) => void;
  remove: () => void;
  duplicate: () => void;
  editDrawing: () => void;
  flowed: boolean;
  moveInFlow: (dir: -1 | 1) => void;
  pin: () => void;
  unpin: () => void;
}) {
  const st = el.style ?? {};
  const [idText, setIdText] = useState(el.id);
  useEffect(() => setIdText(el.id), [el.id]);
  const ck = CONTENT_KEY[el.type];
  return (
    <div className="inspector">
      <div className="row">
        <input className="id" value={idText} onChange={(e) => setIdText(e.target.value)} onBlur={() => idText !== el.id && rename(idText)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        <span className="type">{el.type}</span>
        <button onClick={duplicate} title="Ctrl+D">dup</button>
        <button onClick={remove} title="Delete">del</button>
      </div>
      {issues.map((i, n) => <div key={n} className={`issue ${i.severity}`}>{i.kind}: {i.msg}</div>)}

      <h4>Placement</h4>
      {flowed ? (
        <>
          <div className="row">
            <span className="muted">in column flow</span>
            <button onClick={() => moveInFlow(-1)}>↑ earlier</button>
            <button onClick={() => moveInFlow(1)}>↓ later</button>
            <button onClick={pin} title="fix it at its current position">pin</button>
          </div>
          <div className="grid2">
            <Check label="full width" value={el.span === 'all'} onChange={(v) => update({ span: v ? 'all' : undefined })} />
            <Check label="keep whole" value={el.keep} onChange={(v) => update({ keep: v })} />
            <NumField label="gap" value={el.gap} placeholder="0.5" onChange={(v) => update({ gap: v })} step={0.25} />
            <NumField label="page" value={el.page ?? 1} onChange={(v) => v && v >= 1 && v <= pageCount && update({ page: v })} step={1} />
          </div>
        </>
      ) : (
      <>
      <div className="row">
        <span className="muted">fixed position (mm)</span>
        <button onClick={unpin}>return to flow</button>
      </div>
      <div className="grid2">
        <NumField label="x" value={el.x} onChange={(v) => update({ x: v ?? 0 })} step={0.5} />
        <NumField label="y" value={el.y} placeholder={el.below ? 'stacked' : ''} onChange={(v) => update({ y: v })} step={0.5} />
        <NumField label="w" value={el.w} onChange={(v) => v !== undefined && v > 0 && update({ w: v })} step={0.5} />
        <NumField label="h" value={el.h === 'auto' ? undefined : el.h} placeholder="auto" onChange={(v) => update({ h: v !== undefined && v > 0 ? v : undefined })} step={0.5} />
        <TextField label="below" value={el.below} placeholder="id to stack under" onChange={(v) => update({ below: v })} />
        <NumField label="gap" value={el.gap} placeholder="0.5" onChange={(v) => update({ gap: v })} step={0.25} />
        <NumField label="page" value={el.page ?? 1} onChange={(v) => v && v >= 1 && v <= pageCount && update({ page: v })} step={1} />
      </div>
      </>
      )}

      <h4>Content</h4>
      {ck && (
        <textarea value={String(el[ck] ?? '')} rows={el.type === 'image' ? 1 : 8} spellCheck={false} onChange={(e) => update({ [ck]: e.target.value })} />
      )}
      {el.type === 'latex' && <Check label="display mode" value={el.display !== false} onChange={(v) => update({ display: v ? undefined : false })} />}
      {el.type === 'excalidraw' && <button className="wide" onClick={editDrawing}>Edit drawing…</button>}

      <h4>Text</h4>
      <NumField label="font pt" value={st.fontSize} placeholder="default" onChange={(v) => updateStyle({ fontSize: v !== undefined && v > 0 ? v : undefined })} step={0.1} />
      <div className="grid2">
        <NumField label="line h" value={st.lineHeight} placeholder="default" onChange={(v) => updateStyle({ lineHeight: v })} step={0.05} />
        <NumField label="columns" value={st.columns} onChange={(v) => updateStyle({ columns: v && v >= 1 ? Math.round(v) : undefined })} step={1} />
        <NumField label="col gap" value={st.columnGap} onChange={(v) => updateStyle({ columnGap: v })} step={0.5} />
      </div>
      <label className="field">
        <span>fit</span>
        <select value={String(el.fit ?? 'none')} onChange={(e) => update({ fit: e.target.value === 'none' ? undefined : e.target.value })}>
          <option value="none">none</option>
          <option value="shrink">shrink to box</option>
        </select>
      </label>
      {el.fit === 'shrink' && <NumField label="min pt" value={el.minFontSize} placeholder="0.3" onChange={(v) => update({ minFontSize: v })} step={0.1} />}
      <label className="field">
        <span>align</span>
        <select value={String(st.align ?? '')} onChange={(e) => updateStyle({ align: e.target.value || undefined })}>
          <option value="">left</option>
          <option value="center">center</option>
          <option value="right">right</option>
          <option value="justify">justify</option>
        </select>
      </label>
      <div className="grid2">
        <Check label="bold" value={st.bold} onChange={(v) => updateStyle({ bold: v })} />
        <Check label="italic" value={st.italic} onChange={(v) => updateStyle({ italic: v })} />
      </div>
      <TextField label="font" value={st.font} placeholder="default" onChange={(v) => updateStyle({ font: v })} />

      <h4>Box</h4>
      <div className="grid2">
        <TextField label="color" value={st.color} onChange={(v) => updateStyle({ color: v })} />
        <TextField label="bg" value={st.bg} onChange={(v) => updateStyle({ bg: v })} />
        <NumField label="padding" value={st.padding} onChange={(v) => updateStyle({ padding: v })} step={0.25} />
        <NumField label="radius" value={st.radius} onChange={(v) => updateStyle({ radius: v })} step={0.25} />
      </div>
      <div className="grid2">
        <Check label="border" value={st.border} onChange={(v) => updateStyle({ border: v })} />
        <Check label="allow overlap" value={el.allowOverlap} onChange={(v) => update({ allowOverlap: v })} />
      </div>
    </div>
  );
}
