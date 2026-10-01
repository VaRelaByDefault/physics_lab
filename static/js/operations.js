// static/js/operations.js
import { markDirty, uid, specOf } from "./state.js";
import { pushHistory } from "./history.js";
import {
  clearSelection, getSelectedComponents, getSelectedConnections,
  emitSelectionChange,
} from "./selection.js";
import { terminalWorldPos, terminalSide, stubPoint } from "./svg_utils.js";
import { renderAllComponents } from "./component.js";
import { renderAllConnections } from "./connections.js";
import {
  computeRoute, nearestOnRouteWithT, pointOnRoute, snapPointToRouteGrid,
} from "./route.js";
import { pickJunctionTerminal } from "./nodes.js";

const GRID = 10;

/* ============================================================
 *  Общие операции
 * ============================================================ */

export function cleanupConnections(project) {
  let changed = true;
  while (changed) {
    changed = false;
    const compIds = new Set(project.components.map((c) => c.id));
    const connIds = new Set(project.connections.map((w) => w.id));
    const before = project.connections.length;
    project.connections = project.connections.filter((w) => {
      if (!Array.isArray(w.ends) || w.ends.length !== 2) return false;
      return w.ends.every((e) => {
        if (e.kind === "terminal")   return compIds.has(e.component_id);
        if (e.kind === "connection") return connIds.has(e.connection_id) && e.connection_id !== w.id;
        if (e.kind === "free")       return typeof e.x === "number" && typeof e.y === "number";
        return false;
      });
    });
    if (project.connections.length !== before) changed = true;
  }
}

export function fillMissingAnchors(project) {
  const cache = new Map();
  let changed = false;
  for (const conn of project.connections) {
    for (const end of conn.ends) {
      if (end.kind !== "connection") continue;
      if (Array.isArray(end.anchor_xy) && end.anchor_xy.length === 2) continue;
      const parent = project.connections.find((w) => w.id === end.connection_id);
      if (!parent) continue;
      const parentRoute = computeRoute(project, parent, cache);
      if (!parentRoute.length) continue;
      const t = typeof end.anchor === "number" ? end.anchor : 0.5;
      const pos = pointOnRoute(parentRoute, t);
      if (!pos) continue;
      end.anchor_xy = [pos.x, pos.y];
      changed = true;
    }
  }
  return changed;
}

export function cleanupStubWaypoints(project) {
  let changed = false;
  for (const conn of project.connections) {
    if (!Array.isArray(conn.waypoints) || conn.waypoints.length === 0) continue;
    const e0 = conn.ends[0];
    if (e0.kind === "terminal") {
      const comp = project.components.find((c) => c.id === e0.component_id);
      if (comp) {
        const spec = specOf(comp.type);
        const termSpec = spec?.terminals.find((t) => t.id === e0.terminal_id);
        if (termSpec) {
          const pos = terminalWorldPos(comp, termSpec);
          const side = terminalSide(comp, termSpec, spec);
          const stub = stubPoint(pos, side);
          const wp = conn.waypoints[0];
          if (Math.abs(wp[0] - stub.x) < 1 && Math.abs(wp[1] - stub.y) < 1) {
            conn.waypoints.shift();
            changed = true;
          }
        }
      }
    }
    const e1 = conn.ends[1];
    if (e1.kind === "terminal" && conn.waypoints.length > 0) {
      const comp = project.components.find((c) => c.id === e1.component_id);
      if (comp) {
        const spec = specOf(comp.type);
        const termSpec = spec?.terminals.find((t) => t.id === e1.terminal_id);
        if (termSpec) {
          const pos = terminalWorldPos(comp, termSpec);
          const side = terminalSide(comp, termSpec, spec);
          const stub = stubPoint(pos, side);
          const wp = conn.waypoints[conn.waypoints.length - 1];
          if (Math.abs(wp[0] - stub.x) < 1 && Math.abs(wp[1] - stub.y) < 1) {
            conn.waypoints.pop();
            changed = true;
          }
        }
      }
    }
  }
  return changed;
}

export function detachEndsFromComponent(project, componentId) {
  const comp = project.components.find((c) => c.id === componentId);
  if (!comp) return;
  const spec = specOf(comp.type);
  if (!spec) return;

  const termPos = new Map();
  for (const t of spec.terminals) {
    termPos.set(t.id, terminalWorldPos(comp, t));
  }

  for (const conn of project.connections) {
    for (let i = 0; i < conn.ends.length; i++) {
      const end = conn.ends[i];
      if (end.kind !== "terminal") continue;
      if (end.component_id !== componentId) continue;
      const p = termPos.get(end.terminal_id);
      if (!p) continue;
      conn.ends[i] = { kind: "free", x: p.x, y: p.y };
    }
  }
}

export function deleteComponent(project, id) {
  const comp = project.components.find((c) => c.id === id);
  if (!comp) return;

  pushHistory(project, "delete component");

  if (comp.type === "junction") {
    project.connections = project.connections.filter((w) =>
      !w.ends.some((e) => e.kind === "terminal" && e.component_id === id)
    );
  } else {
    detachEndsFromComponent(project, id);
  }

  project.components = project.components.filter((c) => c.id !== id);
  cleanupConnections(project);
  markDirty(project); clearSelection();
  renderAllComponents(); renderAllConnections();
}

export function deleteConnection(project, id) {
  pushHistory(project, "delete connection");
  project.connections = project.connections.filter((w) => w.id !== id);
  cleanupConnections(project);
  markDirty(project); clearSelection();
  renderAllConnections();
}

export function deleteSelection(project) {
  const compIds = getSelectedComponents();
  const connIds = getSelectedConnections();
  if (!compIds.size && !connIds.size) return;
  pushHistory(project, "delete selection");

  const junctionIds = new Set();
  for (const id of compIds) {
    const c = project.components.find((x) => x.id === id);
    if (c && c.type === "junction") junctionIds.add(id);
    else detachEndsFromComponent(project, id);
  }

  project.components = project.components.filter((c) => !compIds.has(c.id));
  project.connections = project.connections.filter((w) => {
    if (connIds.has(w.id)) return false;
    if (w.ends.some((e) => e.kind === "terminal" && junctionIds.has(e.component_id))) return false;
    return true;
  });

  cleanupConnections(project);
  markDirty(project); clearSelection();
  renderAllComponents(); renderAllConnections();
}

export function rotateComponent(project, id, delta = 90) {
  const comp = project.components.find((c) => c.id === id);
  if (!comp) return;
  pushHistory(project, "rotate");
  comp.rotation = ((comp.rotation || 0) + delta) % 360;
  if (comp.rotation < 0) comp.rotation += 360;
  markDirty(project);
  renderAllComponents(); renderAllConnections();
}

export function rotateSelection(project, delta = 90) {
  const ids = getSelectedComponents();
  if (!ids.size) return;
  pushHistory(project, "rotate selection");
  for (const id of ids) {
    const c = project.components.find((x) => x.id === id);
    if (!c) continue;
    c.rotation = ((c.rotation || 0) + delta) % 360;
    if (c.rotation < 0) c.rotation += 360;
  }
  markDirty(project);
  renderAllComponents(); renderAllConnections();
}

export function alignSelectionToGrid(project) {
  const ids = getSelectedComponents();
  if (!ids.size) return;
  let changed = false;
  for (const id of ids) {
    const c = project.components.find((x) => x.id === id);
    if (!c) continue;
    const sx = Math.round(c.position.x / GRID) * GRID;
    const sy = Math.round(c.position.y / GRID) * GRID;
    if (sx !== c.position.x || sy !== c.position.y) { changed = true; break; }
  }
  if (!changed) return;
  pushHistory(project, "align to grid");
  for (const id of ids) {
    const c = project.components.find((x) => x.id === id);
    if (!c) continue;
    c.position.x = Math.round(c.position.x / GRID) * GRID;
    c.position.y = Math.round(c.position.y / GRID) * GRID;
  }
  markDirty(project);
  renderAllComponents();
  renderAllConnections();
  emitSelectionChange();
}

export function swapPolarity(project, id) {
  const c = project.components.find((x) => x.id === id);
  if (!c) return;
  const spec = specOf(c.type);
  if (!spec) return;
  if (!Array.isArray(spec.polarity_pairs) || !spec.polarity_pairs.length) return;
  pushHistory(project, "swap polarity");
  c.state.polarity_swapped = !c.state.polarity_swapped;
  markDirty(project);
  renderAllComponents();
  renderAllConnections();
}

export function swapPolaritySelection(project) {
  const ids = getSelectedComponents();
  if (!ids.size) return;
  let any = false;
  for (const id of ids) {
    const c = project.components.find((x) => x.id === id);
    if (!c) continue;
    const spec = specOf(c.type);
    if (!spec) continue;
    if (!Array.isArray(spec.polarity_pairs) || !spec.polarity_pairs.length) continue;
    any = true;
    break;
  }
  if (!any) return;
  pushHistory(project, "swap polarity selection");
  for (const id of ids) {
    const c = project.components.find((x) => x.id === id);
    if (!c) continue;
    const spec = specOf(c.type);
    if (!spec) continue;
    if (!Array.isArray(spec.polarity_pairs) || !spec.polarity_pairs.length) continue;
    c.state.polarity_swapped = !c.state.polarity_swapped;
  }
  markDirty(project);
  renderAllComponents();
  renderAllConnections();
  emitSelectionChange();
}

export function removeWaypoint(project, connId, index) {
  const conn = project.connections.find((w) => w.id === connId);
  if (!conn) return;
  if (!Array.isArray(conn.waypoints) || !conn.waypoints.length) return;
  if (index < 0 || index >= conn.waypoints.length) return;
  pushHistory(project, "remove waypoint");
  conn.waypoints.splice(index, 1);
  markDirty(project);
  renderAllConnections();
}

export function simplifyConnectionRoute(project, connId) {
  const conn = project.connections.find((w) => w.id === connId);
  if (!conn) return;
  if (!Array.isArray(conn.waypoints) || !conn.waypoints.length) return;
  pushHistory(project, "simplify route");
  conn.waypoints = [];
  markDirty(project);
  renderAllConnections();
}

/* ============================================================
 *  Создание узла на проводе
 * ============================================================ */

export function addNodeOnWire(project, parentId, worldPos, newEnd) {
  const parent = project.connections.find((w) => w.id === parentId);
  if (!parent) return null;

  const route = computeRoute(project, parent);
  if (route.length < 2) return null;

  const nodePos = snapPointToRouteGrid(route, worldPos);

  pushHistory(project, "add node");

  const nodeId = uid("j");
  project.components.push({
    id: nodeId,
    type: "junction",
    position: { x: nodePos.x - 5, y: nodePos.y - 5 },
    rotation: 0,
    properties: {},
    state: {},
  });

  const reserved = new Set();

  const termA = pickJunctionTerminal(project, nodeId, route[0], reserved);
  if (!termA) return null;
  reserved.add(`${nodeId}/${termA}`);

  const termB = pickJunctionTerminal(project, nodeId, route[route.length - 1], reserved);
  if (!termB) return null;
  reserved.add(`${nodeId}/${termB}`);

  const newEndPos = newEnd.kind === "terminal"
    ? (() => {
        const c = project.components.find((x) => x.id === newEnd.component_id);
        if (!c) return nodePos;
        const s = specOf(c.type);
        const t = s?.terminals.find((x) => x.id === newEnd.terminal_id);
        if (!t) return nodePos;
        return { x: c.position.x + t.x, y: c.position.y + t.y };
      })()
    : newEnd.pos;
  const termC = pickJunctionTerminal(project, nodeId, newEndPos, reserved);
  if (!termC) return null;

  const parentEnd0 = structuredClone(parent.ends[0]);
  const parentEnd1 = structuredClone(parent.ends[1]);
  const color = parent.color || "#222";

  const half1 = {
    id: uid("w"),
    ends: [parentEnd0, { kind: "terminal", component_id: nodeId, terminal_id: termA }],
    waypoints: [],
    color,
  };
  const half2 = {
    id: uid("w"),
    ends: [{ kind: "terminal", component_id: nodeId, terminal_id: termB }, parentEnd1],
    waypoints: [],
    color,
  };

  const idx = project.connections.findIndex((w) => w.id === parentId);
  project.connections.splice(idx, 1, half1, half2);

  let fromEnd;
  if (newEnd.kind === "terminal") {
    fromEnd = { kind: "terminal", component_id: newEnd.component_id, terminal_id: newEnd.terminal_id };
  } else if (newEnd.kind === "free") {
    fromEnd = { kind: "free", x: newEnd.pos.x, y: newEnd.pos.y };
  }

  if (fromEnd) {
    project.connections.push({
      id: uid("w"),
      ends: [fromEnd, { kind: "terminal", component_id: nodeId, terminal_id: termC }],
      waypoints: [],
      color: "#222",
    });
  }

  markDirty(project);
  clearSelection();
  renderAllComponents();
  renderAllConnections();
  return nodeId;
}

/* ============================================================
 *  Разделение соединения (по точке на маршруте)
 * ============================================================ */

export function splitConnectionAt(project, connId, worldPos) {
  const conn = project.connections.find((w) => w.id === connId);
  if (!conn) return null;

  const route = computeRoute(project, conn);
  if (route.length < 2) return null;

  const splitPos = snapPointToRouteGrid(route, worldPos);

  const MIN_END_DIST = 15;
  const dStart = Math.hypot(splitPos.x - route[0].x, splitPos.y - route[0].y);
  const dEnd = Math.hypot(
    splitPos.x - route[route.length - 1].x,
    splitPos.y - route[route.length - 1].y
  );
  if (dStart < MIN_END_DIST || dEnd < MIN_END_DIST) return null;

  pushHistory(project, "split connection");

  const jid = uid("j");
  project.components.push({
    id: jid,
    type: "junction",
    position: { x: splitPos.x - 5, y: splitPos.y - 5 },
    rotation: 0,
    properties: {},
    state: {},
  });

  const reserved = new Set();
  const termA = pickJunctionTerminal(project, jid, route[0], reserved);
  if (!termA) return null;
  reserved.add(`${jid}/${termA}`);
  const termB = pickJunctionTerminal(project, jid, route[route.length - 1], reserved);
  if (!termB) return null;

  const end0 = structuredClone(conn.ends[0]);
  const end1 = structuredClone(conn.ends[1]);
  const color = conn.color || "#222";

  const connA = {
    id: uid("w"),
    ends: [end0, { kind: "terminal", component_id: jid, terminal_id: termA }],
    waypoints: [],
    color,
  };
  const connB = {
    id: uid("w"),
    ends: [{ kind: "terminal", component_id: jid, terminal_id: termB }, end1],
    waypoints: [],
    color,
  };

  const idx = project.connections.findIndex((w) => w.id === connId);
  project.connections.splice(idx, 1, connA, connB);

  markDirty(project);
  clearSelection();
  renderAllComponents();
  renderAllConnections();
  return jid;
}

/* ============================================================
 *  Разделение соединения в заданном waypoint
 * ============================================================ */

export function splitConnectionAtWaypoint(project, connId, wpIndex) {
  const conn = project.connections.find((w) => w.id === connId);
  if (!conn) return null;
  if (!Array.isArray(conn.waypoints)) return null;
  if (wpIndex < 0 || wpIndex >= conn.waypoints.length) return null;

  const wp = conn.waypoints[wpIndex];
  const sx = Math.round(wp[0] / GRID) * GRID;
  const sy = Math.round(wp[1] / GRID) * GRID;

  pushHistory(project, "split at corner");

  const jid = uid("j");
  project.components.push({
    id: jid,
    type: "junction",
    position: { x: sx - 5, y: sy - 5 },
    rotation: 0,
    properties: {},
    state: {},
  });

  const reserved = new Set();

  // Направление к предыдущей точке waypoint-ов (или к начальному терминалу)
  const prevPt = wpIndex > 0
    ? { x: conn.waypoints[wpIndex - 1][0], y: conn.waypoints[wpIndex - 1][1] }
    : null;

  // Направление к следующей точке waypoint-ов (или к конечному терминалу)
  const nextPt = wpIndex < conn.waypoints.length - 1
    ? { x: conn.waypoints[wpIndex + 1][0], y: conn.waypoints[wpIndex + 1][1] }
    : null;

  const termA = prevPt
    ? pickJunctionTerminal(project, jid, prevPt, reserved)
    : pickJunctionTerminal(project, jid, { x: sx, y: sy + GRID }, reserved);
  if (!termA) return null;
  reserved.add(`${jid}/${termA}`);

  const termB = nextPt
    ? pickJunctionTerminal(project, jid, nextPt, reserved)
    : pickJunctionTerminal(project, jid, { x: sx, y: sy + GRID }, reserved);
  if (!termB) return null;

  const end0 = structuredClone(conn.ends[0]);
  const end1 = structuredClone(conn.ends[1]);
  const color = conn.color || "#222";

  const wpsA = conn.waypoints.slice(0, wpIndex);
  const wpsB = conn.waypoints.slice(wpIndex + 1);

  const connA = {
    id: uid("w"),
    ends: [end0, { kind: "terminal", component_id: jid, terminal_id: termA }],
    waypoints: wpsA,
    color,
  };
  const connB = {
    id: uid("w"),
    ends: [{ kind: "terminal", component_id: jid, terminal_id: termB }, end1],
    waypoints: wpsB,
    color,
  };

  const idx = project.connections.findIndex((w) => w.id === connId);
  project.connections.splice(idx, 1, connA, connB);

  markDirty(project);
  clearSelection();
  renderAllComponents();
  renderAllConnections();
  return jid;
}