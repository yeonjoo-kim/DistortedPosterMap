import { canvas } from './demo';
import { colorRegions } from './segmentation';
import type { Detail, PosterAsset, PosterElement } from './types';

type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
};

export function extractElements(
  source: HTMLCanvasElement,
  detail: Detail,
  _textBoxes: Box[] = [],
): PosterAsset {
  const { width, height } = source;
  const ratio = Math.min(1, 640 / Math.max(width, height));
  const sample = canvas(width * ratio, height * ratio);
  const sc = sample.getContext('2d', { willReadFrequently: true })!;
  sc.drawImage(source, 0, 0, sample.width, sample.height);
  const pixels = sc.getImageData(0, 0, sample.width, sample.height);
  const { regions, labels } = colorRegions(pixels.data, sample.width, sample.height,
    detail === 'fine' ? 65 : detail === 'coarse' ? 130 : 90);
  const elements: PosterElement[] = [];
  // Analyze boundaries at preview resolution, but retain original-resolution colors.
  const original = source.getContext('2d')!.getImageData(0, 0, width, height);
  const sx = sample.width / width, sy = sample.height / height;
  for (const region of regions) {
    const x = Math.max(0, Math.floor(region.x / sx)), y = Math.max(0, Math.floor(region.y / sy));
    const w = Math.min(width - x, Math.ceil((region.x + region.width) / sx) - x);
    const h = Math.min(height - y, Math.ceil((region.y + region.height) / sy) - y);
    const sprite = canvas(w, h), ctx = sprite.getContext('2d')!;
    const image = ctx.createImageData(w, h);
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      const label = labels[Math.min(sample.height - 1, Math.floor((y + py) * sy)) * sample.width + Math.min(sample.width - 1, Math.floor((x + px) * sx))];
      if (label !== region.id) continue;
      const from = ((y + py) * width + x + px) * 4, to = (py * w + px) * 4;
      image.data.set(original.data.subarray(from, from + 4), to);
    }
    ctx.putImageData(image, 0, 0);
    elements.push({ id: `e${String(elements.length + 1).padStart(3, '0')}`,
      label: `Color region ${elements.length + 1}`, kind: 'region', sprite, pixelArea: region.count / (sx * sy),
      x: x + w / 2, y: y + h / 2, width: w, height: h });
  }
  return { width, height, source, background: canvas(width, height), color: 'transparent',
    elements, method: 'Color boundaries + breakable background', pageCount: 1 };
}

export async function loadPoster(
  file: File,
  detail: Detail,
  page = 1,
): Promise<PosterAsset> {
  if (file.size > 50 * 1024 * 1024)
    throw new Error('Choose a file smaller than 50 MB.');
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
    throw new Error('Choose a PDF, JPG or PNG file.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error('Unable to read this image.');
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
