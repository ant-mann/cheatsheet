import { useRef } from 'react';
import * as ex from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { toExcalidrawElements } from '../render/content';

type Api = { getSceneElements: () => readonly Record<string, unknown>[] };

/** Full Excalidraw editor for one element; saving stores the full scene elements. */
export function ExcalidrawModal({ elements, onSave, onClose }: {
  elements: Record<string, unknown>[];
  onSave: (elements: Record<string, unknown>[]) => void;
  onClose: () => void;
}) {
  const api = useRef<Api | null>(null);
  return (
    <div className="modal">
      <div className="modal-bar">
        <span>Edit drawing — the element box scales the drawing to fit.</span>
        <button onClick={() => api.current && onSave(api.current.getSceneElements().map((e) => ({ ...e })))}>Save</button>
        <button onClick={onClose}>Cancel</button>
      </div>
      <div className="modal-body">
        <ex.Excalidraw
          excalidrawAPI={(a) => (api.current = a as unknown as Api)}
          initialData={{ elements: toExcalidrawElements(ex, elements) as never, scrollToContent: true, appState: { viewBackgroundColor: '#ffffff' } }}
        />
      </div>
    </div>
  );
}
