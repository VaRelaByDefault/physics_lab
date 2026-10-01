import { uiState } from "./state.js";

const listeners = [];

export function getSelectedComponents() { return uiState.selection.components; }
export function getSelectedConnections() { return uiState.selection.connections; }

export function selectionEmpty() {
  const s = uiState.selection;
  return s.components.size === 0 && s.connections.size === 0;
}
export function selectionSize() {
  const s = uiState.selection;
  return s.components.size + s.connections.size;
}

export function isComponentSelected(id) { return uiState.selection.components.has(id); }
export function isConnectionSelected(id) { return uiState.selection.connections.has(id); }

export function selectComponent(id, additive = false) {
  if (!additive) {
    uiState.selection.components.clear();
    uiState.selection.connections.clear();
  }
  uiState.selection.components.add(id);
  emit();
}
export function selectConnection(id, additive = false) {
  if (!additive) {
    uiState.selection.components.clear();
    uiState.selection.connections.clear();
  }
  uiState.selection.connections.add(id);
  emit();
}
export function toggleComponent(id) {
  const s = uiState.selection;
  if (s.components.has(id)) s.components.delete(id);
  else s.components.add(id);
  emit();
}
export function toggleConnection(id) {
  const s = uiState.selection;
  if (s.connections.has(id)) s.connections.delete(id);
  else s.connections.add(id);
  emit();
}
export function setSelection(componentIds, connectionIds, additive = false) {
  const s = uiState.selection;
  if (!additive) {
    s.components.clear();
    s.connections.clear();
  }
  for (const id of componentIds) s.components.add(id);
  for (const id of connectionIds) s.connections.add(id);
  emit();
}
export function clearSelection() {
  const s = uiState.selection;
  if (s.components.size === 0 && s.connections.size === 0) return;
  s.components.clear();
  s.connections.clear();
  emit();
}

export function describeSelection(project) {
  const comps = [...uiState.selection.components]
    .map((id) => project.components.find((c) => c.id === id))
    .filter(Boolean);
  const conns = [...uiState.selection.connections]
    .map((id) => project.connections.find((w) => w.id === id))
    .filter(Boolean);
  return { comps, conns };
}

export function onSelectionChange(fn) { listeners.push(fn); }
export function emitSelectionChange() { emit(); }
function emit() { listeners.forEach((fn) => fn()); }