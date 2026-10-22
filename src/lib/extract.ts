import { canvas } from './demo';
import { connectedRegions, dilate } from './segmentation';
import type { Detail, PosterAsset, PosterElement } from './types';

type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
};

function backgroundColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): [number, number, number] {
  const bins = new Map<
    string,
    { n: number; r: number; g: number; b: number }
  >();
  const sample = (x: number, y: number) => {
    const p = (y * width + x) * 4;
    if (data[p + 3] < 128) return;
    const key = `${data[p] >> 4},${data[p + 1] >> 4},${data[p + 2] >> 4}`;
    const v = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    v.n++;
    v.r += data[p];
    v.g += data[p + 1];
    v.b += data[p + 2];
    bins.set(key, v);
  };
  for (let x = 0; x < width; x += 2) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y += 2) {
    sample(0, y);
    sample(width - 1, y);
  }
  const best = [...bins.values()].sort((a, b) => b.n - a.n)[0];
  return best
    ? [
        Math.round(best.r / best.n),
        Math.round(best.g / best.n),
        Math.round(best.b / best.n),
      ]
    : [255, 255, 255];
}

export function extractElements(
  source: HTMLCanvasElement,
  detail: Detail,
  textBoxes: Box[] = [],
): PosterAsset {
  const { width, height } = source;
  const ratio = Math.min(1, 640 / Math.max(width, height));
  const sample = canvas(width * ratio, height * ratio);
  const sc = sample.getContext('2d', { willReadFrequently: true })!;
  sc.drawImage(source, 0, 0, sample.width, sample.height);
  const pixels = sc.getImageData(0, 0, sample.width, sample.height);
  const bg = backgroundColor(pixels.data, sample.width, sample.height);
  const color = `rgb(${bg.join(',')})`;
  const mask = new Uint8Array(sample.width * sample.height);
  let foreground = 0;
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4,
      d = Math.hypot(
        pixels.data[i] - bg[0],
        pixels.data[i + 1] - bg[1],
        pixels.data[i + 2] - bg[2],
      );
    if (pixels.data[i + 3] > 25 && d > 35) {
      mask[p] = 1;
      foreground++;
    }
  }
  const elements: PosterElement[] = [];
  const background = canvas(width, height),
    bc = background.getContext('2d')!;
  bc.drawImage(source, 0, 0);
  const add = (
    sprite: HTMLCanvasElement,
    x: number,
    y: number,
    label: string,
    kind: PosterElement['kind'],
  ) => {
    const id = `e${String(elements.length + 1).padStart(3, '0')}`;
    elements.push({
      id,
      label,
      kind,
      sprite,
      x: x + sprite.width / 2,
      y: y + sprite.height / 2,
      width: sprite.width,
      height: sprite.height,
    });
    bc.save();
    bc.globalCompositeOperation = 'destination-out';
    bc.drawImage(sprite, x, y);
    bc.restore();
  };
  // Native PDF text boxes become independently movable pieces before raster analysis.
  for (const box of textBoxes.slice(0, 100)) {
    const x = Math.max(0, Math.floor(box.x - 2)),
      y = Math.max(0, Math.floor(box.y - 2));
    const w = Math.min(width - x, Math.ceil(box.width + 4)),
      h = Math.min(height - y, Math.ceil(box.height + 4));
    if (w < 2 || h < 2 || x >= width || y >= height) continue;
    const sprite = canvas(w, h),
      ctx = sprite.getContext('2d')!;
    ctx.drawImage(source, x, y, w, h, 0, 0, w, h);
    const image = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < image.data.length; i += 4) {
      if (
        Math.hypot(
          image.data[i] - bg[0],
          image.data[i + 1] - bg[1],
          image.data[i + 2] - bg[2],
        ) < 35
      )
        image.data[i + 3] = 0;
    }
    ctx.putImageData(image, 0, 0);
    add(sprite, x, y, box.label.slice(0, 36), 'text');
    for (
      let sy = Math.max(0, Math.floor(y * ratio));
      sy < Math.min(sample.height, Math.ceil((y + h) * ratio));
      sy++
    ) {
      for (
        let sx = Math.max(0, Math.floor(x * ratio));
        sx < Math.min(sample.width, Math.ceil((x + w) * ratio));
        sx++
      )
        mask[sy * sample.width + sx] = 0;
    }
  }
  const radius = detail === 'fine' ? 0 : detail === 'coarse' ? 5 : 2;
  const { regions, labels } = connectedRegions(
    dilate(mask, sample.width, sample.height, radius),
    sample.width,
    sample.height,
  );
  const largest = Math.max(0, ...regions.map((r) => r.count));
  const tiled = foreground / mask.length > 0.73 || largest / mask.length > 0.6;
  if (tiled && !textBoxes.length) {
    const cols = detail === 'fine' ? 10 : detail === 'coarse' ? 4 : 7;
    const rows = Math.max(3, Math.round((cols * height) / width));
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        const x = Math.round((col * width) / cols),
          y = Math.round((row * height) / rows);
        const w = Math.round(((col + 1) * width) / cols) - x,
          h = Math.round(((row + 1) * height) / rows) - y;
        const sprite = canvas(w, h);
        sprite.getContext('2d')!.drawImage(source, x, y, w, h, 0, 0, w, h);
        add(sprite, x, y, `이미지 조각 ${row + 1}.${col + 1}`, 'region');
      }
  } else {
    for (const region of regions
      .filter((r) => r.count >= (detail === 'fine' ? 3 : 7))
      .sort((a, b) => b.count - a.count)
      .slice(0, 160 - elements.length)) {
      const x = Math.max(0, Math.floor(region.x / ratio)),
        y = Math.max(0, Math.floor(region.y / ratio));
      const w = Math.min(width - x, Math.ceil(region.width / ratio) + 2),
        h = Math.min(height - y, Math.ceil(region.height / ratio) + 2);
      const sprite = canvas(w, h),
        ctx = sprite.getContext('2d')!;
      ctx.drawImage(source, x, y, w, h, 0, 0, w, h);
      const image = ctx.getImageData(0, 0, w, h);
      for (let py = 0; py < h; py++)
        for (let px = 0; px < w; px++) {
          const sx = Math.min(sample.width - 1, Math.floor((x + px) * ratio)),
            sy = Math.min(sample.height - 1, Math.floor((y + py) * ratio));
          const p = (py * w + px) * 4;
          if (
            labels[sy * sample.width + sx] !== region.id ||
            !mask[sy * sample.width + sx]
          )
            image.data[p + 3] = 0;
        }
      ctx.putImageData(image, 0, 0);
      add(sprite, x, y, `분리 영역 ${elements.length + 1}`, 'region');
    }
  }
  bc.save();
  bc.globalCompositeOperation = 'destination-over';
  bc.fillStyle = color;
  bc.fillRect(0, 0, width, height);
  bc.restore();
  return {
    width,
    height,
    source,
    background,
    color,
    elements,
    method: textBoxes.length
      ? 'PDF 텍스트 + 픽셀 영역'
      : tiled
        ? '이미지 조각 분할'
        : '배경 대비 · 픽셀 영역 분리',
    pageCount: 1,
  };
}

export async function loadPoster(
  file: File,
  detail: Detail,
  page = 1,
): Promise<PosterAsset> {
  if (file.size > 50 * 1024 * 1024)
    throw new Error('50MB 이하의 파일을 선택해 주세요.');
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const document = await pdfjs.getDocument({ data: await file.arrayBuffer() })
      .promise;
    try {
      const pdfPage = await document.getPage(Math.min(page, document.numPages));
      const natural = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({
        scale: Math.min(2, 1200 / Math.max(natural.width, natural.height)),
      });
      const source = canvas(viewport.width, viewport.height);
      await pdfPage.render({
        canvas: source,
        canvasContext: source.getContext('2d')!,
        viewport,
      }).promise;
      const content = await pdfPage.getTextContent();
      const boxes: Box[] = [];
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const t = pdfjs.Util.transform(viewport.transform, item.transform);
        const height = Math.hypot(t[2], t[3]);
        boxes.push({
          x: t[4],
          y: t[5] - height,
          width: item.width * viewport.scale,
          height: height * 1.2,
          label: item.str,
        });
      }
      const asset = extractElements(source, detail, boxes);
      asset.pageCount = document.numPages;
      return asset;
    } finally {
      await document.destroy();
    }
  }
  if (
    !/\.(png|jpe?g)$/i.test(file.name) &&
    !['image/png', 'image/jpeg'].includes(file.type)
  )
    throw new Error('PDF, JPG 또는 PNG 파일을 선택해 주세요.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error('이미지를 읽을 수 없습니다.');
    const scale = Math.min(
      1,
      1200 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const source = canvas(
      image.naturalWidth * scale,
      image.naturalHeight * scale,
    );
    source
      .getContext('2d')!
      .drawImage(image, 0, 0, source.width, source.height);
    return extractElements(source, detail);
  } finally {
    URL.revokeObjectURL(url);
  }
}
