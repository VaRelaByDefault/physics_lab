// static/js/app.js
import {
  loadCatalog, on, getActive, addProject, markDirty, setActive, state,
} from "./state.js";
import { initTabsUI, renderTabs, activateCurrent } from "./tabs.js";
import { renderPalettes } from "./palette.js";
import { api } from "./api.js";
import {
  onSelectionChange, clearSelection, setSelection,
} from "./selection.js";
import { renderInspector } from "./inspector.js";
import { renderAllComponents, updateSelectionVisual } from "./component.js";
import { renderAllConnections, updateConnectionSelectionVisual } from "./connections.js";
import { renderWaypointHandles, initRouteEditing } from "./connections_edit.js";
import { undo, redo, canUndo, canRedo } from "./history.js";
import { copySelection, pasteClipboard, duplicateSelection } from "./clipboard.js";
import {
  deleteSelection, rotateSelection, alignSelectionToGrid,
  cleanupConnections, fillMissingAnchors, cleanupStubWaypoints,
} from "./operations.js";
import { initContextMenu } from "./contextmenu.js";
import { initBoxSelect } from "./box_select.js";
import { scheduleLive, runLive } from "./live.js";
import { renderReadings } from "./readings_display.js";
import { initTheme } from "./theme.js";
import { renderMinimap, initMinimap } from "./minimap.js";
import { restore, initPersist } from "./persist.js";

async function main() {
  await loadCatalog();
  renderPalettes();
  initTabsUI();
  initContextMenu();
  initBoxSelect();
  initRouteEditing();
  initTheme();
  initMinimap();
  initPersist();

  on("projects", renderTabs);
  on("active", () => {
    clearSelection();
    renderTabs();
    activateCurrent();
    updateUndoRedoButtons();
    renderMinimap();
    renderReadings();
    renderWaypointHandles();
    scheduleLive();
  });
  on("dirty", () => {
    renderTabs();
    renderWaypointHandles();
    scheduleLive();
  });

  onSelectionChange(() => {
    updateSelectionVisual();
    updateConnectionSelectionVisual();
    renderWaypointHandles();
    renderInspector();
  });

  document.getElementById("btn-simulate")
    .addEventListener("click", () => runLive(true));
  document.getElementById("btn-undo").addEventListener("click", doUndo);
  document.getElementById("btn-redo").addEventListener("click", doRedo);
  document.addEventListener("keydown", onGlobalKey);

  const restored = restore();
  if (restored && restored.projects?.length) {
    for (const { project, dirty } of restored.projects) {
      project.dirty = !!dirty;
      addProject(project);
    }
    if (restored.activeId) setActive(restored.activeId);
  } else {
    const first = await api.createProject({ name: "Проект 1" });
    first.dirty = false;
    addProject(first);
  }

  // Пролечиваем восстановленные проекты от артефактов прошлых версий:
  for (const p of state.projects) {
    cleanupConnections(p);
    fillMissingAnchors(p);
    cleanupStubWaypoints(p);
  }

  renderInspector();
  updateUndoRedoButtons();
  renderReadings();
  renderMinimap();
  renderWaypointHandles();
  scheduleLive();
}

function doUndo() {
  const p = getActive(); if (!p) return;
  if (undo(p)) {
    markDirty(p); clearSelection();
    renderAllComponents(); renderAllConnections();
    updateUndoRedoButtons();
  }
}
function doRedo() {
  const p = getActive(); if (!p) return;
  if (redo(p)) {
    markDirty(p); clearSelection();
    renderAllComponents(); renderAllConnections();
    updateUndoRedoButtons();
  }
}
function updateUndoRedoButtons() {
  const p = getActive();
  document.getElementById("btn-undo").disabled = !p || !canUndo(p);
  document.getElementById("btn-redo").disabled = !p || !canRedo(p);
}

function onGlobalKey(e) {
  const tag = (document.activeElement?.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return;
  const ctrl = e.ctrlKey || e.metaKey;
  const p = getActive(); if (!p) return;
  const k = e.key.toLowerCase();

  if (ctrl && k === "z" && !e.shiftKey) { e.preventDefault(); doUndo(); return; }
  if (ctrl && (k === "y" || (e.shiftKey && k === "z"))) {
    e.preventDefault(); doRedo(); return;
  }
  if (ctrl && k === "c") { e.preventDefault(); copySelection(p); return; }
  if (ctrl && k === "v") { e.preventDefault(); pasteClipboard(p); return; }
  if (ctrl && k === "d") { e.preventDefault(); duplicateSelection(p); return; }
  if (ctrl && k === "a") {
    e.preventDefault();
    const comps = p.components.map((c) => c.id);
    const conns = p.connections.map((w) => w.id);
    setSelection(comps, conns);
    return;
  }

  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault(); deleteSelection(p); return;
  }
  if (k === "r") {
    e.preventDefault();
    rotateSelection(p, 90);
    renderInspector();
  }
  if (k === "g" && !ctrl) {
    e.preventDefault();
    alignSelectionToGrid(p);
  }
}

main();