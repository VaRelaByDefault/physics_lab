import { api } from "./api.js";

export const state = {
  catalog: null,
  projects: [],
  activeId: null,
};

export const uiState = {
  connectionActive: false,
  selection: { components: new Set(), connections: new Set() },
  readings: {},
  warnings: [],
};

const listeners = { projects: [], active: [], dirty: [] };

export function on(event, fn) {
  listeners[event]?.push(fn);
}
function emit(event) {
  listeners[event]?.forEach((fn) => fn());
}

export function uid(prefix = "id") {
  return prefix + "_" + Math.random().toString(36).slice(2, 10);
}

export function getActive() {
  return state.projects.find((p) => p.id === state.activeId) || null;
}

export function setActive(id) {
  if (state.activeId === id) return;
  state.activeId = id;
  emit("active");
}

export function addProject(project) {
  state.projects.push(project);
  state.activeId = project.id;
  emit("projects");
  emit("active");
}

export function closeProject(id) {
  const idx = state.projects.findIndex((p) => p.id === id);
  if (idx < 0) return;
  state.projects.splice(idx, 1);
  if (state.activeId === id) {
    state.activeId = state.projects[Math.max(0, idx - 1)]?.id || null;
    emit("active");
  }
  emit("projects");
}

export function markDirty(project) {
  project.dirty = true;
  emit("dirty");
}

export function newProjectPayload(name = "Новый проект") {
  return {
    schema_version: 1,
    id: uid("prj"),
    name,
    created: new Date().toISOString(),
    modified: "",
    viewport: { x: 0, y: 0, zoom: 1 },
    components: [],
    connections: [],
    dirty: false,
  };
}

export async function loadCatalog() {
  state.catalog = await api.catalog();
}

export function specOf(type) {
  return state.catalog?.items?.[type] || null;
}