import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { columnsOf, pageDims, parseDoc, type Doc } from './schema';
import type { Rect, Report } from './report';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'out');
const PX_PER_MM = 96 / 25.4;
const sheetFile = (name: string) => path.join(ROOT, 'sheets', `${path.basename(name, '.json')}.json`);

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

async function loadDoc(name: string): Promise<{ raw: Record<string, unknown>; doc: Doc }> {
  const file = sheetFile(name);
  if (!existsSync(file)) fail(`no sheet ${path.relative(ROOT, file)} (create it with: ./sheet init ${name})`);
  let raw;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    fail(`invalid JSON in ${path.relative(ROOT, file)}: ${(e as Error).message}`);
  }
  const r = parseDoc(raw);
  if (r.errors) fail(`schema errors in ${path.relative(ROOT, file)}:\n${r.errors.map((e) => `  - ${e}`).join('\n')}`);
  return { raw, doc: r.doc };
}

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

async function startVite(port: number, quiet: boolean): Promise<ViteDevServer> {
  const server = await createServer({
    root: ROOT,
    configFile: path.join(ROOT, 'vite.config.ts'),
    logLevel: quiet ? 'error' : 'info',
    server: { port, strictPort: true, hmr: quiet ? false : undefined },
  });
  await server.listen();
  return server;
}

type Session = { open: (query: string, dsf: number) => Promise<{ page: Page; report: Report }>; close: () => Promise<void> };

/** One Vite server + headless Chromium for the lifetime of a command. */
async function session(name: string): Promise<Session> {
  const port = await freePort();
  const server = await startVite(port, true);
  const browser = await chromium.launch();
  return {
    async open(query, dsf) {
      const ctx = await browser.newContext({ deviceScaleFactor: dsf, viewport: { width: 1400, height: 1000 } });
      const page = await ctx.newPage();
      const logs: string[] = [];
      page.on('console', (m) => m.type() === 'error' && logs.push(m.text()));
      page.on('pageerror', (e) => logs.push(e.message));
      await page.goto(`http://localhost:${port}/?sheet=${encodeURIComponent(name)}&mode=print&${query}`);
      try {
        await page.waitForFunction(() => window.__report, null, { timeout: 90_000 });
      } catch {
        fail(`render timed out. Browser errors:\n${logs.join('\n') || '(none)'}`);
      }
      const report = (await page.evaluate(() => window.__report)) as Report & { schemaErrors?: string[] };
      if (report.schemaErrors) fail(report.schemaErrors.join('\n'));
      return { page, report };
    },
    async close() {
      await browser.close();
      await server.close();
    },
  };
}

function formatReport(r: Report, doc: Doc): string {
  const { W, H } = pageDims(doc);
  const M = doc.page.margin;
  const lines = [`${r.ok ? 'OK' : 'FAIL'}: ${r.summary}`];
  lines.push(`page ${W}x${H}mm, content area x ${M}..${W - M}, y ${M}..${H - M}`);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const cols = columnsOf(doc);
  lines.push(`guide columns (x, w): ${cols.map((c) => `x${r1(c.x)} w${r1(c.w)}`).join(' | ')}`);
  for (let p = 1; p <= doc.page.count; p++) {
    const bottoms = cols.map((c) => {
      const inCol = r.elements.filter((e) => e.page === p).flatMap((e) => e.parts).filter((b) => b.x < c.x + c.w - 0.5 && b.x + b.w > c.x + 0.5);
      return inCol.length ? `y${r1(Math.max(...inCol.map((b) => b.y + b.h)))}` : 'empty';
    });
    lines.push(`page ${p} column bottoms: ${bottoms.join(' | ')}`);
  }
  if (doc.page.fill) lines.push(`page.fill: flowed font sizes scaled x${r.fillScale}`);
  for (const i of r.issues) lines.push(`  ${i.severity.toUpperCase()} ${i.kind} ${i.id ? `"${i.id}"` : ''}: ${i.msg}`);
  for (const p of r.pages) {
    const free = p.free.map((f) => `x${f.x} y${f.y} w${f.w} h${f.h}`).join(' | ') || 'none';
    lines.push(`page ${p.page}: ${p.fill} filled; largest free areas: ${free}`);
  }
  lines.push('elements (mm, measured; fontSize = actual pt):');
  for (const e of r.elements)
    lines.push(`  ${e.id} p${e.page} x${e.x} y${e.y} w${e.w} h${e.h} ${e.fontSize}pt${e.parts.length > 1 ? ` (continues: ${e.parts.slice(1).map((b) => `x${b.x} y${b.y} h${b.h}`).join(', ')})` : ''}`);
  return lines.join('\n');
}

/** Pick a device scale so the capture is ~1500px on its long side (min 2x, max 24x). */
function scaleFor(w: number, h: number) {
  return Math.min(24, Math.max(2, 1500 / (Math.max(w, h) * PX_PER_MM)));
}

function overlayQuery(dsf: number, region: Rect) {
  const pxPerMm = dsf * PX_PER_MM;
  const label = 13 / pxPerMm;
  const minor = [0.5, 1, 2, 5, 10].find((m) => m * pxPerMm >= 18)!;
  return `overlay&label=${label}&minor=${minor}&origin=${region.x},${region.y}`;
}

async function capture(page: Page, pageNo: number, region: Rect, pageW: number, file: string) {
  const box = (await page.locator(`[data-page="${pageNo}"]`).boundingBox())!;
  const k = box.width / pageW;
  await page.screenshot({
    path: file,
    fullPage: true,
    clip: { x: box.x + region.x * k, y: box.y + region.y * k, width: region.w * k, height: region.h * k },
  });
}

const program = new Command('sheet').description('Cheat-sheet layout harness. Sheets live in sheets/<name>.json.');

program
  .command('init <name>')
  .description('create sheets/<name>.json')
  .option('--pages <n>', 'page count', '1')
  .option('--size <size>', 'a4 | letter | a3 | a5 | legal', 'a4')
  .option('--columns <n>', 'guide columns', '4')
  .action(async (name: string, o) => {
    const file = sheetFile(name);
    if (existsSync(file)) fail(`${path.relative(ROOT, file)} already exists`);
    const doc = {
      page: { size: o.size, margin: 3, count: Number(o.pages), fill: true },
      defaults: { fontSize: 4 },
      guides: { columns: Number(o.columns), gutter: 1.5 },
      elements: [],
    };
    const r = parseDoc(doc);
    if (r.errors) fail(r.errors.join('\n'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(doc, null, 2) + '\n');
    console.log(`created ${path.relative(ROOT, file)}`);
  });

program
  .command('check <name>')
  .description('validate + render headless; report overflow, overlap, off-page, render errors, free space')
  .option('--json', 'full JSON report')
  .action(async (name: string, o) => {
    const { doc } = await loadDoc(name);
    const s = await session(name);
    const { report } = await s.open('', 1);
    await s.close();
    console.log(o.json ? JSON.stringify(report, null, 2) : formatReport(report, doc));
    process.exit(report.ok ? 0 : 1);
  });

program
  .command('shot <name>')
  .description('PNG screenshot with debug overlay (ids, mm grid, rulers). Zooms automatically so tiny text is legible.')
  .option('--page <n>', 'page number', '1')
  .option('--el <id>', 'crop to one element (+2mm)')
  .option('--region <x,y,w,h>', 'crop to a page region in mm')
  .option('--clean', 'no overlay')
  .option('--scale <n>', 'override device scale factor')
  .action(async (name: string, o) => {
    const { doc } = await loadDoc(name);
    const { W, H } = pageDims(doc);
    const s = await session(name);
    let pageNo = Number(o.page);
    let region: Rect = { x: 0, y: 0, w: W, h: H };
    let tag = `p${pageNo}`;
    if (o.el) {
      const { report } = await s.open('', 1);
      const e = report.elements.find((e) => e.id === o.el);
      if (!e) fail(`no element "${o.el}"`);
      pageNo = e.page;
      region = { x: Math.max(0, Math.floor(e.x - 2)), y: Math.max(0, Math.floor(e.y - 2.5)), w: 0, h: 0 };
      region.w = Math.round((Math.min(W, e.x + e.w + 2) - region.x) * 10) / 10;
      region.h = Math.round((Math.min(H, e.y + e.h + 2) - region.y) * 10) / 10;
      tag = o.el;
    } else if (o.region) {
      const [x, y, w, h] = String(o.region).split(',').map(Number);
      if (![x, y, w, h].every(Number.isFinite)) fail('--region expects x,y,w,h in mm');
      region = { x, y, w, h };
      tag = `p${pageNo}-${x}_${y}_${w}x${h}`;
    }
    if (pageNo < 1 || pageNo > doc.page.count) fail(`page ${pageNo} does not exist`);
    const dsf = o.scale ? Number(o.scale) : region.w === W && region.h === H ? 2 : scaleFor(region.w, region.h);
    const { page, report } = await s.open(o.clean ? '' : overlayQuery(dsf, region), dsf);
    await mkdir(OUT, { recursive: true });
    const file = path.join(OUT, `${path.basename(name)}-${tag}.png`);
    await capture(page, pageNo, region, W, file);
    await s.close();
    console.log(`${path.relative(ROOT, file)}  (${dsf.toFixed(1)}x, region x${region.x} y${region.y} w${region.w} h${region.h}mm)`);
    console.log(`check: ${report.ok ? 'OK' : 'FAIL'} ${report.summary}`);
  });

program
  .command('pdf <name>')
  .description('export out/<name>.pdf')
  .action(async (name: string) => {
    await loadDoc(name);
    const s = await session(name);
    const { page, report } = await s.open('', 1);
    await mkdir(OUT, { recursive: true });
    const file = path.join(OUT, `${path.basename(name)}.pdf`);
    await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
    await s.close();
    console.log(`${path.relative(ROOT, file)}\ncheck: ${report.ok ? 'OK' : 'FAIL'} ${report.summary}`);
  });

program
  .command('set <name> <id> <assignments...>')
  .description('edit one element: key=value (dotted keys like style.fontSize=2; JSON values; "key=" removes the key)')
  .action(async (name: string, id: string, assignments: string[]) => {
    const { raw } = await loadDoc(name);
    const el = (raw.elements as Record<string, unknown>[]).find((e) => e.id === id);
    if (!el) fail(`no element "${id}"`);
    for (const a of assignments) {
      const eq = a.indexOf('=');
      if (eq < 1) fail(`expected key=value, got "${a}"`);
      const path = a.slice(0, eq).split('.');
      const text = a.slice(eq + 1);
      let obj = el;
      for (const k of path.slice(0, -1)) obj = (obj[k] ??= {}) as Record<string, unknown>;
      const last = path[path.length - 1];
      if (text === '') delete obj[last];
      else {
        try {
          obj[last] = JSON.parse(text);
        } catch {
          obj[last] = text;
        }
      }
    }
    const r = parseDoc(raw);
    if (r.errors) fail(`not saved, the result would be invalid:\n${r.errors.map((e) => `  - ${e}`).join('\n')}`);
    await writeFile(sheetFile(name), JSON.stringify(raw, null, 2) + '\n');
    console.log(JSON.stringify(el));
  });

program
  .command('dev <name>')
  .description('open the editor (live-reloads when the JSON changes)')
  .option('--port <n>', 'port', '5173')
  .action(async (name: string, o) => {
    await loadDoc(name);
    await startVite(Number(o.port), false);
    console.log(`editor: http://localhost:${o.port}/?sheet=${encodeURIComponent(name)}`);
  });

await program.parseAsync();
