// static/js/component.js
import { getActive, markDirty, specOf, uiState } from "./state.js";
import { layer, screenToWorld } from "./workspace.js";
import { el, terminalWorldPos } from "./svg_utils.js";
import {
  rerouteConnectionsOfComponent,
  handleTerminalClick,
  handleJunctionClick,
  renderAllConnections,
} from "./connections.js";
import { computeRoute } from "./route.js";
import {
  selectComponent,
  toggleComponent,
  isComponentSelected,
  getSelectedComponents,
  emitSelectionChange,
} from "./selection.js";
import {
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
  pushHistory,
} from "./history.js";

export { el, terminalWorldPos };

const GRID = 10;
const snapValue = (v, enabled) =>
  enabled ? Math.round(v / GRID) * GRID : Math.round(v);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const LAMP_FALLBACK = { glow: "#ff4136", edge: "#b71c1c" };

function getLampColor(c, spec) {
  const name = c.properties?.color;
  if (!name) return { ...LAMP_FALLBACK };

  const colorSpec = (spec.properties || []).find((p) => p.id === "color");
  const opts = colorSpec?.options || [];
  for (const o of opts) {
    if (typeof o === "object" && o.value === name && o.color) {
      return { glow: o.color, edge: o.edge || o.color };
    }
  }
  return { ...LAMP_FALLBACK };
}

let drag = null;
let potDrag = null;
let varresDrag = null;

export function renderAllComponents() {
  const host = layer("components");
  host.replaceChildren();
  const p = getActive();
  if (!p) return;
  for (const c of p.components) host.appendChild(renderComponent(c));
}

export function updateSelectionVisual() {
  for (const g of layer("components").querySelectorAll(".component")) {
    g.classList.toggle("selected", isComponentSelected(g.dataset.id));
  }
}

function buildPolaritySwapMap(spec, c) {
  const map = new Map();
  if (!c.state?.polarity_swapped) return map;
  if (!Array.isArray(spec.polarity_pairs)) return map;
  for (const pair of spec.polarity_pairs) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [a, b] = pair;
    map.set(a, b);
    map.set(b, a);
  }
  return map;
}

function updateComponentTransform(cc, cSpec) {
  const t =
    `translate(${cc.position.x},${cc.position.y}) ` +
    `rotate(${cc.rotation || 0} ${cSpec.size[0] / 2} ${cSpec.size[1] / 2})`;
  const node = layer("components").querySelector(`g[data-id="${cc.id}"]`);
  if (node) node.setAttribute("transform", t);
  const reading = layer("overlay").querySelector(`.reading[data-for="${cc.id}"]`);
  if (reading) reading.setAttribute("transform", t);
}

function renderComponent(c) {
  const spec = specOf(c.type);
  const [w, h] = spec.size;

  const extraCls = [];
  if (c.type === "toggle_switch" && c.state.closed) extraCls.push("closed");
  if (c.type === "push_button" && c.state.pressed)  extraCls.push("pressed");
  if (c.type === "lamp" && uiState.readings?.[c.id]?.lit) extraCls.push("lit");

  const g = el("g", {
    class:
      "component" +
      (isComponentSelected(c.id) ? " selected" : "") +
      (extraCls.length ? " " + extraCls.join(" ") : ""),
    "data-id": c.id,
    "data-type": c.type,
    transform:
      `translate(${c.position.x},${c.position.y}) ` +
      `rotate(${c.rotation || 0} ${w / 2} ${h / 2})`,
  });

  if (c.type === "lamp") {
    const col = getLampColor(c, spec);
    g.style.setProperty("--lamp-glow", col.glow);
    g.style.setProperty("--lamp-edge", col.edge);
  }

  if (c.type === "junction") {
    g.appendChild(el("circle", {
      class: "body",
      cx: w / 2, cy: h / 2, r: 5,
    }));
  } else {
    const body = el("rect", {
      class: "body",
      x: 0, y: 0, width: w, height: h,
      rx: 6, ry: 6,
    });
    if (c.style?.background) {
      body.setAttribute("style", `fill: ${c.style.background};`);
    }
    g.appendChild(body);
  }

  const labelPos = labelPositionFor(c, spec);
  const labelCss = [];
  if (c.style?.textColor)  labelCss.push(`fill: ${c.style.textColor}`);
  if (c.style?.fontFamily) labelCss.push(`font-family: ${c.style.fontFamily}`);
  if (c.style?.fontSize)   labelCss.push(`font-size: ${c.style.fontSize}px`);

  const labelText = shortLabel(spec, c);
  if (labelText !== "") {
    const label = el("text", {
      class: "label",
      x: 0, y: 0,
      "text-anchor": "middle",
      "dominant-baseline": "central",
      "pointer-events": "none",
      transform:
        `translate(${labelPos.x},${labelPos.y}) ` +
        `rotate(${-(c.rotation || 0)})`,
    });
    if (labelCss.length) label.setAttribute("style", labelCss.join("; "));
    label.textContent = labelText;
    g.appendChild(label);
  }

  if (c.type === "potentiometer") {
    appendPotDecoration(g, c, spec);
  } else if (c.type === "variable_resistor") {
    appendVarResDecoration(g, c, spec);
  } else if (c.type === "toggle_switch") {
    appendToggleDecoration(g, c, spec);
  } else if (c.type === "push_button") {
    appendPushButtonDecoration(g, c, spec);
  } else if (c.type === "lamp") {
    appendLampDecoration(g, c, spec);
  }

  const swapMap = buildPolaritySwapMap(spec, c);

  for (const t of spec.terminals) {
    const term = el("circle", {
      class: "terminal",
      cx: t.x, cy: t.y, r: 5,
      "data-terminal": t.id,
      "data-component": c.id,
    });
    if (c.type !== "junction") {
      term.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        handleTerminalClick(c.id, t.id);
      });
    }
    g.appendChild(term);

    if (t.inner_label) {
      let text = t.inner_label;
      if (swapMap.has(t.id)) {
        const partner = spec.terminals.find((x) => x.id === swapMap.get(t.id));
        if (partner && partner.inner_label) text = partner.inner_label;
      }
      g.appendChild(makeInnerLabel(t, text, spec, c));
    }
  }

  g.addEventListener("pointerdown", (e) => {
    if (e.target.classList.contains("terminal")) return;
    if (e.target.classList.contains("pot-knob")) return;
    if (e.target.classList.contains("varres-knob")) return;
    e.stopPropagation();
    const p = getActive();
    if (!p) return;

    if (c.type === "junction" && uiState.connectionActive) {
      handleJunctionClick(c.id);
      return;
    }

    const alreadySelected = isComponentSelected(c.id);
    if (!alreadySelected) {
      if (e.shiftKey) toggleComponent(c.id);
      else selectComponent(c.id);
    } else if (e.shiftKey) {
      toggleComponent(c.id);
      return;
    }

    const movingIds = [...getSelectedComponents()];
    const snapshot = new Map();
    for (const id of movingIds) {
      const cc = p.components.find((x) => x.id === id);
      if (cc) snapshot.set(id, { x: cc.position.x, y: cc.position.y });
    }

    beginTransaction(p);
    try { g.setPointerCapture(e.pointerId); } catch {}

    drag = {
      start: screenToWorld(e.clientX, e.clientY),
      snapshot, project: p, moved: false,
    };
  });

  g.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = drag.project;
    const now = screenToWorld(e.clientX, e.clientY);
    const dx = now.x - drag.start.x;
    const dy = now.y - drag.start.y;
    const snapOn = !e.altKey;

    for (const [id, orig] of drag.snapshot) {
      const cc = p.components.find((x) => x.id === id);
      if (!cc) continue;
      cc.position.x = snapValue(orig.x + dx, snapOn);
      cc.position.y = snapValue(orig.y + dy, snapOn);
    }

    for (const id of drag.snapshot.keys()) {
      const cc = p.components.find((x) => x.id === id);
      if (!cc) continue;
      updateComponentTransform(cc, specOf(cc.type));
    }

    for (const id of drag.snapshot.keys()) {
      const cc = p.components.find((x) => x.id === id);
      if (cc) rerouteConnectionsOfComponent(p, cc);
    }

    drag.moved = true;
  });

  g.addEventListener("pointerup", (e) => {
    if (!drag) return;
    const wasMoved = drag.moved;
    const project = drag.project;
    drag = null;
    try { g.releasePointerCapture(e.pointerId); } catch {}

    if (wasMoved) {
      markDirty(project);
      commitTransaction(project, "move");
      emitSelectionChange();
      renderAllConnections();
    } else {
      rollbackTransaction(project);
      handleComponentClick(project, c);
    }
  });

  g.addEventListener("pointercancel", () => {
    if (!drag) return;
    rollbackTransaction(drag.project);
    drag = null;
  });

  return g;
}

function labelPositionFor(c, spec) {
  const [w, h] = spec.size;
  if (c.type === "potentiometer") return { x: w / 2, y: h - 8 };
  if (c.type === "variable_resistor") return { x: w / 2, y: h / 2 };
  return { x: w / 2, y: h / 2 };
}

function makeInnerLabel(t, text, spec, c) {
  const [w, h] = spec.size;
  const cx = w / 2, cy = h / 2;
  const dx = cx - t.x;
  const dy = cy - t.y;
  const len = Math.hypot(dx, dy) || 1;
  const dist = 12;
  const px = t.x + (dx / len) * dist;
  const py = t.y + (dy / len) * dist;

  const lbl = el("text", {
    class: "polarity-label",
    x: 0, y: 0,
    "text-anchor": "middle",
    "dominant-baseline": "central",
    "pointer-events": "none",
    transform:
      `translate(${px},${py}) ` +
      `rotate(${-(c.rotation || 0)})`,
  });
  if (c.style?.textColor) {
    lbl.setAttribute("style", `fill: ${c.style.textColor};`);
  }
  lbl.textContent = text;
  return lbl;
}

function handleComponentClick(project, c) {
  if (c.type === "junction") {
    handleJunctionClick(c.id);
    return;
  }
  if (c.type === "toggle_switch") {
    pushHistory(project, "toggle");
    c.state.closed = !c.state.closed;
    markDirty(project);
    renderAllComponents();
    renderAllConnections();
    return;
  }
  if (c.type === "push_button") {
    pushHistory(project, "press");
    c.state.pressed = !c.state.pressed;
    markDirty(project);
    renderAllComponents();
    renderAllConnections();
    return;
  }
}

function appendToggleDecoration(g, c, spec) {
  const [w, h] = spec.size;
  const cy = h / 2;
  const tLeft  = spec.terminals.find((t) => t.id === "1") || { x: 0, y: cy };
  const tRight = spec.terminals.find((t) => t.id === "2") || { x: w, y: cy };
  const leftX  = 20;
  const rightX = w - 20;
  const dotR = 3;
  const closed = !!c.state.closed;
  const strokeColor = "#333";

  g.appendChild(el("line", {
    class: "toggle-lead",
    x1: tLeft.x,  y1: tLeft.y,  x2: leftX,  y2: cy,
    stroke: strokeColor, "stroke-width": 1.5,
    "stroke-linecap": "round", "pointer-events": "none",
  }));
  g.appendChild(el("line", {
    class: "toggle-lead",
    x1: tRight.x, y1: tRight.y, x2: rightX, y2: cy,
    stroke: strokeColor, "stroke-width": 1.5,
    "stroke-linecap": "round", "pointer-events": "none",
  }));
  g.appendChild(el("circle", {
    class: "toggle-contact",
    cx: leftX, cy, r: dotR, fill: strokeColor, "pointer-events": "none",
  }));
  g.appendChild(el("circle", {
    class: "toggle-contact",
    cx: rightX, cy, r: dotR, fill: strokeColor, "pointer-events": "none",
  }));
  if (closed) {
    g.appendChild(el("line", {
      class: "toggle-arm",
      x1: leftX, y1: cy, x2: rightX, y2: cy,
      stroke: strokeColor, "stroke-width": 2,
      "stroke-linecap": "round", "pointer-events": "none",
    }));
  } else {
    g.appendChild(el("line", {
      class: "toggle-arm",
      x1: leftX, y1: cy, x2: rightX, y2: cy - 14,
      stroke: strokeColor, "stroke-width": 2,
      "stroke-linecap": "round", "pointer-events": "none",
    }));
  }
}

function appendPushButtonDecoration(g, c, spec) {
  const [w, h] = spec.size;
  const cy = h / 2;
  const tLeft  = spec.terminals.find((t) => t.id === "1") || { x: 0, y: cy };
  const tRight = spec.terminals.find((t) => t.id === "2") || { x: w, y: cy };
  const leftX  = 20;
  const rightX = w - 20;
  const dotR = 3;
  const pressed = !!c.state.pressed;
  const strokeColor = "#333";

  g.appendChild(el("line", {
    class: "button-lead",
    x1: tLeft.x,  y1: tLeft.y,  x2: leftX,  y2: cy,
    stroke: strokeColor, "stroke-width": 1.5,
    "stroke-linecap": "round", "pointer-events": "none",
  }));
  g.appendChild(el("line", {
    class: "button-lead",
    x1: tRight.x, y1: tRight.y, x2: rightX, y2: cy,
    stroke: strokeColor, "stroke-width": 1.5,
    "stroke-linecap": "round", "pointer-events": "none",
  }));
  g.appendChild(el("circle", {
    class: "button-contact",
    cx: leftX, cy, r: dotR, fill: strokeColor, "pointer-events": "none",
  }));
  g.appendChild(el("circle", {
    class: "button-contact",
    cx: rightX, cy, r: dotR, fill: strokeColor, "pointer-events": "none",
  }));
  const plateY = pressed ? cy : cy - 8;
  g.appendChild(el("line", {
    class: "button-plate",
    x1: leftX, y1: plateY, x2: rightX, y2: plateY,
    stroke: strokeColor, "stroke-width": 2,
    "stroke-linecap": "round", "pointer-events": "none",
  }));
  const stemX = w / 2;
  const stemTopY = 5;
  g.appendChild(el("line", {
    class: "button-stem",
    x1: stemX, y1: plateY, x2: stemX, y2: stemTopY,
    stroke: strokeColor, "stroke-width": 1.5,
    "stroke-linecap": "round", "pointer-events": "none",
  }));
  const capHalf = 6;
  g.appendChild(el("line", {
    class: "button-cap",
    x1: stemX - capHalf, y1: stemTopY, x2: stemX + capHalf, y2: stemTopY,
    stroke: strokeColor, "stroke-width": 2,
    "stroke-linecap": "round", "pointer-events": "none",
  }));
}

function appendLampDecoration(g, c, spec) {
  const [w, h] = spec.size;
  const cx = w / 2;
  const cy = h / 2;
  const R = 16;
  const tTop = spec.terminals.find((t) => t.id === "1") || { x: cx, y: 0 };
  const tBot = spec.terminals.find((t) => t.id === "2") || { x: cx, y: h };
  const strokeColor = "#333";

  g.appendChild(el("line", {
    class: "lamp-lead",
    x1: tTop.x, y1: tTop.y, x2: cx, y2: cy - R,
    stroke: strokeColor, "stroke-width": 1.5,
    "stroke-linecap": "round", "pointer-events": "none",
  }));
  g.appendChild(el("line", {
    class: "lamp-lead",
    x1: tBot.x, y1: tBot.y, x2: cx, y2: cy + R,
    stroke: strokeColor, "stroke-width": 1.5,
    "stroke-linecap": "round", "pointer-events": "none",
  }));
  g.appendChild(el("circle", {
    class: "lamp-bulb",
    cx, cy, r: R,
    fill: "none",
    stroke: strokeColor,
    "stroke-width": 2,
    "pointer-events": "none",
  }));
  const d = R / Math.SQRT2;
  g.appendChild(el("line", {
    class: "lamp-cross",
    x1: cx - d, y1: cy - d, x2: cx + d, y2: cy + d,
    stroke: strokeColor, "stroke-width": 1.5,
    "stroke-linecap": "round", "pointer-events": "none",
  }));
  g.appendChild(el("line", {
    class: "lamp-cross",
    x1: cx + d, y1: cy - d, x2: cx - d, y2: cy + d,
    stroke: strokeColor, "stroke-width": 1.5,
    "stroke-linecap": "round", "pointer-events": "none",
  }));
}

function appendPotDecoration(g, c, spec) {
  const [w, h] = spec.size;
  const trackX = 20;
  const trackTop = 10;
  const trackBot = 50;
  const wiper = clamp(c.state.wiper ?? 0.5, 0, 1);
  const yForWiper = (v) => trackTop + (trackBot - trackTop) * v;
  const rTotal = Math.max(Number(c.properties.resistance ?? 1000), 1e-6);

  g.appendChild(el("line", {
    x1: trackX, y1: trackTop, x2: trackX, y2: trackBot,
    stroke: "#888", "stroke-width": 2, "pointer-events": "none",
  }));
  g.appendChild(el("line", {
    x1: 0, y1: 10, x2: trackX, y2: 10,
    stroke: "#888", "stroke-width": 2, "pointer-events": "none",
  }));
  g.appendChild(el("line", {
    x1: 0, y1: 50, x2: trackX, y2: 50,
    stroke: "#888", "stroke-width": 2, "pointer-events": "none",
  }));
  const arm = el("line", {
    x1: trackX, y1: yForWiper(wiper), x2: w, y2: h / 2,
    stroke: "#888", "stroke-width": 1.5, "pointer-events": "none",
  });
  g.appendChild(arm);

  const labelAW = el("text", {
    class: "pot-value",
    x: 0, y: 0,
    "text-anchor": "middle",
    "dominant-baseline": "central",
    "pointer-events": "none",
    transform:
      `translate(${w / 2 + 8}, ${trackTop + 6}) ` +
      `rotate(${-(c.rotation || 0)})`,
  });
  labelAW.textContent = formatOhm(rTotal * wiper);
  g.appendChild(labelAW);

  const labelWB = el("text", {
    class: "pot-value",
    x: 0, y: 0,
    "text-anchor": "middle",
    "dominant-baseline": "central",
    "pointer-events": "none",
    transform:
      `translate(${w / 2 + 8}, ${trackBot - 6}) ` +
      `rotate(${-(c.rotation || 0)})`,
  });
  labelWB.textContent = formatOhm(rTotal * (1 - wiper));
  g.appendChild(labelWB);

  const knob = el("circle", {
    class: "pot-knob",
    cx: trackX, cy: yForWiper(wiper), r: 6,
    fill: "#fff", stroke: "#2b7cff", "stroke-width": 2,
    style: "cursor: ns-resize;",
  });

  knob.addEventListener("pointerdown", (e) => {
    const project = getActive();
    if (!project) return;
    e.stopPropagation();
    try { knob.setPointerCapture(e.pointerId); } catch {}
    beginTransaction(project);
    potDrag = {
      project, comp: c, spec, knob, arm,
      trackTop, trackBot, trackX,
      origWiper: c.state.wiper,
      labelAW, labelWB, rTotal,
    };
  });

  knob.addEventListener("pointermove", (e) => {
    if (!potDrag) return;
    const { comp, spec, knob, arm, trackTop, trackBot, rTotal, labelAW, labelWB } = potDrag;
    const [cw, ch] = spec.size;
    const world = screenToWorld(e.clientX, e.clientY);
    const cx = cw / 2, cy = ch / 2;
    const rad = -(comp.rotation || 0) * Math.PI / 180;
    const dx = world.x - comp.position.x - cx;
    const dy = world.y - comp.position.y - cy;
    const ly = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
    const t = (ly - trackTop) / (trackBot - trackTop);
    const newWiper = clamp(t, 0, 1);
    comp.state.wiper = newWiper;
    const newY = trackTop + (trackBot - trackTop) * newWiper;
    knob.setAttribute("cy", newY);
    arm.setAttribute("y1", newY);
    labelAW.textContent = formatOhm(rTotal * newWiper);
    labelWB.textContent = formatOhm(rTotal * (1 - newWiper));
  });

  knob.addEventListener("pointerup", (e) => {
    if (!potDrag) return;
    const project = potDrag.project;
    try { knob.releasePointerCapture(e.pointerId); } catch {}
    potDrag = null;
    markDirty(project);
    commitTransaction(project, "adjust pot");
    renderAllComponents();
    renderAllConnections();
  });

  knob.addEventListener("pointercancel", () => {
    if (!potDrag) return;
    const { project, comp, origWiper } = potDrag;
    comp.state.wiper = origWiper;
    rollbackTransaction(project);
    potDrag = null;
    renderAllComponents();
  });

  g.appendChild(knob);
}

function appendVarResDecoration(g, c, spec) {
  const [w, h] = spec.size;
  const trackL = 15;
  const trackR = w - 15;
  const trackY = h / 2;
  const rMax = Math.max(Number(c.properties.resistance ?? 100), 1e-6);
  let rNow = c.state.current_resistance;
  if (rNow === undefined || rNow === null) rNow = rMax;
  rNow = clamp(Number(rNow), 0, rMax);
  c.state.current_resistance = rNow;
  const t = rMax > 0 ? rNow / rMax : 0;
  const knobX = trackL + (trackR - trackL) * t;

  g.appendChild(el("line", {
    x1: trackL, y1: trackY, x2: trackR, y2: trackY,
    stroke: "#888", "stroke-width": 2, "pointer-events": "none",
  }));

  const label = el("text", {
    class: "varres-value",
    x: 0, y: 0,
    "text-anchor": "middle",
    "dominant-baseline": "central",
    "pointer-events": "none",
    transform:
      `translate(${w / 2},${trackY - 11}) ` +
      `rotate(${-(c.rotation || 0)})`,
  });
  label.textContent = formatOhm(rNow);
  g.appendChild(label);

  const knob = el("circle", {
    class: "varres-knob",
    cx: knobX, cy: trackY, r: 6,
    fill: "#fff", stroke: "#2b7cff", "stroke-width": 2,
    style: "cursor: ew-resize;",
  });

  knob.addEventListener("pointerdown", (e) => {
    const project = getActive();
    if (!project) return;
    e.stopPropagation();
    try { knob.setPointerCapture(e.pointerId); } catch {}
    beginTransaction(project);
    varresDrag = {
      project, comp: c, spec, knob, label,
      trackL, trackR, rMax,
      origR: c.state.current_resistance,
    };
  });

  knob.addEventListener("pointermove", (e) => {
    if (!varresDrag) return;
    const { comp, spec, knob, label, trackL, trackR, rMax } = varresDrag;
    const [cw, ch] = spec.size;
    const world = screenToWorld(e.clientX, e.clientY);
    const cx = cw / 2, cy = ch / 2;
    const rad = -(comp.rotation || 0) * Math.PI / 180;
    const dx = world.x - comp.position.x - cx;
    const dy = world.y - comp.position.y - cy;
    const lx = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
    let tt = (lx - trackL) / (trackR - trackL);
    tt = clamp(tt, 0, 1);
    const rNew = Math.round(rMax * tt * 10) / 10;
    comp.state.current_resistance = rNew;
    const newX = trackL + (trackR - trackL) * tt;
    knob.setAttribute("cx", newX);
    label.textContent = formatOhm(rNew);
  });

  knob.addEventListener("pointerup", (e) => {
    if (!varresDrag) return;
    const project = varresDrag.project;
    try { knob.releasePointerCapture(e.pointerId); } catch {}
    varresDrag = null;
    markDirty(project);
    commitTransaction(project, "adjust rheostat");
    renderAllComponents();
    renderAllConnections();
  });

  knob.addEventListener("pointercancel", () => {
    if (!varresDrag) return;
    const { project, comp, origR } = varresDrag;
    comp.state.current_resistance = origR;
    rollbackTransaction(project);
    varresDrag = null;
    renderAllComponents();
  });

  g.appendChild(knob);
}

function formatOhm(r) {
  const a = Math.abs(r);
  if (a === 0)    return "0 Ом";
  if (a >= 1e6)   return (r / 1e6).toFixed(2) + " МОм";
  if (a >= 1e3)   return (r / 1e3).toFixed(2) + " кОм";
  if (a >= 100)   return r.toFixed(0) + " Ом";
  if (a >= 10)    return r.toFixed(1) + " Ом";
  if (a >= 1)     return r.toFixed(2) + " Ом";
  return r.toFixed(3) + " Ом";
}

function shortLabel(spec, c) {
  if (c.type === "junction")           return "";
  if (c.type === "potentiometer")      return "";
  if (c.type === "variable_resistor")  return "";
  if (c.type === "toggle_switch")      return "";
  if (c.type === "push_button")        return "";
  if (c.type === "lamp")               return "";
  if (c.type === "voltmeter")          return "V";
  if (c.type === "ammeter")            return "A";
  if (c.type === "wattmeter")          return "W";
  if (c.type === "ohmmeter")           return "Ω";

  if (c.type === "resistor")           return `${c.properties.resistance} Ω`;
  if (c.type === "dc_voltage_source")  return `${c.properties.voltage} В`;
  if (c.type === "dc_current_source")  return `${c.properties.current} А`;
  if (c.type === "ac_voltage_source")  return `~${c.properties.amplitude} В`;
  if (c.type === "heater")             return `${c.properties.power} Вт`;
  return spec.label;
}