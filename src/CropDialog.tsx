import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { canvas } from './lib/demo';

type Rect = { x: number; y: number; width: number; height: number };
export function CropDialog({ source, onApply, onCancel }: {
  source: HTMLCanvasElement;
  onApply: (source: HTMLCanvasElement) => void;
  onCancel: () => void;
}) {
  const [url] = useState(() => source.toDataURL());
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, width: source.width, height: source.height });
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: string; x: number; y: number; rect: Rect } | null>(null);
  const point = (event: PointerEvent) => {
    const box = surface.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(source.width, (event.clientX - box.left) / box.width * source.width)),
      y: Math.max(0, Math.min(source.height, (event.clientY - box.top) / box.height * source.height)) };
  };
  const apply = () => {
    const output = canvas(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)));
    output.getContext('2d')!.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, output.width, output.height);
    onApply(output);
  };
  return <div className="about-backdrop" onKeyDown={(event) => {
    if (event.key === 'Escape') onCancel();
    if (event.key === 'Tab') {
      const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('button, [tabindex="0"]')];
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <section role="dialog" aria-modal="true" aria-label="Crop poster" className="crop-dialog">
      <div ref={surface} className="crop-surface" tabIndex={0} role="group" aria-label="Crop selection. Arrow keys move; Shift and arrow keys resize."
        onKeyDown={(event) => {
          const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
          if (!direction) return;
          event.preventDefault();
          const step = Math.max(1, Math.round(Math.max(source.width, source.height) / 100));
          setRect((r) => event.shiftKey ? { ...r, width: Math.max(1, Math.min(source.width - r.x, r.width + direction[0] * step)), height: Math.max(1, Math.min(source.height - r.y, r.height + direction[1] * step)) }
            : { ...r, x: Math.max(0, Math.min(source.width - r.width, r.x + direction[0] * step)), y: Math.max(0, Math.min(source.height - r.height, r.y + direction[1] * step)) });
        }} style={{ aspectRatio: source.width / source.height, width: `min(100%, ${52 * source.width / source.height}dvh)` }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          const p = point(event);
          let mode = (event.target as HTMLElement).dataset.crop ?? 'new';
          if (mode === 'move' && rect.width === source.width && rect.height === source.height) mode = 'new';
          drag.current = { mode, ...p, rect: { ...rect } };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const d = drag.current; if (!d) return;
          const p = point(event), dx = p.x - d.x, dy = p.y - d.y;
          if (d.mode === 'move') {
            setRect({ ...d.rect, x: Math.max(0, Math.min(source.width - d.rect.width, d.rect.x + dx)),
              y: Math.max(0, Math.min(source.height - d.rect.height, d.rect.y + dy)) });
          } else {
            const ax = d.mode === 'new' ? d.x : d.mode.includes('w') ? d.rect.x + d.rect.width : d.rect.x;
            const ay = d.mode === 'new' ? d.y : d.mode.includes('n') ? d.rect.y + d.rect.height : d.rect.y;
            const x = Math.min(source.width - 1, ax, p.x), y = Math.min(source.height - 1, ay, p.y);
            setRect({ x, y, width: Math.min(source.width - x, Math.max(1, Math.abs(p.x - ax))), height: Math.min(source.height - y, Math.max(1, Math.abs(p.y - ay))) });
          }
        }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <img src={url} alt="Poster to crop" draggable={false} />
        <div className="crop-selection" data-crop="move" style={{ left: `${rect.x / source.width * 100}%`, top: `${rect.y / source.height * 100}%`, width: `${rect.width / source.width * 100}%`, height: `${rect.height / source.height * 100}%` }}>
          {['nw', 'ne', 'sw', 'se'].map((corner) => <span key={corner} data-crop={corner} className={`crop-handle ${corner}`} />)}
        </div>
      </div>
      <div className="crop-actions">
        <button autoFocus onClick={onCancel}>Cancel</button>
        <button className="download-button" onClick={apply}>Use crop</button>
      </div>
    </section>
  </div>;
}
