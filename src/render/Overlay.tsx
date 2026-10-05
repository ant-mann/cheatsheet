import { pageDims, type Doc } from '../schema';
import type { Report } from '../report';

/**
 * Debug layer drawn in page millimetres: grid with labelled rulers, margins,
 * guide columns, and every element's measured box tagged with its id.
 * `label` is the label text height in mm; `minor` the minor grid spacing.
 */
export function Overlay({ doc, page, report, label, minor, origin = [0, 0] }: {
  doc: Doc;
  page: number;
  report: Report | null;
  label: number;
  minor: number;
  origin?: [number, number]; // top-left of the captured region: rulers are drawn along it
}) {
  const [ox, oy] = origin;
  const { W, H } = pageDims(doc);
  const M = doc.page.margin;
  const lw = label / 12;
  const bad = new Set(report?.issues.filter((i) => i.severity === 'error').map((i) => i.id));
  const lines = [];
  for (let x = minor; x < W; x += minor) {
    const major = Math.abs(x % 10) < 1e-6 || Math.abs((x % 10) - 10) < 1e-6;
    lines.push(<line key={`x${x}`} x1={x} y1={0} x2={x} y2={H} stroke={major ? '#e05' : '#0af'} strokeOpacity={major ? 0.35 : 0.18} strokeWidth={lw} />);
    if (major) lines.push(<text key={`tx${x}`} x={x + lw * 2} y={oy + label} fontSize={label} fill="#e05">{Math.round(x)}</text>);
  }
  for (let y = minor; y < H; y += minor) {
    const major = Math.abs(y % 10) < 1e-6 || Math.abs((y % 10) - 10) < 1e-6;
    lines.push(<line key={`y${y}`} x1={0} y1={y} x2={W} y2={y} stroke={major ? '#e05' : '#0af'} strokeOpacity={major ? 0.35 : 0.18} strokeWidth={lw} />);
    if (major) lines.push(<text key={`ty${y}`} x={ox + lw * 2} y={y - lw * 2} fontSize={label} fill="#e05">{Math.round(y)}</text>);
  }
  const g = doc.guides;
  const colW = g ? (W - 2 * M - (g.columns - 1) * g.gutter) / g.columns : 0;
  return (
    <svg className="overlay" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {g && Array.from({ length: g.columns }, (_, i) => (
        <rect key={`c${i}`} x={M + i * (colW + g.gutter)} y={M} width={colW} height={H - 2 * M} fill="#0a0" fillOpacity={0.05} />
      ))}
      {lines}
      <rect x={M} y={M} width={W - 2 * M} height={H - 2 * M} fill="none" stroke="#888" strokeWidth={lw} strokeDasharray={`${lw * 6} ${lw * 4}`} />
      {report?.elements.filter((e) => e.page === page).map((e) => {
        const c = bad.has(e.id) ? '#e00' : '#06f';
        const tw = (e.id.length + 0.6) * label * 0.6;
        // tag sits just above the box so it never hides content (inside only at the page top)
        const ty = e.y >= label * 1.2 ? e.y - label * 1.2 : e.y;
        return (
          <g key={e.id}>
            {(e.parts.length ? e.parts : [e]).map((r, i) => (
              <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke={c} strokeWidth={lw * 2} strokeDasharray={i ? `${lw * 4} ${lw * 3}` : undefined} />
            ))}
            <rect x={e.x} y={ty} width={tw} height={label * 1.2} fill={c} fillOpacity={0.7} />
            <text x={e.x + label * 0.3} y={ty + label * 0.95} fontSize={label} fill="#fff" fontFamily="monospace">{e.id}</text>
          </g>
        );
      })}
    </svg>
  );
}
