export interface Region {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  count: number;
}

/** Connected color shapes, including background cutouts. Never adds grid cuts. */
export function colorRegions(
  data: Uint8ClampedArray, width: number, height: number, paletteSize = 10,
) {
  const size = width * height, labels = new Int32Array(size);
  const bins = new Map<number, { count: number; color: number[] }>();
  for (let p = 0; p < size; p++) {
    const i = p * 4;
    if (!data[i + 3]) continue;
    const key = (data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4);
    const bin = bins.get(key) ?? { count: 0, color: [0, 0, 0] };
    bin.count++;
    for (let c = 0; c < 3; c++) bin.color[c] += data[i + c];
    bins.set(key, bin);
  }
  if (!bins.size) return { labels, regions: [] as Region[] };
  const colors = [...bins.values()].map((bin) => ({ count: bin.count, color: bin.color.map((v) => v / bin.count) }));
  const distance = (a: number[], b: number[]) => a.reduce((s, v, c) => s + (v - b[c]) ** 2, 0);
  const palette = [[...colors.reduce((a, b) => a.count > b.count ? a : b).color]];
  while (palette.length < Math.min(paletteSize, colors.length)) {
    const next = colors.reduce((best, bin) => {
      const score = Math.min(...palette.map((p) => distance(p, bin.color))) * Math.sqrt(bin.count);
      return score > best.score ? { score, color: bin.color } : best;
    }, { score: 0, color: palette[0] });
    if (next.score < 1) break;
    palette.push([...next.color]);
  }
  const nearest = (color: number[]) => {
    let best = 0, score = Infinity;
    palette.forEach((p, id) => { const d = distance(p, color); if (d < score) { score = d; best = id; } });
    return best;
  };
  // Weighted palette simplification groups photographic texture and gradients
  // into a small number of colors, while retaining the original sprite pixels.
  for (let pass = 0; pass < 8; pass++) {
    const sums = palette.map(() => [0, 0, 0, 0]);
    for (const bin of colors) {
      const sum = sums[nearest(bin.color)];
      sum[3] += bin.count;
      for (let c = 0; c < 3; c++) sum[c] += bin.color[c] * bin.count;
    }
    sums.forEach((sum, id) => { if (sum[3]) palette[id] = sum.slice(0, 3).map((v) => v / sum[3]); });
  }
  const lookup = new Map<number, number>();
  for (const [key, bin] of bins) lookup.set(key, nearest(bin.color.map((v) => v / bin.count)));
  const assigned = new Int16Array(size).fill(-1);
  for (let p = 0; p < size; p++) if (data[p * 4 + 3]) {
    const i = p * 4;
    assigned[p] = lookup.get((data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4))!;
  }
  const queue = new Int32Array(size), counts = [0], sums = [[0, 0, 0]], neighbors = [new Set<number>()];
  let next = 0;
  const adjacent = (p: number) => {
    const x = p % width, y = Math.floor(p / width);
    return [x ? p - 1 : -1, x + 1 < width ? p + 1 : -1, y ? p - width : -1, y + 1 < height ? p + width : -1];
  };
  for (let p = 0; p < size; p++) {
    if (assigned[p] < 0 || labels[p]) continue;
    const id = ++next;
    let head = 0, tail = 1;
    queue[0] = p; labels[p] = id;
    sums[id] = [0, 0, 0]; neighbors[id] = new Set();
    while (head < tail) {
      const q = queue[head++];
      for (let c = 0; c < 3; c++) sums[id][c] += data[q * 4 + c];
      for (const n of adjacent(q)) if (n >= 0 && !labels[n] && assigned[n] === assigned[q]) {
        labels[n] = id; queue[tail++] = n;
      }
    }
    counts[id] = tail;
  }
  for (let p = 0; p < size; p++) if (labels[p]) {
    for (const n of [p % width + 1 < width ? p + 1 : -1, p + width < size ? p + width : -1]) {
      if (n >= 0 && labels[n] && labels[n] !== labels[p]) {
        neighbors[labels[p]].add(labels[n]); neighbors[labels[n]].add(labels[p]);
      }
    }
  }
  const parent = counts.map((_, id) => id);
  const root = (id: number): number => {
    while (parent[id] !== id) { parent[id] = parent[parent[id]]; id = parent[id]; }
    return id;
  };
  let remaining = next;
  const budget = paletteSize * 12;
  // Merge only neighboring regions. Small antialias/noise regions join the
  // closest color; complex images are simplified without geometric tile edges.
  for (const id of counts.map((_, id) => id).slice(1).sort((a, b) => counts[a] - counts[b])) {
    if (root(id) !== id) continue;
    let best = 0, score = Infinity;
    for (const other of neighbors[id]) {
      const n = root(other); if (n === id) continue;
      const d = distance(sums[id].map((v) => v / counts[id]), sums[n].map((v) => v / counts[n]));
      if (d < score) { score = d; best = n; }
    }
    if (!best || !(remaining > budget || counts[id] < 16 && score < 140 ** 2)) continue;
    parent[id] = best; counts[best] += counts[id];
    for (let c = 0; c < 3; c++) sums[best][c] += sums[id][c];
    for (const n of neighbors[id]) neighbors[best].add(n);
    remaining--;
  }
  const ids = new Map<number, number>(), regions: Region[] = [];
  for (let p = 0; p < size; p++) {
    if (!labels[p]) continue;
    const owner = root(labels[p]), x = p % width, y = Math.floor(p / width);
    let id = ids.get(owner);
    if (!id) { id = regions.length + 1; ids.set(owner, id); regions.push({ id, x, y, width: 1, height: 1, count: 0 }); }
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
