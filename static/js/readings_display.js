// static/js/readings_display.js
import { uiState, getActive, specOf } from "./state.js";
import { layer } from "./workspace.js";
import { el } from "./svg_utils.js";

export function renderReadings() {
  // Обновляем визуальное состояние ламп (класс .lit)
  updateLampStates();

  const overlay = layer("overlay");
  overlay.querySelectorAll(".reading").forEach((n) => n.remove());

  const p = getActive();
  if (!p || !uiState.readings) {
    renderWarnings();
    return;
  }

  for (const c of p.components) {
    const r = uiState.readings[c.id];
    if (!r) continue;
    const hasValue = r.value !== null && r.value !== undefined;
    if (!hasValue && !r.overload) continue;

    const spec = specOf(c.type);
    if (!spec || spec.kind !== "instrument") continue;

    const [w, h] = spec.size;
    const rot = c.rotation || 0;

    const padX = 4;
    const padY = 4;
    const boxH = 14;
    const boxW = Math.max(Math.min(w, h) - 2 * padX, 20);
    const offsetY = h / 2 - boxH / 2 - padY;

    const g = el("g", {
      class: "reading",
      "data-for": c.id,
      transform:
        `translate(${c.position.x},${c.position.y}) ` +
        `rotate(${rot} ${w / 2} ${h / 2})`,
      "pointer-events": "none",
    });

    const inner = el("g", {
      transform:
        `translate(${w / 2},${h / 2}) ` +
        `rotate(${-rot}) ` +
        `translate(0,${offsetY})`,
    });

    inner.appendChild(el("rect", {
      class: "reading-bg" + (r.overload ? " reading-overload" : ""),
      x: -boxW / 2, y: -boxH / 2,
      width: boxW, height: boxH,
      rx: 3, ry: 3,
    }));

    const txt = el("text", {
      class: "reading-value" + (r.overload ? " reading-overload-text" : ""),
      x: 0, y: 0,
      "text-anchor": "middle",
      "dominant-baseline": "central",
    });
    txt.textContent = r.overload
      ? `∞ ${r.unit}`
      : `${fmt(r.value)} ${r.unit}`;
    inner.appendChild(txt);

    g.appendChild(inner);
    overlay.appendChild(g);
  }

  renderWarnings();
}

/** Пробегаем по всем лампам на схеме и ставим/снимаем класс .lit. */
function updateLampStates() {
  const p = getActive();
  if (!p) return;
  const host = layer("components");
  for (const c of p.components) {
    if (c.type !== "lamp") continue;
    const r = uiState.readings?.[c.id];
    const lit = !!(r && r.lit);
    const node = host.querySelector(`g[data-id="${c.id}"]`);
    if (!node) continue;
    node.classList.toggle("lit", lit);
  }
}

function renderWarnings() {
  const host = document.getElementById("readings");
  if (!host) return;
  host.replaceChildren();

  const list = uiState.warnings || [];
  if (!list.length) return;

  const header = document.createElement("div");
  header.className = "warn-header";
  header.textContent = "Предупреждения";
  host.appendChild(header);

  for (const w of list) {
    const row = document.createElement("div");
    row.className = "warn-row";
    row.textContent = w;
    host.appendChild(row);
  }
}

function fmt(x) {
  const a = Math.abs(x);
  if (a < 1e-6) return "0";
  if (a >= 1e6)  return (x / 1e6).toFixed(2) + "M";
  if (a >= 1e3)  return (x / 1e3).toFixed(2) + "k";
  if (a >= 1000 || a < 0.01) return x.toExponential(2);
  return (+x.toFixed(3)).toString();
}