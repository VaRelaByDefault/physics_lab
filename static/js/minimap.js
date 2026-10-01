// static/js/minimap.js
import { getActive, specOf, on } from "./state.js";
import { workspaceSvg } from "./workspace.js";
import { computeRoute, buildTerminalIndex } from "./route.js";

const svg = document.getElementById("minimap-svg");
const NS = "http://www.w3.org/2000/svg";
const PADDING = 20;

function el(tag, attrs = {}) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) n.setAttribute(k, v);
  }
  return n;
}

export function renderMinimap() {
  svg.replaceChildren();
  const p = getActive();
  if (!p) return;

  // ---- 1. BBox всей схемы ----
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;

  for (const c of p.components) {
    const spec = specOf(c.type);
    if (!spec) continue;
    const corners = rotatedCorners(c, spec);
    for (const pt of corners) {
      x0 = Math.min(x0, pt.x);
      y0 = Math.min(y0, pt.y);
      x1 = Math.max(x1, pt.x);
      y1 = Math.max(y1, pt.y);
    }
  }

  // Точки маршрутов
  const routeCache = new Map();
  for (const conn of p.connections) {
    const route = computeRoute(p, conn, routeCache);
    for (const pt of route) {
      x0 = Math.min(x0, pt.x);
      y0 = Math.min(y0, pt.y);
      x1 = Math.max(x1, pt.x);
      y1 = Math.max(y1, pt.y);
    }
  }

  if (!isFinite(x0)) { x0 = 0; y0 = 0; x1 = 100; y1 = 100; }
  x0 -= PADDING; y0 -= PADDING; x1 += PADDING; y1 += PADDING;
  const vbW = Math.max(x1 - x0, 1);
  const vbH = Math.max(y1 - y0, 1);
  svg.setAttribute("viewBox", `${x0} ${y0} ${vbW} ${vbH}`);

  // ---- 2. Соединения ----
  const connLayer = el("g", { class: "mm-connections" });
  for (const conn of p.connections) {
    const route = computeRoute(p, conn, routeCache);
    if (route.length < 2) continue;
    const d = route
      .map((pt, i) => (i === 0 ? `M${pt.x},${pt.y}` : `L${pt.x},${pt.y}`))
      .join(" ");
    connLayer.appendChild(el("path", {
      class: "mm-connection",
      d,
      stroke: conn.color || "#222",
    }));
  }
  svg.appendChild(connLayer);

  // ---- 3. Компоненты ----
  const compLayer = el("g", { class: "mm-components" });
  for (const c of p.components) {
    const spec = specOf(c.type);
    if (!spec) continue;
    if (c.type === "junction") continue;
    const [w, h] = spec.size;
    const rect = el("rect", {
      class: "mm-component",
      x: c.position.x,
      y: c.position.y,
      width: w, height: h,
      rx: 2,
    });
    if (c.rotation) {
      rect.setAttribute(
        "transform",
        `rotate(${c.rotation} ${c.position.x + w / 2} ${c.position.y + h / 2})`
      );
    }
    compLayer.appendChild(rect);
  }
  svg.appendChild(compLayer);

  // ---- 4. Рамка вьюпорта ----
  const v = p.viewport;
  const rect = workspaceSvg.getBoundingClientRect();
  const wv = rect.width / v.zoom;
  const hv = rect.height / v.zoom;
  const xv = -v.x / v.zoom;
  const yv = -v.y / v.zoom;

  svg.appendChild(el("rect", {
    class: "mm-viewport",
    x: xv, y: yv, width: wv, height: hv,
  }));
}

/** Углы повёрнутого прямоугольника компонента. */
function rotatedCorners(c, spec) {
  const [w, h] = spec.size;
  const rad = (c.rotation || 0) * Math.PI / 180;
  const cx = w / 2, cy = h / 2;
  const pts = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  return pts.map((pt) => {
    const dx = pt.x - cx;
    const dy = pt.y - cy;
    return {
      x: c.position.x + cx + dx * Math.cos(rad) - dy * Math.sin(rad),
      y: c.position.y + cy + dx * Math.sin(rad) + dy * Math.cos(rad),
    };
  });
}

export function initMinimap() {
  on("dirty", renderMinimap);
  on("active", renderMinimap);
  window.__mmRender = renderMinimap;
}