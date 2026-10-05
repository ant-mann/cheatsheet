// The editor edits the raw JSON (what's on disk), never the zod-parsed doc,
// so defaults stay implicit in the file and unknown-but-valid shapes survive.
export type RawEl = Record<string, unknown> & { id: string; type: string; style?: Record<string, unknown> };
export type RawDoc = Record<string, unknown> & { elements: RawEl[]; page?: Record<string, unknown> };

export const TEMPLATES: Record<string, (id: string) => Partial<RawEl>> = {
  text: () => ({ md: '## New section\nSome **text** with $x^2$' }),
  latex: () => ({ tex: 'e^{i\\pi}+1=0' }),
  mermaid: () => ({ src: 'graph LR; A-->B' }),
  excalidraw: () => ({
    elements: [{ type: 'rectangle', x: 0, y: 0, width: 120, height: 60, label: { text: 'Box' } }],
  }),
  svg: () => ({ w: 20, svg: "<svg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'><circle cx='50' cy='50' r='45' fill='none' stroke='black'/></svg>" }),
  image: () => ({ w: 40, src: 'materials/figure.png' }),
};

export function uniqueId(doc: RawDoc, base: string): string {
  const ids = new Set(doc.elements.map((e) => e.id));
  for (let i = 1; ; i++) if (!ids.has(`${base}${i}`)) return `${base}${i}`;
}

/** New element appended to the column flow of `page`. */
export function newElement(doc: RawDoc, type: string, page: number): RawEl {
  return { id: uniqueId(doc, type), type, page, ...TEMPLATES[type](type) } as RawEl;
}

export const r1 = (n: number) => Math.round(n * 10) / 10;
