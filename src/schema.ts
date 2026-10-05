import { z } from 'zod';

// All lengths are millimetres, all font sizes are points. Origin = page top-left.

export const PAGE_SIZES = {
  a4: [210, 297],
  a3: [297, 420],
  a5: [148, 210],
  letter: [215.9, 279.4],
  legal: [215.9, 355.6],
} as const;

export const PT_PER_MM = 72 / 25.4;

export const Style = z
  .object({
    fontSize: z.number().positive().describe('pt, no lower limit'),
    font: z.string(),
    color: z.string(),
    bg: z.string(),
    border: z.union([z.boolean(), z.string()]).describe('true = thin grey line, or any CSS border'),
    radius: z.number().min(0),
    padding: z.number().min(0),
    align: z.enum(['left', 'center', 'right', 'justify']),
    lineHeight: z.number().positive(),
    bold: z.boolean(),
    italic: z.boolean(),
    columns: z.number().int().min(1).describe('CSS text columns inside the box'),
    columnGap: z.number().min(0),
    accent: z.string().describe('section colour: headings, rules, table headers'),
    card: z.boolean().describe('tinted card with an accent bar; ## headings become "▶ TITLE"'),
  })
  .partial()
  .strict();

const Base = z.object({
  id: z.string().regex(/^[A-Za-z0-9_.-]+$/, 'id may contain only letters, digits, _ . -'),
  page: z.number().int().min(1).default(1),
  // Placement, one of: x+y (absolute) | below (stack under an element) | neither (flow into guide columns)
  x: z.number().optional(),
  y: z.number().optional(),
  below: z.string().optional().describe('stack under this element id: y = its measured bottom + gap'),
  span: z.literal('all').optional().describe('flowed elements: run across all columns (titles, wide tables)'),
  keep: z.boolean().default(false).describe('flowed elements: never split across columns'),
  w: z.number().positive().optional().describe('diagrams: maximum width; others: width'),
  gap: z.number().min(0).default(0.5).describe('mm of space above (below/flow)'),
  h: z.union([z.number().positive(), z.literal('auto')]).default('auto'),
  style: Style.default({}),
  fit: z.enum(['none', 'shrink']).default('none'),
  minFontSize: z.number().positive().default(0.3),
  allowOverlap: z.boolean().default(false),
});

export const ElementSchema = z.discriminatedUnion('type', [
  Base.extend({ type: z.literal('text'), md: z.string() }).strict(),
  Base.extend({ type: z.literal('latex'), tex: z.string(), display: z.boolean().default(true) }).strict(),
  Base.extend({ type: z.literal('mermaid'), src: z.string() }).strict(),
  Base.extend({ type: z.literal('excalidraw'), elements: z.array(z.record(z.string(), z.unknown())) }).strict(),
  Base.extend({ type: z.literal('svg'), svg: z.string() }).strict(),
  Base.extend({ type: z.literal('image'), src: z.string().describe('path relative to project root, or URL') }).strict(),
]);

export const DocSchema = z
  .object({
    page: z
      .object({
        size: z.enum(Object.keys(PAGE_SIZES) as [keyof typeof PAGE_SIZES]).default('a4'),
        landscape: z.boolean().default(false),
        margin: z.number().min(0).default(3),
        count: z.number().int().min(1).default(1),
        fill: z.boolean().default(false).describe('scale fonts of flowed elements to fill the pages'),
      })
      .strict()
      .default({ size: 'a4', landscape: false, margin: 3, count: 1, fill: false }),
    defaults: z
      .object({
        font: z.string().optional().describe('body font; default comes from the theme'),
        fontSize: z.number().positive().default(4),
        lineHeight: z.number().positive().default(1.1),
        color: z.string().default('#000'),
        style: Style.default({}).describe('merged under every element style (a sheet-wide look)'),
      })
      .strict()
      .default({ fontSize: 4, lineHeight: 1.1, color: '#000', style: {} }),
    theme: z.enum(['clean', 'editorial', 'swiss']).default('clean').describe('visual theme: fonts, paper, cards, headings'),
    guides: z
      .object({ columns: z.number().int().min(1), gutter: z.number().min(0).default(2), rule: z.boolean().default(false).describe('hairline between flow columns') })
      .strict()
      .optional(),
    elements: z.array(ElementSchema).default([]),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const seen = new Set<string>();
    const byId = new Map(doc.elements.map((e) => [e.id, e]));
    doc.elements.forEach((el, i) => {
      if (seen.has(el.id)) ctx.addIssue({ code: 'custom', path: ['elements', i, 'id'], message: `duplicate id "${el.id}"` });
      seen.add(el.id);
      if ((el.x === undefined) !== (el.y === undefined))
        ctx.addIssue({ code: 'custom', path: ['elements', i], message: 'give both x and y, or neither (to flow into the guide columns)' });
      if (el.below !== undefined) {
        const anchor = byId.get(el.below);
        if (!anchor) ctx.addIssue({ code: 'custom', path: ['elements', i, 'below'], message: `no element "${el.below}"` });
        else if (anchor.page !== el.page)
          ctx.addIssue({ code: 'custom', path: ['elements', i, 'below'], message: `"${el.below}" is on page ${anchor.page}, not ${el.page}` });
        else if (placement(anchor) === 'flow')
          ctx.addIssue({ code: 'custom', path: ['elements', i, 'below'], message: `"${el.below}" is flowed; flowed elements already stack, so flow this one too (drop "below")` });
        const chain = new Set([el.id]);
        for (let a = anchor; a?.below !== undefined; a = byId.get(a.below)) {
          if (chain.has(a.id)) {
            ctx.addIssue({ code: 'custom', path: ['elements', i, 'below'], message: `"below" chain loops back to "${a.id}"` });
            break;
          }
          chain.add(a.id);
        }
      } else if (el.x !== undefined && el.w === undefined && !DIAGRAMS.has(el.type))
        ctx.addIssue({ code: 'custom', path: ['elements', i], message: 'missing w' });
      if (el.page > doc.page.count)
        ctx.addIssue({
          code: 'custom',
          path: ['elements', i, 'page'],
          message: `page ${el.page} does not exist (page.count = ${doc.page.count})`,
        });
      if (el.fit === 'shrink' && el.h === 'auto')
        ctx.addIssue({ code: 'custom', path: ['elements', i, 'fit'], message: 'fit "shrink" needs a numeric h' });
    });
  })
  .transform((doc) => {
    // "below" inherits x/w from its anchor; flowed elements take their column's width
    const byId = new Map(doc.elements.map((e) => [e.id, e]));
    const resolve = (e: (typeof doc.elements)[number]): { x?: number; w?: number } => {
      const mode = placement(e);
      if (mode !== 'below') return { x: e.x, w: e.w };
      const a = resolve(byId.get(e.below!)!);
      return { x: e.x ?? a.x, w: e.w ?? a.w };
    };
    return {
      ...doc,
      elements: doc.elements.map((e) => ({ ...e, ...resolve(e), style: { ...doc.defaults.style, ...e.style }, placement: placement(e) })),
    };
  });

export type Doc = z.infer<typeof DocSchema>;
export type El = Doc['elements'][number];
export type Style = z.infer<typeof Style>;

/** Types whose size comes from their drawing; `w` is only a maximum. */
export const DIAGRAMS = new Set(['mermaid', 'excalidraw']);

export function placement(e: { x?: number; below?: string }): 'abs' | 'below' | 'flow' {
  return e.below !== undefined ? 'below' : e.x !== undefined ? 'abs' : 'flow';
}

/** Guide columns in mm (one column spanning the content area when there are no guides). */
export function columnsOf(doc: { page: { size: keyof typeof PAGE_SIZES; landscape: boolean; margin: number }; guides?: { columns: number; gutter: number } }) {
  const { W } = pageDims(doc);
  const M = doc.page.margin;
  const g = doc.guides ?? { columns: 1, gutter: 0 };
  const w = (W - 2 * M - (g.columns - 1) * g.gutter) / g.columns;
  return Array.from({ length: g.columns }, (_, i) => ({ x: M + i * (w + g.gutter), w }));
}

export function pageDims(doc: { page: { size: keyof typeof PAGE_SIZES; landscape: boolean } }): { W: number; H: number } {
  const [a, b] = PAGE_SIZES[doc.page.size];
  return doc.page.landscape ? { W: b, H: a } : { W: a, H: b };
}

/** Parse a raw doc; on failure return messages that name the offending element id. */
export function parseDoc(raw: unknown): { doc: Doc; errors: null } | { doc: null; errors: string[] } {
  const r = DocSchema.safeParse(raw);
  if (r.success) return { doc: r.data, errors: null };
  const rawEls = (raw as { elements?: { id?: unknown }[] })?.elements;
  const errors = r.error.issues.map((iss) => {
    const path = iss.path.map((p, i) =>
      i === 1 && iss.path[0] === 'elements' && typeof p === 'number' && rawEls?.[p]?.id !== undefined
        ? `[${p}](id "${String(rawEls[p].id)}")`
        : typeof p === 'number' ? `[${p}]` : `.${String(p)}`,
    );
    const where = path.join('').replace(/^\./, '') || '(root)';
    const keys = 'keys' in iss ? ` ${JSON.stringify(iss.keys)}` : '';
    return `${where}: ${iss.message}${keys}`;
  });
  return { doc: null, errors };
}
