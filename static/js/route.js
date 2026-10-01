// static/js/route.js
import { specOf } from "./state.js";
import { terminalWorldPos, terminalSide, stubPoint } from "./svg_utils.js";
import { routeOrthogonal, componentBBox, simplifyPath, GRID } from "./routing.js";

export function buildTerminalIndex(project) {
  const map = new Map();
  for (const c of project.components) {
    const spec = specOf(c.type);
    if (!spec) continue;
    for (const t of spec.terminals) {
      map.set(`${c.id}/${t.id}`, terminalWorldPos(c, t));
    }
  }
  return map;
}

/* ============================================================
 *  Информация о концах
 * ============================================================ */

function terminalEndInfo(project, end) {
  const comp = project.components.find((c) => c.id === end.component_id);
  if (!comp) return null;
  const spec = specOf(comp.type);
  if (!spec) return null;
  const termSpec = spec.terminals.find((t) => t.id === end.terminal_id);
  if (!termSpec) return null;

  const pos = terminalWorldPos(comp, termSpec);

  if (comp.type === "junction") {
    const dirMap = { n: "up", e: "right", s: "down", w: "left" };
    const sideMap = { up: "top", right: "right", down: "bottom", left: "left" };
    const dir = dirMap[end.terminal_id] || "right";
    const port = stubPoint(pos, sideMap[dir], GRID * 2);
    return { pos, port, dir, ownerId: comp.id };
  }

  const side = terminalSide(comp, termSpec, spec);
  const dirMap = { top: "up", right: "right", bottom: "down", left: "left" };
  const dir = dirMap[side] || "right";
  const port = stubPoint(pos, side, GRID * 2);
  return { pos, port, dir, ownerId: comp.id };
}

function freeEndInfo(end) {
  const pos = { x: end.x, y: end.y };
  return { pos, port: pos, dir: null, ownerId: null };
}

function endsInfo(project, conn) {
  const out = [];
  for (const end of conn.ends) {
    if (end.kind === "terminal") out.push(terminalEndInfo(project, end));
    else if (end.kind === "free") out.push(freeEndInfo(end));
    else out.push(null);
  }
  return out;
}

export { endsInfo as getEndsInfo };

/* ============================================================
 *  Ортогонализация и ручной маршрут по waypoints
 * ============================================================ */

function orthogonalizeRoute(points) {
  if (points.length < 2) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    if (Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5) {
      out.push({ ...b });
    } else {
      out.push({ x: b.x, y: a.y });
      out.push({ ...b });
    }
  }
  const cleaned = [out[0]];
  for (let i = 1; i < out.length; i++) {
    const prev = cleaned[cleaned.length - 1];
    const cur = out[i];
    if (Math.abs(prev.x - cur.x) < 0.5 && Math.abs(prev.y - cur.y) < 0.5) continue;
    cleaned.push(cur);
  }
  return cleaned;
}

function buildManualRoute(a, b, waypoints) {
  const raw = [a.pos];
  if (a.port.x !== a.pos.x || a.port.y !== a.pos.y) raw.push(a.port);
  for (const [x, y] of waypoints) raw.push({ x, y });
  if (b.port.x !== b.pos.x || b.port.y !== b.pos.y) raw.push(b.port);
  raw.push(b.pos);
  return orthogonalizeRoute(raw);
}

/* ============================================================
 *  Автоматический маршрут (A*)
 * ============================================================ */

function buildAutoRoute(project, conn, ends, extraBlocked) {
  const [a, b] = ends;

  const allComps = [];
  for (const c of project.components) {
    const spec = specOf(c.type);
    if (!spec) continue;
    allComps.push({ id: c.id, bbox: componentBBox(c, spec) });
  }

  const opts = {
    startDir: a.dir,
    endDir: b.dir,
    blocked: extraBlocked,
  };

  let path = routeOrthogonal(a.port, b.port, allComps.map((x) => x.bbox), opts);

  if (!path) {
    const ignore = new Set([a.ownerId, b.ownerId].filter(Boolean));
    const obstacles2 = allComps
      .filter((x) => !ignore.has(x.id))
      .map((x) => x.bbox);
    path = routeOrthogonal(a.port, b.port, obstacles2, opts);
  }

  if (!path) {
    path = simplifyPath([a.port, { x: b.port.x, y: a.port.y }, b.port]);
  }

  const full = [a.pos];
  if (a.port.x !== a.pos.x || a.port.y !== a.pos.y) full.push(a.port);
  for (let i = 1; i < path.length - 1; i++) full.push(path[i]);
  if (b.port.x !== b.pos.x || b.port.y !== b.pos.y) full.push(b.port);
  full.push(b.pos);

  return simplifyPath(full);
}

/* ============================================================
 *  Публичный расчёт маршрута
 * ============================================================ */

export function computeRoute(project, conn, cache = new Map()) {
  if (cache.has(conn.id)) return cache.get(conn.id);
  cache.set(conn.id, []);

  const ends = endsInfo(project, conn);
  if (!ends[0] || !ends[1]) return [];

  const hasWaypoints =
    Array.isArray(conn.waypoints) && conn.waypoints.length > 0;

  let route;
  if (hasWaypoints) {
    route = buildManualRoute(ends[0], ends[1], conn.waypoints);
  } else {
    const extraBlocked = [];
    for (const [, r] of cache) {
      for (let i = 0; i < r.length - 1; i++) {
        const p1 = r[i], p2 = r[i + 1];
        extraBlocked.push({
          x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y),
          w: Math.abs(p2.x - p1.x) || 1,
          h: Math.abs(p2.y - p1.y) || 1,
        });
      }
    }
    route = buildAutoRoute(project, conn, ends, extraBlocked);
  }

  cache.set(conn.id, route);
  return route;
}

/* ============================================================
 *  Вспомогательные
 * ============================================================ */

export function pointOnRoute(route, t) {
  if (!route || route.length < 2) return route?.[0] || null;
  const totalLen = routeLen(route);
  if (totalLen === 0) return route[0];
  let target = Math.max(0, Math.min(1, t)) * totalLen;
  for (let i = 0; i < route.length - 1; i++) {
    const L = segLen(route[i], route[i + 1]);
    if (target <= L) {
      const u = L > 0 ? target / L : 0;
      return {
        x: route[i].x + (route[i + 1].x - route[i].x) * u,
        y: route[i].y + (route[i + 1].y - route[i].y) * u,
      };
    }
    target -= L;
  }
  return route[route.length - 1];
}

export function nearestOnRouteWithT(route, p) {
  if (!route || route.length < 2) return null;
  const totalLen = routeLen(route);
  let bestD = Infinity, bestPos = route[0], bestT = 0, acc = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i], b = route[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let u = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    u = Math.max(0, Math.min(1, u));
    const qx = a.x + u * dx, qy = a.y + u * dy;
    const d = Math.hypot(qx - p.x, qy - p.y);
    if (d < bestD) {
      bestD = d;
      bestPos = { x: qx, y: qy };
      bestT = totalLen > 0 ? (acc + u * segLen(a, b)) / totalLen : 0;
    }
    acc += segLen(a, b);
  }
  return { pos: bestPos, t: bestT, dist: bestD };
}

export function snapPointToRouteGrid(route, pos) {
  if (!route || route.length < 2) return { x: pos.x, y: pos.y };

  let bestI = 0, bestD = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i], b = route[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let u = len2 ? ((pos.x - a.x) * dx + (pos.y - a.y) * dy) / len2 : 0;
    u = Math.max(0, Math.min(1, u));
    const qx = a.x + u * dx, qy = a.y + u * dy;
    const d = Math.hypot(qx - pos.x, qy - pos.y);
    if (d < bestD) { bestD = d; bestI = i; }
  }

  const a = route[bestI], b = route[bestI + 1];

  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let u = len2 ? ((pos.x - a.x) * dx + (pos.y - a.y) * dy) / len2 : 0;
  u = Math.max(0, Math.min(1, u));
  const px = a.x + u * dx;
  const py = a.y + u * dy;

  const isHoriz = Math.abs(a.y - b.y) < 0.5;
  const isVert  = Math.abs(a.x - b.x) < 0.5;

  if (isHoriz) {
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
    let sx = Math.round(px / GRID) * GRID;
    sx = Math.max(minX, Math.min(maxX, sx));
    return { x: sx, y: a.y };
  }
  if (isVert) {
    const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
    let sy = Math.round(py / GRID) * GRID;
    sy = Math.max(minY, Math.min(maxY, sy));
    return { x: a.x, y: sy };
  }
  return { x: px, y: py };
}

function routeLen(route) {
  let L = 0;
  for (let i = 0; i < route.length - 1; i++) L += segLen(route[i], route[i + 1]);
  return L;
}
function segLen(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function trimRouteToCorners(conn, route) {
  return route.slice(1, -1);
}