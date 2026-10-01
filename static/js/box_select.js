// static/js/box_select.js
import { uiState, getActive, specOf } from "./state.js";
import { layer, screenToWorld, workspaceSvg } from "./workspace.js";
import {
  setSelection, getSelectedComponents, getSelectedConnections, clearSelection,
} from "./selection.js";
import { el } from "./svg_utils.js";
import { computeRoute } from "./route.js";

let box = null;

export function initBoxSelect() {
  workspaceSvg.addEventListener("pointerdown", (e) => {
    if (uiState.connectionActive) return;
    if (e.button !== 0) return;
    const t = e.target;
    // Не начинать рамку на интерактивных объектах
    if (t.closest?.(".component")) return;
    if (t.closest?.(".connection")) return;
    if (t.classList?.contains("terminal")) return;
    if (t.classList?.contains("end-handle")) return;
    if (t.classList?.contains("seg-hit")) return;
    if (t.classList?.contains("wp-dot")) return;

    const start = screenToWorld(e.clientX, e.clientY);
    box = {
      start, current: start,
      additive: e.shiftKey,
      rectEl: el("rect", {
        fill: "#2b7cff22", stroke: "#2b7cff",
        "stroke-dasharray": "4 3", "pointer-events": "none",
      }),
    };
    layer("overlay").appendChild(box.rectEl);
    workspaceSvg.setPointerCapture(e.pointerId);
    if (!box.additive) clearSelection();
  });

  workspaceSvg.addEventListener("pointermove", (e) => {
    if (!box) return;
    box.current = screenToWorld(e.clientX, e.clientY);
    const x = Math.min(box.start.x, box.current.x);
    const y = Math.min(box.start.y, box.current.y);
    const w = Math.abs(box.current.x - box.start.x);
    const h = Math.abs(box.current.y - box.start.y);
    box.rectEl.setAttribute("x", x);
    box.rectEl.setAttribute("y", y);
    box.rectEl.setAttribute("width", w);
    box.rectEl.setAttribute("height", h);
  });

  workspaceSvg.addEventListener("pointerup", (e) => {
    if (!box) return;
    try { workspaceSvg.releasePointerCapture(e.pointerId); } catch {}
    const x1 = Math.min(box.start.x, box.current.x);
    const y1 = Math.min(box.start.y, box.current.y);
    const x2 = Math.max(box.start.x, box.current.x);
    const y2 = Math.max(box.start.y, box.current.y);
    box.rectEl.remove();
    const dragged = (x2 - x1) > 4 || (y2 - y1) > 4;
    if (dragged) selectInRect(x1, y1, x2, y2, box.additive);
    box = null;
  });
}

function selectInRect(x1, y1, x2, y2, additive) {
  const p = getActive();
  if (!p) return;
  const comps = additive ? new Set(getSelectedComponents()) : new Set();
  const conns = additive ? new Set(getSelectedConnections()) : new Set();

  for (const c of p.components) {
    const spec = specOf(c.type);
    if (!spec) continue;
    const [w, h] = spec.size;
    const cx = c.position.x, cy = c.position.y;
    if (cx + w >= x1 && cx <= x2 && cy + h >= y1 && cy <= y2) comps.add(c.id);
  }

  const cache = new Map();
  for (const w of p.connections) {
    const route = computeRoute(p, w, cache);
    if (route.some((pt) => pt.x >= x1 && pt.x <= x2 && pt.y >= y1 && pt.y <= y2)) {
      conns.add(w.id);
    }
  }
  setSelection(comps, conns, true);
}