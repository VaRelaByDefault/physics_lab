import { getActive, markDirty, uiState } from "./state.js";

const svg = document.getElementById("workspace");
const viewport = document.getElementById("viewport");
const layers = {
  connections: document.getElementById("connections-layer"),
  components:  document.getElementById("components-layer"),
  overlay:     document.getElementById("overlay-layer"),
};

const statusBar = document.getElementById("status-bar");

let panning = null;

export function applyViewport() {
  const p = getActive();
  if (!p) {
    viewport.setAttribute("transform", "translate(0,0) scale(1)");
    return;
  }
  const v = p.viewport;
  viewport.setAttribute("transform",
    `translate(${v.x},${v.y}) scale(${v.zoom})`);
}

export function screenToWorld(clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  const p = getActive();
  const v = p ? p.viewport : { x: 0, y: 0, zoom: 1 };
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;
  return { x: (sx - v.x) / v.zoom, y: (sy - v.y) / v.zoom };
}

export function setStatus(text) {
  statusBar.textContent = text || "";
}

svg.addEventListener("wheel", (e) => {
  const p = getActive();
  if (!p) return;
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const rect = svg.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const v = p.viewport;
  const newZoom = Math.min(4, Math.max(0.25, v.zoom * factor));
  const wx = (sx - v.x) / v.zoom;
  const wy = (sy - v.y) / v.zoom;
  v.zoom = newZoom;
  v.x = sx - wx * newZoom;
  v.y = sy - wy * newZoom;
  applyViewport();
  window.__mmRender?.();
}, { passive: false });

svg.addEventListener("pointerdown", (e) => {
  if (uiState.connectionActive) return;
  const isPan = e.button === 1 || (e.button === 0 && e.getModifierState("Space"));
  if (!isPan) return;
  e.preventDefault();
  const p = getActive();
  if (!p) return;
  panning = {
    startX: e.clientX, startY: e.clientY,
    origX: p.viewport.x, origY: p.viewport.y,
  };
  svg.setPointerCapture(e.pointerId);
});

svg.addEventListener("pointermove", (e) => {
  if (!panning) return;
  const p = getActive();
  if (!p) return;
  p.viewport.x = panning.origX + (e.clientX - panning.startX);
  p.viewport.y = panning.origY + (e.clientY - panning.startY);
  applyViewport();
  markDirty(p);
  window.__mmRender?.();
});

svg.addEventListener("pointerup", (e) => {
  if (panning) {
    panning = null;
    try { svg.releasePointerCapture(e.pointerId); } catch {}
  }
});

export const layer = (name) => layers[name];
export const workspaceSvg = svg;