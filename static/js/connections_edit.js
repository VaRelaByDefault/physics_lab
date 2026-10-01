// static/js/connections_edit.js
import { getActive, markDirty } from "./state.js";
import { layer, screenToWorld, setStatus, workspaceSvg } from "./workspace.js";
import { el, closestPointOnSegment } from "./svg_utils.js";
import { getSelectedConnections, emitSelectionChange } from "./selection.js";
import {
  buildTerminalIndex, computeRoute, nearestOnRouteWithT, snapPointToRouteGrid,
  getEndsInfo,
} from "./route.js";
import { renderAllConnections } from "./connections.js";
import { showContextMenu } from "./contextmenu.js";
import { pushHistory } from "./history.js";
import {
  beginTransaction, commitTransaction, rollbackTransaction,
} from "./history.js";

const GRID = 10;
const SNAP_RADIUS = 15;
const HANDLE_HIT_R = 10;
const SEGMENT_HIT_R = 8;
const VIS_R_ENDPOINT = 6;
const VIS_R_CORNER = 5;

let endDrag = null;
let segDrag = null;
let lastSelectedConnId = null;

/* ============================================================
 *  Границы «интересной части» маршрута
 * ============================================================ */

function routeExtent(route, ends) {
  if (!route || route.length < 2) return { first: 0, last: -1 };

  const near = (pt, ref) =>
    ref && Math.abs(pt.x - ref.x) < 1 && Math.abs(pt.y - ref.y) < 1;

  const a = ends[0] || {};
  const b = ends[1] || {};

  let first = 0;
  while (
    first < route.length &&
    (near(route[first], a.pos) || near(route[first], a.port))
  ) first++;

  let last = route.length - 1;
  while (
    last >= 0 &&
    (near(route[last], b.pos) || near(route[last], b.port))
  ) last--;

  return { first, last };
}

function computeRouteInContext(project, connId) {
  const cache = new Map();
  for (const c of project.connections) {
    computeRoute(project, c, cache);
  }
  return cache.get(connId) || [];
}

function freezeRoute(project, conn) {
  if (Array.isArray(conn.waypoints) && conn.waypoints.length > 0) return false;
  const route = computeRouteInContext(project, conn.id);
  if (route.length < 2) return false;

  const ends = getEndsInfo(project, conn);
  const { first, last } = routeExtent(route, ends);

  const wps = [];
  for (let i = first; i <= last; i++) {
    wps.push([route[i].x, route[i].y]);
  }
  conn.waypoints = wps;
  return true;
}

/* ============================================================
 *  Удаление коллинеарных (180°) углов
 * ============================================================ */

function cleanupCollinearWaypoints(conn) {
  if (!Array.isArray(conn.waypoints) || conn.waypoints.length < 3) return false;
  const wps = conn.waypoints;
  let changed = false;
  let i = 1;
  while (i < wps.length - 1) {
    const a = wps[i - 1], b = wps[i], c = wps[i + 1];
    const colX = Math.abs(a[0] - b[0]) < 0.5 && Math.abs(b[0] - c[0]) < 0.5;
    const colY = Math.abs(a[1] - b[1]) < 0.5 && Math.abs(b[1] - c[1]) < 0.5;
    if (colX || colY) {
      wps.splice(i, 1);
      changed = true;
    } else {
      i++;
    }
  }
  return changed;
}

function handleSelectionChange(project) {
  const selected = getSelectedConnections();
  const currentId = selected.size === 1 ? [...selected][0] : null;

  if (lastSelectedConnId !== currentId) {
    if (lastSelectedConnId !== null) {
      const prev = project.connections.find((w) => w.id === lastSelectedConnId);
      if (prev) {
        const cleaned = cleanupCollinearWaypoints(prev);
        if (cleaned) {
          markDirty(project);
          renderAllConnections();
        }
      }
    }
    lastSelectedConnId = currentId;
  }
}

/* ============================================================
 *  Ручки выделенного соединения
 * ============================================================ */

export function renderWaypointHandles() {
  const overlay = layer("overlay");
  overlay.querySelectorAll(".wp-handle").forEach((n) => n.remove());
  overlay.querySelectorAll(".end-handle").forEach((n) => n.remove());
  overlay.querySelectorAll(".handle-hit").forEach((n) => n.remove());

  const p = getActive();
  if (!p) return;

  handleSelectionChange(p);

  const selected = getSelectedConnections();
  if (selected.size !== 1) return;
  const conn = p.connections.find((w) => w.id === [...selected][0]);
  if (!conn) return;

  const route = computeRouteInContext(p, conn.id);
  if (route.length < 2) return;

  const ends = getEndsInfo(p, conn);
  const { first, last } = routeExtent(route, ends);

  // --- Ручки углов ---
  if (last >= first) {
    for (let i = first; i <= last; i++) {
      const pt = route[i];
      if (i > first) {
        const prev = route[i - 1];
        if (Math.abs(prev.x - pt.x) < 0.5 && Math.abs(prev.y - pt.y) < 0.5) continue;
      }

      const visible = el("circle", {
        class: "wp-handle",
        cx: pt.x, cy: pt.y, r: VIS_R_CORNER,
        fill: "#ffffff",
        stroke: "#2b7cff",
        "stroke-width": 2,
        "pointer-events": "none",
      });
      overlay.appendChild(visible);

      const hit = el("circle", {
        class: "handle-hit",
        cx: pt.x, cy: pt.y, r: HANDLE_HIT_R,
        fill: "transparent",
        style: "cursor: move;",
      });
      hit.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        onCornerGrab(e, p, conn, i, first);
      });
      hit.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onCornerContextMenu(e, p, conn, i, first);
      });
      overlay.appendChild(hit);
    }
  }

  // --- Ручки концов ---
  conn.ends.forEach((end, idx) => {
    let pos;
    if (end.kind === "terminal") pos = terminalEndPos(p, end);
    else if (end.kind === "free") pos = { x: end.x, y: end.y };
    if (!pos) return;

    const isFree = end.kind === "free";
    const visible = el("circle", {
      class: "end-handle",
      cx: pos.x, cy: pos.y, r: VIS_R_ENDPOINT,
      fill: isFree ? "#fff7d6" : "#ffffff",
      stroke: "#2b7cff",
      "stroke-width": 2,
      "pointer-events": "none",
    });
    overlay.appendChild(visible);

    const hit = el("circle", {
      class: "handle-hit",
      cx: pos.x, cy: pos.y, r: HANDLE_HIT_R,
      fill: "transparent",
      style: "cursor: grab;",
    });
    hit.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      startEndDrag(e, p, conn, idx);
    });
    overlay.appendChild(hit);
  });
}

function terminalEndPos(project, end) {
  const comp = project.components.find((c) => c.id === end.component_id);
  if (!comp) return null;
  const idx = buildTerminalIndex(project);
  return idx.get(`${comp.id}/${end.terminal_id}`) || null;
}

/* ============================================================
 *  Захват угла
 * ============================================================ */

function onCornerGrab(e, project, conn, routeIdx, firstIdx) {
  const wasFrozen = freezeRoute(project, conn);
  if (wasFrozen) {
    pushHistory(project, "freeze route");
    markDirty(project);
  }
  const wpIndex = routeIdx - firstIdx;
  if (wpIndex < 0 || wpIndex >= conn.waypoints.length) return;
  startWaypointDrag(e, project, conn, wpIndex);
}

/* ============================================================
 *  Контекстное меню ручки угла
 * ============================================================ */

function onCornerContextMenu(e, project, conn, routeIdx, firstIdx) {
  // Убедимся, что waypoints существуют, иначе индексы несогласованы
  const wasFrozen = freezeRoute(project, conn);
  if (wasFrozen) {
    pushHistory(project, "freeze route");
    markDirty(project);
    renderAllConnections();
  }

  const wpIndex = routeIdx - firstIdx;
  const validIndex = wpIndex >= 0 && wpIndex < conn.waypoints.length;

  showContextMenu(e.clientX, e.clientY, [
    {
      label: "Разделить здесь",
      action: () => {
        if (!validIndex) return;
        import("./operations.js").then((ops) => {
          ops.splitConnectionAtWaypoint(project, conn.id, wpIndex);
        });
      },
      disabled: !validIndex,
    },
    { sep: true },
    {
      label: "Удалить угол",
      danger: true,
      action: () => onCornerRemove(project, conn, wpIndex),
    },
  ]);
}

function onCornerRemove(project, conn, wpIndex) {
  if (wpIndex < 0 || wpIndex >= conn.waypoints.length) return;
  pushHistory(project, "remove waypoint");
  conn.waypoints.splice(wpIndex, 1);
  markDirty(project);
  renderAllConnections();
  renderWaypointHandles();
}

/* ============================================================
 *  Детектор клика по сегменту (capture-фаза)
 * ============================================================ */

workspaceSvg.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  if (e.detail >= 2) return;

  const p = getActive();
  if (!p) return;
  const selected = getSelectedConnections();
  if (selected.size !== 1) return;
  const conn = p.connections.find((w) => w.id === [...selected][0]);
  if (!conn) return;

  const t = e.target;
  if (t.classList?.contains("handle-hit")) return;
  if (t.classList?.contains("wp-handle")) return;
  if (t.classList?.contains("end-handle")) return;
  if (t.closest?.(".component")) return;

  // Клик по другому соединению — пусть выделяется штатно
  const otherConn = t.closest?.(".connection");
  if (otherConn && otherConn.dataset.id !== conn.id) return;

  const route = computeRouteInContext(p, conn.id);
  if (route.length < 2) return;

  const ends = getEndsInfo(p, conn);
  const { first, last } = routeExtent(route, ends);
  if (last <= first) return;

  const world = screenToWorld(e.clientX, e.clientY);
  let bestI = -1, bestD = SEGMENT_HIT_R;
  for (let i = first; i < last; i++) {
    const a = route[i], b = route[i + 1];
    const q = closestPointOnSegment(world, a, b);
    const d = Math.hypot(q.x - world.x, q.y - world.y);
    if (d < bestD) { bestD = d; bestI = i; }
  }
  if (bestI === -1) return;

  const a = route[bestI], b = route[bestI + 1];
  const isHoriz = Math.abs(a.y - b.y) < 0.5;
  const isVert  = Math.abs(a.x - b.x) < 0.5;
  if (!isHoriz && !isVert) return;

  e.stopPropagation();
  e.preventDefault();

  const wasFrozen = freezeRoute(p, conn);
  if (wasFrozen) {
    pushHistory(p, "freeze route");
    markDirty(p);
  }

  const wpA = bestI - first;
  const wpB = bestI - first + 1;
  if (wpA < 0 || wpB >= conn.waypoints.length) return;

  startSegmentDragByWaypoints(e, p, conn, wpA, wpB, isHoriz);
}, true);

/* ============================================================
 *  Запуск перетаскиваний
 * ============================================================ */

function startWaypointDrag(e, project, conn, wpIndex) {
  beginTransaction(project);
  segDrag = {
    kind: "waypoint",
    project, conn, wpIndex,
    start: screenToWorld(e.clientX, e.clientY),
    orig: conn.waypoints.map((w) => [...w]),
  };
  try { workspaceSvg.setPointerCapture(e.pointerId); } catch {}
}

function startSegmentDragByWaypoints(e, project, conn, wpA, wpB, isHoriz) {
  beginTransaction(project);
  segDrag = {
    kind: "segment",
    project, conn, wpA, wpB, isHoriz,
    start: screenToWorld(e.clientX, e.clientY),
    orig: conn.waypoints.map((w) => [...w]),
  };
  try { workspaceSvg.setPointerCapture(e.pointerId); } catch {}
}

function startEndDrag(e, project, conn, endIdx) {
  beginTransaction(project);
  endDrag = {
    project, conn, endIdx,
    originalEnd: structuredClone(conn.ends[endIdx]),
    moved: false,
    hoverEl: null,
  };
  try { workspaceSvg.setPointerCapture(e.pointerId); } catch {}
  setStatus("Отпустите на терминале, проводе или в пустоте.");
}

function endDragCleanup() {
  if (endDrag?.hoverEl) { endDrag.hoverEl.remove(); endDrag.hoverEl = null; }
  endDrag = null;
  setStatus("");
}

/* ============================================================
 *  pointermove
 * ============================================================ */

workspaceSvg.addEventListener("pointermove", (e) => {
  if (segDrag) {
    const { conn, kind, orig } = segDrag;
    const now = screenToWorld(e.clientX, e.clientY);
    const dx = now.x - segDrag.start.x;
    const dy = now.y - segDrag.start.y;

    if (kind === "waypoint") {
      const i = segDrag.wpIndex;
      conn.waypoints[i][0] = Math.round((orig[i][0] + dx) / GRID) * GRID;
      conn.waypoints[i][1] = Math.round((orig[i][1] + dy) / GRID) * GRID;
    } else {
      const { isHoriz, wpA, wpB } = segDrag;
      let dX = 0, dY = 0;
      if (isHoriz) dY = Math.round(dy / GRID) * GRID;
      else         dX = Math.round(dx / GRID) * GRID;

      conn.waypoints[wpA][0] = orig[wpA][0] + dX;
      conn.waypoints[wpA][1] = orig[wpA][1] + dY;
      conn.waypoints[wpB][0] = orig[wpB][0] + dX;
      conn.waypoints[wpB][1] = orig[wpB][1] + dY;
    }

    renderAllConnections();
    renderWaypointHandles();
    return;
  }

  if (endDrag) {
    const { project, conn, endIdx } = endDrag;
    const world = screenToWorld(e.clientX, e.clientY);
    const target = findExternalSnapTarget(world, project);

    const endPos = target
      ? { x: target.pos.x, y: target.pos.y }
      : {
          x: Math.round(world.x / GRID) * GRID,
          y: Math.round(world.y / GRID) * GRID,
        };

    conn.ends[endIdx] = { kind: "free", x: endPos.x, y: endPos.y };
    endDrag.moved = true;

    renderAllConnections();
    renderWaypointHandles();

    if (endDrag.hoverEl) { endDrag.hoverEl.remove(); endDrag.hoverEl = null; }
    if (target) {
      endDrag.hoverEl = el("circle", {
        cx: target.pos.x, cy: target.pos.y, r: 9,
        fill: "none", stroke: "#2b7cff", "stroke-width": 2,
        "pointer-events": "none",
      });
      layer("overlay").appendChild(endDrag.hoverEl);
    }
  }
});

/* ============================================================
 *  pointerup
 * ============================================================ */

workspaceSvg.addEventListener("pointerup", (e) => {
  if (segDrag) {
    const { project, kind } = segDrag;
    markDirty(project);
    commitTransaction(project, kind === "waypoint" ? "move waypoint" : "move segment");
    segDrag = null;
    emitSelectionChange();
    renderAllConnections();
    renderWaypointHandles();
    return;
  }

  if (endDrag) {
    const { project, conn, endIdx, originalEnd, moved } = endDrag;

    if (!moved) {
      conn.ends[endIdx] = originalEnd;
      endDragCleanup();
      rollbackTransaction(project);
      renderAllConnections();
      renderWaypointHandles();
      return;
    }

    const world = screenToWorld(e.clientX, e.clientY);
    const target = findExternalSnapTarget(world, project);

    if (target && target.kind === "terminal") {
      conn.ends[endIdx] = {
        kind: "terminal",
        component_id: target.component_id,
        terminal_id: target.terminal_id,
      };
    } else if (target && target.kind === "connection") {
      import("./operations.js").then((ops) => {
        ops.addNodeOnWire(project, target.connection_id, target.pos, {
          kind: "free", pos: { x: target.pos.x, y: target.pos.y },
        });
        endDragCleanup();
        emitSelectionChange();
        renderAllConnections();
        renderWaypointHandles();
      });
      return;
    } else {
      const snapped = {
        x: Math.round(world.x / GRID) * GRID,
        y: Math.round(world.y / GRID) * GRID,
      };
      conn.ends[endIdx] = { kind: "free", x: snapped.x, y: snapped.y };
    }

    endDragCleanup();
    markDirty(project);
    commitTransaction(project, "reattach");
    emitSelectionChange();
    renderAllConnections();
    renderWaypointHandles();
  }
});

/* ============================================================
 *  Поиск цели при перетаскивании конца
 * ============================================================ */

function findExternalSnapTarget(worldPos, project) {
  let best = null;
  let bestD = Infinity;

  const idx = buildTerminalIndex(project);
  for (const [key, pos] of idx) {
    const [compId, termId] = key.split("/");
    const d = Math.hypot(pos.x - worldPos.x, pos.y - worldPos.y);
    if (d < bestD && d < SNAP_RADIUS) {
      bestD = d;
      best = { kind: "terminal", component_id: compId, terminal_id: termId, pos };
    }
  }

  const cache = new Map();
  for (const conn of project.connections) {
    const route = computeRoute(project, conn, cache);
    const raw = nearestOnRouteWithT(route, worldPos);
    if (!raw) continue;
    if (raw.dist >= bestD || raw.dist >= SNAP_RADIUS) continue;

    const snapped = snapPointToRouteGrid(route, raw.pos);
    const refined = nearestOnRouteWithT(route, snapped) || raw;

    bestD = raw.dist;
    best = {
      kind: "connection",
      connection_id: conn.id,
      pos: snapped,
      anchor: refined.t,
    };
  }
  return best;
}

/* ============================================================
 *  Двойной клик — добавить waypoint
 * ============================================================ */

export function initRouteEditing() {
  layer("connections").addEventListener("dblclick", (e) => {
    const path = e.target.closest?.(".connection");
    if (!path) return;
    const p = getActive();
    if (!p) return;
    const conn = p.connections.find((w) => w.id === path.dataset.id);
    if (!conn) return;

    const route = computeRouteInContext(p, conn.id);
    if (route.length < 2) return;

    const ends = getEndsInfo(p, conn);
    const { first } = routeExtent(route, ends);

    const world = screenToWorld(e.clientX, e.clientY);
    const raw = nearestOnRouteWithT(route, world);
    if (!raw) return;
    const snapped = snapPointToRouteGrid(route, raw.pos);

    pushHistory(p, "add waypoint");
    freezeRoute(p, conn);

    let k = 0, bestD = Infinity;
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i], b = route[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let u = len2 ? ((snapped.x - a.x) * dx + (snapped.y - a.y) * dy) / len2 : 0;
      u = Math.max(0, Math.min(1, u));
      const qx = a.x + u * dx, qy = a.y + u * dy;
      const d = Math.hypot(qx - snapped.x, qy - snapped.y);
      if (d < bestD) { bestD = d; k = i; }
    }

    let insertAt = Math.max(0, k - first + 1);
    insertAt = Math.max(0, Math.min(insertAt, conn.waypoints.length));

    conn.waypoints.splice(insertAt, 0, [snapped.x, snapped.y]);
    markDirty(p);
    renderAllConnections();
    renderWaypointHandles();
  });
}