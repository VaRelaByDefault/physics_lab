import { state, on } from "./state.js";

const KEY = "physics_lab.tabs.v1";
const DEBOUNCE = 400;

let timer = null;

function snapshot() {
  return {
    version: 1,
    activeId: state.activeId,
    projects: state.projects.map((p) => {
      const { dirty, ...rest } = p;
      return { project: rest, dirty: !!dirty };
    }),
  };
}

export function schedulePersist() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(snapshot())); }
    catch (e) { console.warn("Не удалось сохранить сессию:", e); }
  }, DEBOUNCE);
}

export function restore() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.version !== 1) return null;
    return data;
  } catch { return null; }
}

export function initPersist() {
  on("projects", schedulePersist);
  on("active", schedulePersist);
  on("dirty", schedulePersist);
  window.addEventListener("beforeunload", () => {
    try { localStorage.setItem(KEY, JSON.stringify(snapshot())); } catch {}
  });
}