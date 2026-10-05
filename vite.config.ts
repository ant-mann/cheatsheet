import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const SHEETS_DIR = path.resolve(import.meta.dirname, 'sheets');
export const sheetPath = (name: string) => path.join(SHEETS_DIR, `${path.basename(name)}.json`);

/** GET/PUT /api/doc/<name> on sheets/<name>.json; pushes `sheet:changed` when files change on disk. */
function docApi(): Plugin {
  return {
    name: 'doc-api',
    configureServer(server) {
      server.watcher.add(SHEETS_DIR);
      server.watcher.on('change', (file) => {
        if (path.dirname(file) === SHEETS_DIR && file.endsWith('.json'))
          server.ws.send({ type: 'custom', event: 'sheet:changed', data: { name: path.basename(file, '.json') } });
      });
      server.middlewares.use('/api/doc/', async (req, res) => {
        const name = decodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0]);
        const file = sheetPath(name);
        try {
          if (req.method === 'GET') {
            res.setHeader('content-type', 'application/json');
            res.end(await readFile(file, 'utf8'));
          } else if (req.method === 'PUT') {
            let body = '';
            for await (const chunk of req) body += chunk;
            await writeFile(file, JSON.stringify(JSON.parse(body), null, 2) + '\n');
            res.end('{}');
          } else {
            res.statusCode = 405;
            res.end();
          }
        } catch (e) {
          res.statusCode = (e as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500;
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), docApi()],
  optimizeDeps: {
    include: ['react', 'react-dom/client', 'katex', 'marked', 'marked-katex-extension', 'mermaid', '@excalidraw/excalidraw', 'react-moveable', 'zod'],
  },
  build: { target: 'esnext' },
  server: { watch: { ignored: ['**/out/**', '**/materials/**'] } },
});
