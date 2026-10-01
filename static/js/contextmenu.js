// static/js/contextmenu.js
import { getActive, specOf } from "./state.js";
import {
  selectComponent, selectConnection, clearSelection, selectionSize,
  getSelectedComponents,
} from "./selection.js";
import { workspaceSvg, screenToWorld } from "./workspace.js";
import {
  rotateComponent, rotateSelection,
  deleteComponent, deleteConnection, deleteSelection,
  alignSelectionToGrid,
  simplifyConnectionRoute,
  swapPolarity, swapPolaritySelection,
} from "./operations.js";
import {
  copySelection, duplicateSelection, pasteClipboard, hasClipboard,
} from "./clipboard.js";

const menuEl = document.getElementById("context-menu");

export function initContextMenu() {
  workspaceSvg.addEventListener("contextmenu", onContextMenu);
  document.addEventListener("pointerdown", (e) => {
    if (!menuEl.hidden && !menuEl.contains(e.target)) hideMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideMenu();
  });
}

function onContextMenu(e) {
  e.preventDefault();
  const p = getActive();
  if (!p) return;

  const target = e.target;
  if (target.classList?.contains("terminal")) { hideMenu(); return; }
  if (target.classList?.contains("handle-hit")) return;
  if (target.classList?.contains("wp-handle")) return;
  if (target.classList?.contains("end-handle")) return;

  if (selectionSize() > 1) {
    const anyPolarity = [...getSelectedComponents()].some((id) => {
      const c = p.components.find((x) => x.id === id);
      if (!c) return false;
      const sp = specOf(c.type);
      return !!(sp && Array.isArray(sp.polarity_pairs) && sp.polarity_pairs.length);
    });

    const items = [
      { label: "Повернуть всё на 90°",  action: () => rotateSelection(p, 90) },
      { label: "Выровнять по сетке",    action: () => alignSelectionToGrid(p) },
    ];
    if (anyPolarity) {
      items.push({
        label: "Поменять полярность",
        action: () => swapPolaritySelection(p),
      });
    }
    items.push(
      { sep: true },
      { label: "Копировать",            action: () => copySelection(p) },
      { label: "Дублировать",           action: () => duplicateSelection(p) },
      { sep: true },
      { label: "Удалить выделенное",    action: () => deleteSelection(p), danger: true },
    );
    showMenu(e.clientX, e.clientY, items);
    return;
  }

  const compEl = target.closest?.(".component");
  const connEl = target.closest?.(".connection");

  let items = [];

  if (compEl) {
    const id = compEl.dataset.id;
    selectComponent(id);
    const comp = p.components.find((x) => x.id === id);
    const spec = comp ? specOf(comp.type) : null;
    const hasPolarity = !!(spec
      && Array.isArray(spec.polarity_pairs)
      && spec.polarity_pairs.length);

    items = [
      { label: "Повернуть на 90°",   action: () => rotateComponent(p, id, 90) },
      { label: "Выровнять по сетке", action: () => alignSelectionToGrid(p) },
    ];
    if (hasPolarity) {
      items.push({
        label: "Поменять полярность",
        action: () => swapPolarity(p, id),
      });
    }
    items.push(
      { sep: true },
      { label: "Копировать",         action: () => copySelection(p) },
      { label: "Дублировать",        action: () => duplicateSelection(p) },
      { sep: true },
      { label: "Вставить",           action: () => pasteClipboard(p), disabled: !hasClipboard() },
      { sep: true },
      { label: "Удалить",            action: () => deleteComponent(p, id), danger: true },
    );
  } else if (connEl) {
    const id = connEl.dataset.id;
    selectConnection(id);
    const conn = p.connections.find((w) => w.id === id);
    const hasWaypoints = !!(conn && Array.isArray(conn.waypoints) && conn.waypoints.length);
    items = [
      { label: "Упростить маршрут",  action: () => simplifyConnectionRoute(p, id),
        disabled: !hasWaypoints },
      { sep: true },
      { label: "Удалить соединение", action: () => deleteConnection(p, id), danger: true },
    ];
  } else {
    clearSelection();
    items = [
      { label: "Вставить", action: () => pasteClipboard(p), disabled: !hasClipboard() },
    ];
  }

  showMenu(e.clientX, e.clientY, items);
}

export function showContextMenu(clientX, clientY, items) {
  showMenu(clientX, clientY, items);
}

function showMenu(clientX, clientY, items) {
  menuEl.replaceChildren();
  for (const it of items) {
    if (it.sep) {
      const sep = document.createElement("div");
      sep.className = "menu-sep";
      menuEl.appendChild(sep);
      continue;
    }
    const el = document.createElement("div");
    el.className = "menu-item"
      + (it.danger ? " danger" : "")
      + (it.disabled ? " disabled" : "");
    el.textContent = it.label;
    if (!it.disabled) {
      el.addEventListener("click", () => { hideMenu(); it.action(); });
    }
    menuEl.appendChild(el);
  }
  menuEl.hidden = false;
  menuEl.style.left = "0px";
  menuEl.style.top = "0px";
  const rect = menuEl.getBoundingClientRect();
  const x = Math.min(clientX, window.innerWidth - rect.width - 4);
  const y = Math.min(clientY, window.innerHeight - rect.height - 4);
  menuEl.style.left = x + "px";
  menuEl.style.top = y + "px";
}

function hideMenu() { menuEl.hidden = true; }