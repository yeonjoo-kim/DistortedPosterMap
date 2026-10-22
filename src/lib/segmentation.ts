export interface Region {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  count: number;
}

/** Eight-connected component analysis. Labels include every foreground pixel. */
export function connectedRegions(
  mask: Uint8Array,
  width: number,
  height: number,
) {
  const labels = new Int32Array(width * height);
  const queue = new Int32Array(width * height);
  const regions: Region[] = [];
  let id = 0;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p] || labels[p]) continue;
    id++;
    let head = 0,
      tail = 1,
      minX = width,
      minY = height,
      maxX = 0,
      maxY = 0;
    queue[0] = p;
    labels[p] = id;
    while (head < tail) {
      const q = queue[head++],
        x = q % width,
        y = Math.floor(q / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx;
          if (mask[n] && !labels[n]) {
            labels[n] = id;
            queue[tail++] = n;
          }
        }
    }
    regions.push({
      id,
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      count: tail,
    });
  }
  return { regions, labels };
}

export function dilate(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
) {
  const output = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        if (x + dx >= 0 && x + dx < width) output[y * width + x + dx] = 1;
      }
    }
  return output;
}
