export function roundedTopPath(x, y, w, h, r) {
  if (h <= 0) return "";
  r = Math.min(r, w / 2, h);
  return (
    `M${x},${y + r}` +
    ` Q${x},${y} ${x + r},${y}` +
    ` L${x + w - r},${y}` +
    ` Q${x + w},${y} ${x + w},${y + r}` +
    ` L${x + w},${y + h}` +
    ` L${x},${y + h} Z`
  );
}

// A horizontal bar growing rightward: rounded on the right (data) end,
// square where it meets the baseline on the left.
export function roundedRightPath(x, y, w, h, r) {
  if (w <= 0) return "";
  r = Math.min(r, h / 2, w);
  return (
    `M${x},${y}` +
    ` L${x + w - r},${y}` +
    ` Q${x + w},${y} ${x + w},${y + r}` +
    ` L${x + w},${y + h - r}` +
    ` Q${x + w},${y + h} ${x + w - r},${y + h}` +
    ` L${x},${y + h} Z`
  );
}

// The two extra faces that turn a flat rect into an extruded 3D block:
// a "top" cap along the rect's top edge and a "side" cap along its right
// edge, both receding toward (x+dx, y+dy). Works for both a tall vertical
// bar and a wide horizontal one — it's the same rectangle geometry either way.
export function extrudeFaces(x, y, w, h, dx, dy) {
  const top = `M${x},${y} L${x + dx},${y + dy} L${x + w + dx},${y + dy} L${x + w},${y} Z`;
  const side = `M${x + w},${y} L${x + w + dx},${y + dy} L${x + w + dx},${y + h + dy} L${x + w},${y + h} Z`;
  return { top, side };
}
