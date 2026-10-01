// static/js/routing.js

export const GRID = 10;
const OBSTACLE_MARGIN = GRID;
const TURN_PENALTY = 3;

export function componentBBox(comp, spec) {
  return { x: comp.position.x, y: comp.position.y,
           w: spec.size[0], h: spec.size[1] };
}

/**
 * Ортогональный A* по сетке.
 * Возвращает массив точек маршрута или null, если путь не найден.
 */
export function routeOrthogonal(start, goal, obstacles, opts = {}) {
  const startDir = opts.startDir || null;
  const endDir   = opts.endDir   || null;
  const extraBlocked = opts.blocked || [];

  // Расширяем рабочую область с запасом вокруг старта, финиша и всех препятствий.
  const xs = [start.x, goal.x];
  const ys = [start.y, goal.y];
  for (const o of obstacles) {
    xs.push(o.x - GRID, o.x + o.w + GRID);
    ys.push(o.y - GRID, o.y + o.h + GRID);
  }
  for (const o of extraBlocked) {
    xs.push(o.x - GRID, o.x + o.w + GRID);
    ys.push(o.y - GRID, o.y + o.h + GRID);
  }
  const x0 = Math.min(...xs) - GRID * 6;
  const y0 = Math.min(...ys) - GRID * 6;
  const x1 = Math.max(...xs) + GRID * 6;
  const y1 = Math.max(...ys) + GRID * 6;

  const cols = Math.ceil((x1 - x0) / GRID) + 1;
  const rows = Math.ceil((y1 - y0) / GRID) + 1;
  if (cols <= 2 || rows <= 2) return null;

  const toCell = (p) => ({
    cx: Math.round((p.x - x0) / GRID),
    cy: Math.round((p.y - y0) / GRID),
  });
  const toWorld = (cx, cy) => ({ x: x0 + cx * GRID, y: y0 + cy * GRID });

  const sc = toCell(start);
  const ec = toCell(goal);

  const blocked = new Uint8Array(cols * rows);
  const markRect = (r, margin) => {
    const cx0 = Math.floor((r.x - margin - x0) / GRID);
    const cx1 = Math.ceil ((r.x + r.w + margin - x0) / GRID);
    const cy0 = Math.floor((r.y - margin - y0) / GRID);
    const cy1 = Math.ceil ((r.y + r.h + margin - y0) / GRID);
    for (let cy = cy0; cy <= cy1; cy++) {
      if (cy < 0 || cy >= rows) continue;
      for (let cx = cx0; cx <= cx1; cx++) {
        if (cx < 0 || cx >= cols) continue;
        blocked[cy * cols + cx] = 1;
      }
    }
  };
  for (const o of obstacles) markRect(o, OBSTACLE_MARGIN);
  for (const o of extraBlocked) markRect(o, Math.round(GRID / 2));

  // Разблокируем стартовую, финишную и одну «соседнюю» клетку по
  // направлению выхода — чтобы A* мог выехать из порта.
  blocked[sc.cy * cols + sc.cx] = 0;
  blocked[ec.cy * cols + ec.cx] = 0;

  // Дополнительно разблокируем две клетки вдоль направлений выхода,
  // если они в пределах массива.
  const dirStep = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
  if (startDir && dirStep[startDir]) {
    const [dx, dy] = dirStep[startDir];
    for (let k = 1; k <= 2; k++) {
      const cx = sc.cx + dx * k, cy = sc.cy + dy * k;
      if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) blocked[cy * cols + cx] = 0;
    }
  }
  if (endDir && dirStep[endDir]) {
    const [dx, dy] = dirStep[endDir];
    for (let k = 1; k <= 2; k++) {
      const cx = ec.cx + dx * k, cy = ec.cy + dy * k;
      if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) blocked[cy * cols + cx] = 0;
    }
  }

  const DN = 5;
  const idx = (cx, cy, d) => (cy * cols + cx) * DN + (d + 1);
  const g = new Float32Array(cols * rows * DN).fill(Infinity);
  const par = new Int32Array(cols * rows * DN).fill(-1);

  const dCode = (d) => ({ up:0, right:1, down:2, left:3 }[d] ?? -1);
  const sD = startDir ? dCode(startDir) : -1;
  const si = idx(sc.cx, sc.cy, sD);
  g[si] = 0;

  const dirs = [
    { d: 0, dc: 0,  dr: -1 },
    { d: 1, dc: 1,  dr: 0  },
    { d: 2, dc: 0,  dr: 1  },
    { d: 3, dc: -1, dr: 0  },
  ];
  const heur = (a, b) => Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);

  const open = [{ idx: si, cx: sc.cx, cy: sc.cy, d: sD, f: heur(sc, ec) }];
  let guard = 0;
  while (open.length && guard++ < 300000) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];

    if (cur.cx === ec.cx && cur.cy === ec.cy) {
      const path = [];
      let s = cur.idx;
      while (s !== -1) {
        const cell = Math.floor(s / DN);
        const cx = cell % cols;
        const cy = Math.floor(cell / cols);
        path.push(toWorld(cx, cy));
        s = par[s];
      }
      path.reverse();
      return simplifyPath(path);
    }

    for (const d of dirs) {
      const nx = cur.cx + d.dc, ny = cur.cy + d.dr;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (blocked[ny * cols + nx]) continue;
      const turn = (cur.d !== -1 && cur.d !== d.d) ? 1 : 0;
      const cost = 1 + turn * TURN_PENALTY;
      const ni = idx(nx, ny, d.d);
      const t = g[cur.idx] + cost;
      if (t < g[ni]) {
        g[ni] = t;
        par[ni] = cur.idx;
        open.push({ idx: ni, cx: nx, cy: ny, d: d.d,
                    f: t + heur({ cx: nx, cy: ny }, ec) });
      }
    }
  }

  return null;
}

export function simplifyPath(pts) {
  if (!pts || pts.length <= 2) return (pts || []).slice();
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    const colX = Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5;
    const colY = Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5;
    if (!colX && !colY) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}