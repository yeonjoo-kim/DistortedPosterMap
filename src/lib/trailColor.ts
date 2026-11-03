/** A stable, saturated RGB color for each newly created poster piece. */
export function randomTrailColor(random = Math.random) {
  const h = random() * 6,
    v = Math.round(225 + random() * 30);
  const x = Math.round(v * (1 - Math.abs((h % 2) - 1)));
  const rgb =
    h < 1
      ? [v, x, 0]
      : h < 2
        ? [x, v, 0]
        : h < 3
          ? [0, v, x]
          : h < 4
            ? [0, x, v]
            : h < 5
              ? [x, 0, v]
              : [v, 0, x];
  return `rgb(${rgb.join(',')})`;
}
