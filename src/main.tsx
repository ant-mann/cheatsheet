import { createRoot } from 'react-dom/client';
import './render/sheet.css';
import { PrintView } from './PrintView';

const q = new URLSearchParams(location.search);
const name = q.get('sheet');
const root = createRoot(document.getElementById('root')!);

if (!name) {
  root.render(<p style={{ font: '14px sans-serif', padding: 20 }}>Open with ?sheet=&lt;name&gt; (a file in sheets/).</p>);
} else if (q.get('mode') === 'print') {
  root.render(<PrintView name={name} overlay={q.has('overlay')} label={Number(q.get('label') ?? 2.5)} minor={Number(q.get('minor') ?? 5)} origin={(q.get('origin') ?? '0,0').split(',').map(Number) as [number, number]} />);
} else {
  const { Editor } = await import('./editor/Editor');
  root.render(<Editor name={name} />);
}
