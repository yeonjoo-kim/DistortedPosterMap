import type { PosterAsset, PosterElement } from './types';

export function canvas(width: number, height: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
}

export function createDemo(): PosterAsset {
  const width = 600,
    height = 800;
  const color = '#e9e7dd';
  const background = canvas(width, height);
  const bg = background.getContext('2d')!;
  bg.fillStyle = color;
  bg.fillRect(0, 0, width, height);
  const elements: PosterElement[] = [];
  const add = (
    label: string,
    kind: PosterElement['kind'],
    x: number,
    y: number,
    w: number,
    h: number,
    draw: (ctx: CanvasRenderingContext2D) => void,
  ) => {
    const sprite = canvas(w, h);
    draw(sprite.getContext('2d')!);
    elements.push({
      id: `e${String(elements.length + 1).padStart(2, '0')}`,
      label,
      kind,
      x: x + w / 2,
      y: y + h / 2,
      width: w,
      height: h,
      sprite,
    });
  };
  const text = (
    label: string,
    x: number,
    y: number,
    size: number,
    weight = '700',
    tracking = 0,
  ) => {
    const measure = canvas(1, 1).getContext('2d')!;
    measure.font = `${weight} ${size}px Arial, sans-serif`;
    const w = Math.ceil(
      measure.measureText(label).width + tracking * label.length + 6,
    );
    add(label, 'text', x, y, w, size * 1.17, (ctx) => {
      ctx.font = `${weight} ${size}px Arial, sans-serif`;
      ctx.fillStyle = '#252621';
      ctx.textBaseline = 'top';
      if (tracking) {
        let offset = 2;
        for (const char of label) {
          ctx.fillText(char, offset, 0);
          offset += ctx.measureText(char).width + tracking;
        }
      } else ctx.fillText(label, 2, 0);
    });
  };
  text('DESIGN IN A STATE OF FLUX', 36, 28, 11, '600', 1.3);
  text('EXPERIMENT No. 001', 391, 28, 10, '500', 0.5);
  add('상단 구분선', 'shape', 38, 58, 524, 2, (ctx) => {
    ctx.fillStyle = '#252621';
    ctx.fillRect(0, 0, 524, 2);
  });
  text('NOTHING', 27, 79, 99, '900');
  text('STAYS', 29, 176, 99, '900');
  text('STILL.', 29, 273, 99, '900');
  add('오렌지 오비트', 'shape', 164, 375, 273, 273, (ctx) => {
    ctx.fillStyle = '#f4512c';
    ctx.beginPath();
    ctx.arc(136.5, 136.5, 134.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e9e7dd';
    ctx.lineWidth = 1.2;
    for (let x = -180; x < 360; x += 14) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(136.5, 136.5, 134.5, 0, Math.PI * 2);
      ctx.clip();
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 220, 273);
      ctx.stroke();
      ctx.restore();
    }
  });
  add('궤도 타원', 'shape', 56, 433, 484, 156, (ctx) => {
    ctx.strokeStyle = '#252621';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(242, 78, 239, 54, -0.12, 0, Math.PI * 2);
    ctx.stroke();
  });
  add('대각선 화살표', 'shape', 474, 382, 42, 42, (ctx) => {
    ctx.strokeStyle = '#252621';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(2, 40);
    ctx.lineTo(39, 3);
    ctx.moveTo(12, 3);
    ctx.lineTo(39, 3);
    ctx.lineTo(39, 30);
    ctx.stroke();
  });
  text('A LITTLE CHAOS.', 39, 677, 14, '700', 0.7);
  text('A NEW PERSPECTIVE.', 39, 699, 14, '700', 0.7);
  text('SHAKE TO', 440, 679, 11, '500', 0.8);
  text('REIMAGINE.', 440, 697, 11, '500', 0.8);
  add('하단 구분선', 'shape', 38, 744, 524, 1, (ctx) => {
    ctx.fillStyle = '#252621';
    ctx.fillRect(0, 0, 524, 1);
  });
  text('OFF/SET — POSTER SERIES', 38, 760, 9, '500', 0.8);
  text('2026 / 001', 486, 760, 9, '500', 0.6);
  const source = canvas(width, height);
  const ctx = source.getContext('2d')!;
  ctx.drawImage(background, 0, 0);
  for (const el of elements)
    ctx.drawImage(el.sprite, el.x - el.width / 2, el.y - el.height / 2);
  return {
    width,
    height,
    color,
    source,
    background,
    elements,
    method: '샘플 · 개별 디자인 요소',
    pageCount: 1,
  };
}
