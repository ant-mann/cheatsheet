import { useEffect, useState } from 'react';
import { pageDims, parseDoc, type Doc } from './schema';
import type { Report } from './report';
import { Sheet } from './render/Sheet';
import { Overlay } from './render/Overlay';

declare global {
  interface Window {
    __report?: Report | { ok: false; schemaErrors: string[] };
  }
}

/** Headless view driven by the CLI: real millimetres, no chrome. Publishes window.__report. */
export function PrintView({ name, overlay, label, minor, origin }: { name: string; overlay: boolean; label: number; minor: number; origin: [number, number] }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    (async () => {
      const raw = await (await fetch(`/api/doc/${encodeURIComponent(name)}`)).json();
      const r = parseDoc(raw);
      if (r.errors) {
        window.__report = { ok: false, schemaErrors: r.errors };
        return;
      }
      await document.fonts.ready;
      const { W, H } = pageDims(r.doc);
      const style = document.createElement('style');
      style.textContent = `@page { size: ${W}mm ${H}mm; margin: 0 } body { margin: 0 }`;
      document.head.appendChild(style);
      setDoc(r.doc);
    })();
  }, [name]);

  if (!doc) return null;
  return (
    <Sheet
      doc={doc}
      unit="1mm"
      onReport={(r) => {
        setReport(r);
        // let the overlay paint before the CLI captures
        requestAnimationFrame(() => requestAnimationFrame(() => (window.__report = r)));
      }}
      pageOverlay={overlay ? (p) => <Overlay doc={doc} page={p} report={report} label={label} minor={minor} origin={origin} /> : undefined}
    />
  );
}
