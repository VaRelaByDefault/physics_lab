// static/js/palette.js
import { state, getActive, markDirty, specOf, uid } from "./state.js";
import { renderAllComponents } from "./component.js";
import { renderAllConnections } from "./connections.js";
import { screenToWorld } from "./workspace.js";
import { renderInspector } from "./inspector.js";
import { scheduleLive } from "./live.js";

const CATEGORY_ORDER = ["sources", "passive", "switches", "instruments"];
const CATEGORY_LABELS = {
  sources: "Источники",
  passive: "Нагрузка",
  switches: "Коммутация",
  instruments: "Приборы",
};

export function renderPalettes() {
  const items = state.catalog?.items || {};
  const left  = document.getElementById("palette-left");
  const right = document.getElementById("palette-right");
  left.replaceChildren();
  right.replaceChildren();

  const groupsLeft = {}, groupsRight = {};
  for (const [type, spec] of Object.entries(items)) {
    if (spec.panel === "hidden") continue;
    const g = spec.category || "other";
    const bag = (spec.panel === "right" ? groupsRight : groupsLeft);
    (bag[g] ||= []).push([type, spec]);
  }
  fillPalette(left, groupsLeft);
  fillPalette(right, groupsRight);

  bindSearch("palette-left-search", left);
  bindSearch("palette-right-search", right);
}

function fillPalette(host, groups) {
  const cats = Object.keys(groups).sort((a, b) =>
    CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
  for (const cat of cats) {
    const gEl = document.createElement("div");
    gEl.className = "palette-group";
    const t = document.createElement("div");
    t.className = "palette-group-title";
    t.textContent = CATEGORY_LABELS[cat] || cat;
    t.addEventListener("click", () => gEl.classList.toggle("collapsed"));
    gEl.appendChild(t);
    const items = document.createElement("div");
    items.className = "palette-group-items";
    for (const [type, spec] of groups[cat]) items.appendChild(buildPaletteItem(type, spec));
    gEl.appendChild(items);
    host.appendChild(gEl);
  }
}

function bindSearch(inputId, host) {
  const input = document.getElementById(inputId);
  if (!input || input.dataset.bound) return;
  input.dataset.bound = "1";
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    for (const item of host.querySelectorAll(".palette-item")) {
      const name = item.dataset.name.toLowerCase();
      item.style.display = !q || name.includes(q) ? "" : "none";
    }
    for (const g of host.querySelectorAll(".palette-group")) {
      const anyVisible = [...g.querySelectorAll(".palette-item")]
        .some((el) => el.style.display !== "none");
      g.style.display = anyVisible ? "" : "none";
    }
  });
}

function buildPaletteItem(type, spec) {
  const div = document.createElement("div");
  div.className = "palette-item";
  div.draggable = true;
  div.dataset.type = type;
  div.dataset.name = spec.label;
  div.innerHTML = `<div class="icon">${emojiFor(type)}</div><div class="name">${spec.label}</div>`;

  div.addEventListener("dblclick", () => {
    const p = getActive();
    if (!p) return;
    const host = document.getElementById("workspace");
    const rect = host.getBoundingClientRect();
    const w = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    addComponentAt(p, type, w.x, w.y);
  });
  div.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", type);
    e.dataTransfer.effectAllowed = "copy";
  });
  return div;
}

document.getElementById("workspace").addEventListener("dragover", (e) => {
  if (e.dataTransfer.types.includes("text/plain")) e.preventDefault();
});
document.getElementById("workspace").addEventListener("drop", (e) => {
  const type = e.dataTransfer.getData("text/plain");
  if (!type || !specOf(type)) return;
  e.preventDefault();
  const p = getActive();
  if (!p) return;
  const w = screenToWorld(e.clientX, e.clientY);
  addComponentAt(p, type, w.x, w.y);
});

export function addComponentAt(project, type, x, y) {
  const spec = specOf(type);
  const [w, h] = spec.size;
  const props = {}; for (const p of spec.properties) props[p.id] = p.default;
  const st = {};   for (const s of spec.state)      st[s.id] = s.default;

  project.components.push({
    id: uid("c"), type,
    position: {
      x: Math.round((x - w / 2) / 10) * 10,
      y: Math.round((y - h / 2) / 10) * 10,
    },
    rotation: 0, properties: props, state: st,
  });
  markDirty(project);
  renderAllComponents();
  renderAllConnections();
  scheduleLive();
  renderInspector();
}

function emojiFor(type) {
  return {
    dc_voltage_source: "🔋", dc_current_source: "⏚", ac_voltage_source: "⚡",
    resistor: "▭", variable_resistor: "↔", potentiometer: "⌥",
    lamp: "💡", heater: "🔥",
    toggle_switch: "⇄", push_button: "🔘",
    voltmeter: "V", ammeter: "A", wattmeter: "W", ohmmeter: "Ω",
  }[type] || "•";
}