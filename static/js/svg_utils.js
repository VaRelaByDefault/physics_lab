import { specOf } from "./state.js";

export const NS = "http://www.w3.org/2000/svg";

export function el(tag, attrs = {}, children = []) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) n.setAttribute(k, v);
  }
  for (const c of children) n.appendChild(c);
  return n;
}

/** Мировая координата терминала с учётом поворота компонента. */
export function terminalWorldPos(comp, termSpec) {
  const spec = specOf(comp.type);
  const w = spec.size[0], h = spec.size[1];
  const rad = (comp.rotation || 0) * Math.PI / 180;
  const cx = w / 2, cy = h / 2;
  const dx = termSpec.x - cx;
  const dy = termSpec.y - cy;
  const lx = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
  return { x: comp.position.x + lx, y: comp.position.y + ly };
}

/**
 * Сторона компонента, на которой «сидит» терминал.
 * Учитывает поворот. Возвращает "left" | "right" | "top" | "bottom".
 */
export function terminalSide(comp, termSpec, spec) {
  const w = spec.size[0], h = spec.size[1];
  const cx = w / 2, cy = h / 2;
  const dx = termSpec.x - cx, dy = termSpec.y - cy;
  const rad = (comp.rotation || 0) * Math.PI / 180;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  if (Math.abs(lx) > Math.abs(ly)) return lx > 0 ? "right" : "left";
  return ly > 0 ? "bottom" : "top";
}

/**
 * Точка «выноса» — куда уходит провод от терминала прежде чем
 * маршрутизироваться. Длина кратна шагу сетки (10), чтобы первая
 * точка маршрута тоже лежала на сетке.
 */
export function stubPoint(pos, side, len = 20) {
  switch (side) {
    case "left":   return { x: pos.x - len, y: pos.y };
    case "right":  return { x: pos.x + len, y: pos.y };
    case "top":    return { x: pos.x, y: pos.y - len };
    case "bottom": return { x: pos.x, y: pos.y + len };
  }
  return { ...pos };
}

/** Расстояние от точки до отрезка; возвращает ближайшую точку. */
export function closestPointOnSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}