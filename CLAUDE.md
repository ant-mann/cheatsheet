# Cheat-sheet harness

Builds dense, printable exam cheat sheets from course material. A sheet is one JSON file,
`sheets/<name>.json`, rendered by the same React renderer everywhere: the browser editor,
`./sheet check`, `./sheet shot`, and `./sheet pdf`. If `check` is clean, the PDF prints as shown.

## Course material

Course material goes in `materials/`, or in whatever folder the user names. Read all of it
before you lay anything out. The Read tool reads PDFs (20 pages per call) and images.
Images placed on the sheet use paths relative to the project root, e.g. `materials/fig3.png`.

## Workflow

1. Read the material. Decide what goes on the sheet and how big it can be.
2. `./sheet init <name> [--pages 2] [--size a4|letter] [--columns 4]` creates a sheet with
   column flow and `page.fill` turned on.
3. Write the content as an ordered list of **flowed** blocks (no x/y): one block per topic.
   For small edits, either edit the JSON directly or run `./sheet set <name> <id> key=value ...`.
   Keys are dotted paths and values are JSON (`./sheet set s bayes style.fontSize=2.5`), and
   `key=` with nothing after it removes the key.
4. `./sheet check <name>` validates and renders headless. It reports:
   - every element's box in mm (flowed blocks that break across columns list each part)
   - the actual font sizes and the `page.fill` scale
   - overflow (quoting the formula that is too wide), overlaps, off-page problems
   - LaTeX/mermaid errors, page fill %, free areas, and each column's bottom

   Exit code 0 means clean.
5. `./sheet shot <name> [--page n | --el <id> | --region x,y,w,h]` writes a PNG to `out/`;
   then Read it. The overlay draws an mm grid with rulers and outlines each element's boxes
   with its id (red = has an error). Crops zoom automatically up to 24x, so `--el <id>` makes
   even 0.5pt text readable. `--clean` hides the overlay, which is how you judge the design.
6. Repeat until `check` is clean and the clean shot looks good (see Design). Then run
   `./sheet pdf <name>`, which writes `out/<name>.pdf`.

The user may have the editor open (`./sheet dev <name>`, http://localhost:5173/?sheet=<name>).
It live-reloads when the file changes, and the user's edits there are written back to the same
JSON. They can reorder blocks, pin them in place, and drag pinned blocks. Re-read the file
before editing it if the user might have touched it.

## Layout model: flow first

Elements are placed one of three ways:

- **Flowed** (no `x`/`y`, the default and preferred way): blocks fill the guide columns in
  array order, like a newspaper. Column 1 fills top to bottom, then column 2, and so on. Text
  blocks break across columns between lines, so columns stay full and there are no holes.
  - Headings never end up alone at the bottom of a column.
  - Tables, callouts (`>`), display math and diagrams never split.
  - `"keep": true` keeps a whole block together.
  - `"span": "all"` runs a block across every column; use it for a title, or a wide table
    at the top of a page.
  - `gap` (mm, default 0.5) is the space above a block.
  - Use `"page": n` for the page a block flows on. When page 1 is full, give the later
    blocks `"page": 2`; nothing moves to the next page on its own.
- **Pinned** (`x`, `y`, plus `w` for non-diagrams): an absolute position in mm from the page
  top-left. Use this to drop something into leftover space. Flowed content doesn't avoid pinned
  elements, so put them in the free areas `check` reports (normally the end of the last
  column) or on a page with no flow.
- **Below** (`"below": "<id>"`): stacks under a *pinned* element at its measured bottom plus
  `gap`, inheriting its `x` and `w`.

With **`page.fill: true`**, the fonts of all flowed blocks are scaled by one common factor
until the pages are exactly full; `check` prints the factor. This is the cure for whitespace:
write the content with the size *ratios* you want (headings vs body vs dense tables) and let
fill choose the absolute size. Turn it off when you need exact sizes. A formula too wide for
its column shrinks only its own block, and `check` warns about it; split the formula or use
`span: "all"`.

## Tiny text is expected

The user reads text at **0.5pt or smaller** on A4. Never make text bigger "for readability".
With lots of material, 1–3pt body text is normal. No minimum size is enforced. Tiny text
renders correctly in the PDF: layout is scale-invariant, and KaTeX is laid out large and
scaled down.

## Design

The goal is a sheet that looks deliberately designed, not dumped. `sheets/stat240.json` is a
reference for the "decision sheet" style (cards, triggers, callouts, router table); read it
when the user wants that look. Rules:

- **One block per topic**, starting with `## Heading`. Put a topic's heading in the same text
  block as its content, so they can't come apart. `### H3` makes a subsection (accent text with
  a hairline under it).
- **Themes** (`"theme"` at the top level):
  - `"clean"` (default): white page, Inter.
  - `"editorial"`: parchment paper, serif small-caps headings (Newsreader), Space Grotesk
    body, rounded pastel cards, and plain `>` drawn as beige serif formula boxes. Use
    `#### Subheading` (teal) inside cards, icons in headings (`## ⊕ Title`, `## ① Title`,
    `## ▷ Title`, `## ✎ Title`), and `> [!stop]` for a filled red "stop" box.

  `sheets/editorial.json` is the reference for the editorial theme.
  - `"swiss"`: white paper, Roboto Condensed body + Inter headings, cards with a hairline
    accent border and a solid accent `##` header band, `####` as small accent caps with a
    trailing rule, booktabs tables, code blocks with an accent edge, router cues as chips.
    Crispest in print. `sheets/cs564m1.json` uses it.
- **Page bar:** `<div class="pagebar"><b>COURSE · Title</b><span>Page 1</span><span>Topics</span><span>Page 1 of 4</span></div>`
  (`span: "all"`, `style.card: false`) draws a dark header bar. The title is serif,
  the middle items are small caps, and the last item is right-aligned.
- **Router box:** `<div class="router"><span>Binary? → proportion</span>…</div>` lays out a
  bordered 3-across grid of "question → method" cues.
- **Two section styles:**
  - Default: `##` draws a coloured bar.
  - `style.card: true`: a tinted card with an accent bar on the left, and `##` becomes
    "▶ ACCENT CAPS".

  Set the style for the whole sheet with `defaults.style` (e.g. `{"card": true}`); any
  element can override it (`"style": {"card": false}` for the title).
- **Colour by topic** with `style.accent`. Use a small, print-safe palette and keep related
  topics in the same colour:
  - navy `#1f4e79` (the default)
  - brick `#8b2e2e`
  - green `#2e6b3a`
  - purple `#6b3e8b`
  - amber `#a8610a`
  - teal `#136f74`
- **Callouts** (a blockquote whose first line starts with a tag):
  - `> [!warn]`: amber, for common mistakes
  - `> [!ok]`: green, for correct forms and examples
  - `> [!bad]`: red, for never-do / wrong answers
  - `> [!info]`: blue
  - `> [!trigger]`: grey italic, for "when you see this wording…" cues
  - plain `>`: tinted with the section accent

  Use them for things worth catching the eye, not for everything.
- **Symbols:** ✔ ✓ ✅ turn green, ❌ ✗ turn red, ⚠ turns amber (emoji print as clean outline glyphs).
- **Tables** fill their block's width, with a tinted header row and zebra rows. Use them for
  anything comparative. For per-cell colours, write an HTML table:
  `<td class="bad">`, `ok`, `warn` or `info`. The same classes work on `<span>`.
  `<mark>` highlights.
- **Cards and columns:** a long card may continue into the next column, and the continuation
  gets its own rounded edges. Give short cards `keep: true` so they stay whole.
- **Title row** (lighter alternative to the page bar): `<div class="titlebar"><b>COURSE — EXAM</b><span>Page 1 · topics</span></div>`
  in a `span: "all"` block. A full-width "router" table under it (question type → section)
  works well on decision sheets.
- **Code** (`` `pbinom(k-1, n, p)` ``) renders as a pill and never breaks mid-token.
- **Fonts:** `"Roboto Condensed Variable, sans-serif"` (bundled) fits roughly 20% more text per
  line than the default Inter. Use it for dense sheets.
- `guides.rule: true` draws a hairline between columns.
- **Keep text terse:** fragments, symbols, no full sentences. `**Term**` followed by the
  definition. Prefer formulas over prose.
- **Hierarchy through size ratios.** With `page.fill`, the title scales too, so give it a
  modest size relative to the body. Keep body text one size and make dense tables a bit smaller.
- **Diagrams** only where a picture explains structure (processes, state machines, trees),
  kept small (see below).
- Before calling it done, look at a `--clean` full-page shot and fix anything ugly:
  - a section stranded at a column bottom
  - a block shrunk because of one wide table or formula (`check` warns): shorten the cell
    text, split the formula, or use `span: "all"`
  - mismatched sizes
  - leftover space you could fill

## Format

Units: lengths in **mm**, font sizes in **pt**, origin at the page top-left.

```jsonc
{
  "page": { "size": "a4", "landscape": false, "margin": 3, "count": 1, "fill": true },  // all optional
  "defaults": { "font": "Inter Variable, sans-serif", "fontSize": 4, "lineHeight": 1.1, "color": "#000",
                "style": { "card": true } },   // style: merged under every element's style
  "guides": { "columns": 4, "gutter": 1.5, "rule": false },  // flow columns; check prints each one's x and w
  "elements": [ ... ]                           // order = flow order (and paint order)
}
```

Element fields:

- `id` (letters, digits, `_ . -`), `type`, and `page` (default 1).
- Placement fields, as described above: `x`, `y`, `w`, `below`, `span`, `keep`, `gap`.
- `h`: a number, or `"auto"` (default). With a fixed `h`, content that doesn't fit is
  reported as overflow. `fit: "shrink"` (needs a numeric `h`) lowers the font size until the
  content fits, down to `minFontSize` (default 0.3pt).
- `allowOverlap: true` marks an overlap as intentional, e.g. a label on a figure.
- `style` (all optional):
  - `fontSize` (pt), `font`, `color`, `bg`
  - `accent`: the section colour
  - `card`: render the block as a card (see Design)
  - `border`: `true` for a hairline in the accent colour, or a CSS border string
  - `radius`, `padding` (mm)
  - `align`: left, center, right or justify
  - `lineHeight`, `bold`, `italic`
  - `columns` and `columnGap`: text columns inside a single box

  Unknown keys are errors, so typos get caught.

| type | content field | notes |
|---|---|---|
| `text` | `md` | Markdown (GFM tables, lists, headings, `>` callouts) with inline `$..$` and display `$$..$$` math. |
| `latex` | `tex` | A single KaTeX formula. `display` defaults to true. |
| `mermaid` | `src` | A mermaid diagram, drawn in the hand-drawn Excalidraw style. |
| `excalidraw` | `elements` | Excalidraw skeleton elements, see below. |
| `svg` | `svg` | Raw SVG markup. It needs `w`, and a `viewBox` or width/height. |
| `image` | `src` | A path relative to the project root, or a URL. It needs `w`. |

**Diagram sizing** (mermaid and excalidraw): a diagram is sized from its label font.
`style.fontSize` (default: the sheet default) is the size its labels print at, and the drawing
gets exactly as big as that requires. `w` and `h`, if given, are only *maximums*. Inside the
flow, a diagram is also capped at the column width and centred. To make a diagram smaller, give
it a smaller `style.fontSize`. `check` reports the effective label size (it is lower if a
maximum kicked in). Mermaid layout is tightened for density. `graph LR` comes out wide and
`graph TD` comes out tall, so for a narrow column, `TD` with short labels works best.

Excalidraw skeleton (in its own units; text defaults to 20 units, which maps to `style.fontSize`):

```json
{ "id": "fsm", "type": "excalidraw", "style": { "fontSize": 3 }, "elements": [
  { "type": "rectangle", "id": "s0", "x": 0, "y": 0, "width": 120, "height": 60, "label": { "text": "S0" } },
  { "type": "ellipse", "id": "s1", "x": 250, "y": 0, "width": 120, "height": 60, "label": { "text": "S1" } },
  { "type": "arrow", "x": 125, "y": 30, "width": 120, "height": 0, "label": { "text": "a" },
    "start": { "id": "s0" }, "end": { "id": "s1" } },
  { "type": "text", "x": 0, "y": 80, "text": "free text" } ] }
```

Other skeleton types: `diamond`, `line`. Optional fields: `strokeColor`, `backgroundColor`,
`fillStyle` (`"solid"`), `strokeWidth`, `roughness` (0 = clean lines). After the user edits a
drawing in the editor, it is stored as full Excalidraw elements. Those still render, and you
can still edit them.

## Example

```json
{ "id": "title", "type": "text", "span": "all", "md": "# Probability — Final" },
{ "id": "bayes", "type": "text", "md": "## Basics\n**Bayes** $P(A|B)=\\frac{P(B|A)P(A)}{P(B)}$\n> **LOTP** $P(B)=\\sum_i P(B|A_i)P(A_i)$" },
{ "id": "dists", "type": "text", "style": { "accent": "#2e6b3a", "fontSize": 3.5 },
  "md": "## Distributions\n| dist | mean | var |\n|---|---|---|\n| Bern$(p)$ | $p$ | $p(1-p)$ |\n| Pois$(\\lambda)$ | $\\lambda$ | $\\lambda$ |" },
{ "id": "mc-h", "type": "text", "style": { "accent": "#6b3e8b" }, "md": "## Markov chains" },
{ "id": "mc", "type": "mermaid", "gap": 0, "style": { "fontSize": 3 }, "src": "graph LR; A-->|p|B; B-->|q|A" }
```

## Tips

- Escape backslashes in JSON: `\\frac`, `\\alpha`.
- Inline math wraps only at top-level `+`, `=`, and relations. Grouped constructs
  (`\\frac`, matrices, `\\left(..\\right)`) can't wrap, and display math (`$$..$$`) never
  wraps. When a formula is too wide, split it into several `$..$`, or use `span: "all"`.
- In markdown tables, a `|` inside `$..$` ends the cell. Use `\\vert` or `\\mid` instead.
  `check` warns when a stray `$` gets rendered.
- Tables are only as wide as their content.
- A heading in its own block followed by a diagram: give the diagram `gap: 0`.
- Run `./sheet --help` and `./sheet <cmd> --help` for all options. Typecheck with `npx tsc -p .`.
