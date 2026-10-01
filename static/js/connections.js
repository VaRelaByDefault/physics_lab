// static/js/connections.js
import { getActive, markDirty, specOf, uid, uiState } from "./state.js";
import { layer, screenToWorld, setStatus, workspaceSvg } from "./workspace.js";
import { el, closestPointOnSegment } from "./svg_utils.js";
import {
  computeRoute, nearestOnRouteWithT, buildTerminalIndex,
  snapPointToRouteGrid,
} from "./route.js";
import { findNearestTerminal } from "./snapping.js";
import { isConnectionSelected, selectConnection, toggleConnection } from "./selection.js";
import { pickJunctionTerminal } from "./nodes.js";

const GRID = 10;
const HIT_STROKE = 8;

export { buildTerminalIndex };

/* ============================================================
 *  Отрисовка
 * ============================================================ */

export function renderAllConnections() {
  const host = layer("connections");
  host.replaceChildren();
  const p = getActive();
  if (!p) return;
  const cache = new Map();
  for (const w of p.connections) {
    const route = computeRoute(p, w, cache);
    host.appendChild(renderConnection(w, route));
  }
  renderFreeEnds(p);

  import("./connections_edit.js").then((m) => m.renderWaypointHandles());
}

function renderConnection(conn, route) {
  const d = route.length
    ? route.map((pt, i) => (i === 0 ? `M${pt.x},${pt.y}` : `L${pt.x},${pt.y}`)).join(" ")
    : "";

  const wrap = el("g", {
    class: "connection-wrap" + (isConnectionSelected(conn.id) ? " selected" : ""),
    "data-id": conn.id,
  });

  // Невидимая широкая полоса для захвата мышью
  const hit = el("path", {
    class: "connection",
    "data-id": conn.id,
    d,
    fill: "none",
    stroke: "transparent",
    "stroke-width": HIT_STROKE,
    "pointer-events": "stroke",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });
  hit.addEventListener("pointerdown", (e) => {
    if (uiState.connectionActive) return;
    e.stopPropagation();
    if (e.shiftKey) toggleConnection(conn.id);
    else selectConnection(conn.id);
  });

  // Видимая тонкая линия
  const line = el("path", {
    class: "connection-line",
    "data-id": conn.id,
    d,
    stroke: conn.color || "#222",
    "pointer-events": "none",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });

  wrap.appendChild(hit);
  wrap.appendChild(line);
  return wrap;
}

export function rerouteConnectionsOfComponent(project, component) {
  const host = layer("connections");
  const affected = new Set();
  for (const conn of project.connections) {
    if (conn.ends.some((e) => e.kind === "terminal" && e.component_id === component.id)) {
      affected.add(conn.id);
    }
  }
  const cache = new Map();
  for (const conn of project.connections) {
    if (!affected.has(conn.id)) continue;
    const route = computeRoute(project, conn, cache);
    const old = host.querySelector(`g.connection-wrap[data-id="${conn.id}"]`);
    if (old) old.replaceWith(renderConnection(conn, route));
  }
  renderFreeEnds(project);
}

export function updateConnectionSelectionVisual() {
  for (const p of layer("connections").querySelectorAll(".connection-wrap")) {
    p.classList.toggle("selected", isConnectionSelected(p.dataset.id));
  }
}

function renderFreeEnds(project) {
  const host = layer("connections");
  host.querySelectorAll(".free-end").forEach((n) => n.remove());
  for (const conn of project.connections) {
    for (const end of conn.ends) {
      if (end.kind !== "free") continue;
      if (typeof end.x !== "number" || typeof end.y !== "number") continue;
      host.appendChild(el("circle", { class: "free-end", cx: end.x, cy: end.y, r: 3.5 }));
    }
  }
}

/* ============================================================
 *  Создание соединения
 * ============================================================ */

const session = { from: null, preview: null, hoverEl: null };

export function handleTerminalClick(componentId, terminalId) {
  const p = getActive();
  if (!p) return;
  const comp = p.components.find((c) => c.id === componentId);
  if (!comp) return;
  const spec = specOf(comp.type);
  const termSpec = spec.terminals.find((t) => t.id === terminalId);
  if (!termSpec) return;
  const pos = { x: comp.position.x + termSpec.x, y: comp.position.y + termSpec.y };

  const point = { kind: "terminal", component_id: componentId, terminal_id: terminalId, pos };
  if (!uiState.connectionActive) startConnection(point);
  else finishConnection(point);
}

export function handleJunctionClick(componentId) {
  const p = getActive();
  if (!p) return;
  const comp = p.components.find((c) => c.id === componentId);
  if (!comp || comp.type !== "junction") return;
  const spec = specOf(comp.type);
  const pos = {
    x: comp.position.x + spec.size[0] / 2,
    y: comp.position.y + spec.size[1] / 2,
  };
  const point = { kind: "junction", component_id: componentId, pos };
  if (!uiState.connectionActive) startConnection(point);
  else finishConnection(point);
}

function startConnection(point) {
  session.from = point;
  uiState.connectionActive = true;
  setStatus("Кликните по второму терминалу, проводу или пустому месту. Esc — отмена.");
  session.preview = el("path", {
    class: "connection preview", d: "",
    fill: "none", stroke: "#2b7cff",
    "stroke-width": 2, "stroke-dasharray": "5 4",
    "pointer-events": "none",
  });
  layer("overlay").appendChild(session.preview);
}

function cancelConnection() {
  if (!uiState.connectionActive) return;
  uiState.connectionActive = false;
  session.from = null;
  if (session.preview) session.preview.remove();
  if (session.hoverEl) session.hoverEl.remove();
  session.preview = null;
  session.hoverEl = null;
  setStatus("");
}

function finishConnection(point) {
  const p = getActive();
  if (!p || !session.from) return;
  if (samePoint(session.from, point)) {
    cancelConnection();
    return;
  }

  if (point.kind === "connection") {
    import("./operations.js").then((ops) => {
      ops.addNodeOnWire(p, point.connection_id, point.pos, session.from);
      cancelConnection();
    });
    return;
  }

  const reserved = new Set();
  const fromEnd = resolveEnd(p, session.from, point.pos, reserved);
  const toEnd   = resolveEnd(p, point, session.from.pos, reserved);

  if (!fromEnd || !toEnd) {
    setStatus("У узла нет свободных портов (максимум 4).");
    setTimeout(() => setStatus(""), 2500);
    cancelConnection();
    return;
  }

  p.connections.push({
    id: uid("w"),
    ends: [fromEnd, toEnd],
    waypoints: [],
    color: "#222",
  });
  markDirty(p);
  cancelConnection();
  renderAllConnections();
}

function resolveEnd(project, point, otherPos, reserved) {
  if (point.kind === "junction") {
    const term = pickJunctionTerminal(project, point.component_id, otherPos, reserved);
    if (!term) return null;
    reserved.add(`${point.component_id}/${term}`);
    return { kind: "terminal", component_id: point.component_id, terminal_id: term };
  }
  if (point.kind === "terminal") {
    return { kind: "terminal", component_id: point.component_id, terminal_id: point.terminal_id };
  }
  if (point.kind === "free") {
    return { kind: "free", x: point.pos.x, y: point.pos.y };
  }
  return null;
}

function samePoint(a, b) {
  if (a.kind === "junction" && b.kind === "junction") {
    return a.component_id === b.component_id;
  }
  if (a.kind !== b.kind) return false;
  if (a.kind === "terminal") {
    return a.component_id === b.component_id && a.terminal_id === b.terminal_id;
  }
  if (a.kind === "free") {
    return Math.abs(a.pos.x - b.pos.x) < 0.5 && Math.abs(a.pos.y - b.pos.y) < 0.5;
  }
  return false;
}

function findSnapTarget(worldPos, project, radius = 15) {
  let best = null, bestD = Infinity;

  const t = findNearestTerminal(worldPos, project, radius);
  if (t) {
    bestD = Math.hypot(t.pos.x - worldPos.x, t.pos.y - worldPos.y);
    const comp = project.components.find((c) => c.id === t.component_id);
    if (comp && comp.type === "junction") {
      const spec = specOf(comp.type);
      best = {
        kind: "junction",
        component_id: comp.id,
        pos: {
          x: comp.position.x + spec.size[0] / 2,
          y: comp.position.y + spec.size[1] / 2,
        },
      };
    } else {
      best = t;
    }
  }

  const cache = new Map();
  for (const conn of project.connections) {
    const route = computeRoute(project, conn, cache);
    const raw = nearestOnRouteWithT(route, worldPos);
    if (!raw) continue;
    if (raw.dist >= bestD || raw.dist >= radius) continue;

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

workspaceSvg.addEventListener("pointerdown", (e) => {
  if (!uiState.connectionActive) return;
  const p = getActive();
  if (!p) return;

  const connEl = e.target.closest?.(".connection");
  if (connEl) {
    e.stopPropagation();
    const parent = p.connections.find((w) => w.id === connEl.dataset.id);
    if (!parent) return;
    const route = computeRoute(p, parent);
    const world = screenToWorld(e.clientX, e.clientY);
    const raw = nearestOnRouteWithT(route, world);
    if (!raw) return;
    const snapped = snapPointToRouteGrid(route, raw.pos);
    const refined = nearestOnRouteWithT(route, snapped) || raw;
    finishConnection({
      kind: "connection",
      connection_id: parent.id,
      pos: snapped,
      anchor: refined.t,
    });
    return;
  }

  const world = screenToWorld(e.clientX, e.clientY);
  const target = findSnapTarget(world, p);
  if (target) {
    finishConnection(target);
  } else {
    finishConnection({
      kind: "free",
      pos: { x: Math.round(world.x / GRID) * GRID, y: Math.round(world.y / GRID) * GRID },
    });
  }
});

workspaceSvg.addEventListener("pointermove", (e) => {
  if (!uiState.connectionActive || !session.from) return;
  const p = getActive();
  if (!p) return;
  const world = screenToWorld(e.clientX, e.clientY);
  const target = findSnapTarget(world, p);

  const endPos = target?.pos ?? {
    x: Math.round(world.x / GRID) * GRID,
    y: Math.round(world.y / GRID) * GRID,
  };

  const a = session.from.pos;
  const pts = buildPreviewRoute(a, endPos);
  const d = pts.map((pt, i) => (i === 0 ? `M${pt.x},${pt.y}` : `L${pt.x},${pt.y}`)).join(" ");
  session.preview.setAttribute("d", d);

  if (session.hoverEl) { session.hoverEl.remove(); session.hoverEl = null; }
  if (target) {
    session.hoverEl = el("circle", {
      cx: target.pos.x, cy: target.pos.y,
      r: target.kind === "terminal" ? 9 : 6,
      fill: "none", stroke: "#2b7cff", "stroke-width": 2,
      "pointer-events": "none",
    });
    layer("overlay").appendChild(session.hoverEl);
  }
});

function buildPreviewRoute(a, b) {
  if (Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1) return [a, b];
  return [a, { x: b.x, y: a.y }, b];
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && uiState.connectionActive) cancelConnection();
});

export { cancelConnection };