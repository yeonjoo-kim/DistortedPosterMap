import type { PosterPhysics } from './physics';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportPoster(
  engine: PosterPhysics,
  format: 'png' | 'jpg' | 'pdf',
  name: string,
  overlays: boolean,
  multiplier: number,
) {
  const output = engine.snapshot(overlays, multiplier);
  const basename =
    name
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9가-힣_-]/g, '-')
      .slice(0, 70) || 'poster';
  if (format === 'pdf') {
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({
      orientation: output.width > output.height ? 'landscape' : 'portrait',
      unit: 'px',
      format: [output.width, output.height],
      hotfixes: ['px_scaling'],
    });
    pdf.addImage(
      output.toDataURL('image/png'),
      'PNG',
      0,
      0,
      output.width,
      output.height,
    );
    pdf.save(`${basename}-offset.pdf`);
  } else {
    const blob = await new Promise<Blob | null>((resolve) =>
      output.toBlob(
        resolve,
        format === 'jpg' ? 'image/jpeg' : 'image/png',
        0.95,
      ),
    );
    if (!blob)
      throw new Error('이미지 저장에 실패했습니다. 다시 시도해 주세요.');
    download(blob, `${basename}-offset.${format}`);
  }
}

export function exportMap(engine: PosterPhysics, name: string) {
  download(
    new Blob([JSON.stringify(engine.mapData(), null, 2)], {
      type: 'application/json',
    }),
    `${name.replace(/\.[^.]+$/, '')}-coordinates.json`,
  );
}
