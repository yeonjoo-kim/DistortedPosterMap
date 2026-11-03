export interface Region {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  count: number;
}

/** Color/edge regions, including the paper itself. Every visible pixel has one owner. */
export function colorRegions(data: Uint8ClampedArray, width: number, height: number, cell = 90) {
  const labels = new Int32Array(width * height);
  const queue = new Int32Array(labels.length);
  const counts = [0];
  let next = 0;
  const similar = (a: number, b: number) => {
    const i = a * 4, j = b * 4;
    return Math.hypot(data[i] - data[j], data[i + 1] - data[j + 1], data[i + 2] - data[j + 2]) < 38;
  };
  for (let p = 0; p < labels.length; p++) {
    if (labels[p] || !data[p * 4 + 3]) continue;
    const id = ++next;
    let head = 0, tail = 1;
    queue[0] = p;
    labels[p] = id;
    while (head < tail) {
      const q = queue[head++], x = q % width, y = Math.floor(q / width);
      for (const n of [x ? q - 1 : -1, x + 1 < width ? q + 1 : -1, y ? q - width : -1, y + 1 < height ? q + width : -1]) {
        if (n >= 0 && !labels[n] && data[n * 4 + 3] && similar(q, n)) {
          labels[n] = id;
          queue[tail++] = n;
        }
      }
    }
    counts[id] = tail;
  }
  // Bound photo noise without dropping its pixels. Keep the largest color regions,
  // then grow them across their small neighboring antialias/noise regions.
  const keep = new Set(counts.map((count, id) => ({ count, id })).slice(1)
    .sort((a, b) => b.count - a.count).slice(0, 180).map(({ id }) => id));
  let head = 0, tail = 0;
  for (let p = 0; p < labels.length; p++) {
    if (keep.has(labels[p])) queue[tail++] = p;
    else labels[p] = 0;
  }
  while (head < tail) {
    const q = queue[head++], x = q % width, y = Math.floor(q / width);
    for (const n of [x ? q - 1 : -1, x + 1 < width ? q + 1 : -1, y ? q - width : -1, y + 1 < height ? q + width : -1]) {
      if (n >= 0 && !labels[n] && data[n * 4 + 3]) {
        labels[n] = labels[q];
        queue[tail++] = n;
      }
    }
  }
  const ids = new Map<string, number>(), regions: Region[] = [];
  const cols = Math.ceil(width / cell);
  for (let p = 0; p < labels.length; p++) {
    if (!data[p * 4 + 3]) continue;
    const x = p % width, y = Math.floor(p / width), old = labels[p];
    // Large flat backgrounds become separate pieces too; small glyphs stay whole.
    const key = counts[old] > cell * cell ? `${old}:${Math.floor(x / cell) + Math.floor(y / cell) * cols}` : String(old || `island:${Math.floor(x / cell)}:${Math.floor(y / cell)}`);
    let id = ids.get(key);
    if (!id) {
      id = regions.length + 1;
      ids.set(key, id);
      regions.push({ id, x, y, width: 1, height: 1, count: 0 });
    }
    labels[p] = id;
    const r = regions[id - 1], right = Math.max(r.x + r.width, x + 1), bottom = Math.max(r.y + r.height, y + 1);
    r.x = Math.min(r.x, x); r.y = Math.min(r.y, y);
    r.width = right - r.x; r.height = bottom - r.y; r.count++;
  }
  return { labels, regions };
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
