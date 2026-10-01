const MAX_DEPTH = 100;
const stacks = new Map();
const pending = new Map();

function getStack(project) {
  if (!stacks.has(project.id)) stacks.set(project.id, { undo: [], redo: [] });
  return stacks.get(project.id);
}
function snap(project) {
  return {
    components: structuredClone(project.components),
    connections: structuredClone(project.connections),
  };
}
function apply(project, s) {
  project.components = structuredClone(s.components);
  project.connections = structuredClone(s.connections);
}

const listeners = [];
export function onHistoryChange(fn) { listeners.push(fn); }
function notify() { listeners.forEach((fn) => fn()); }

export function pushHistory(project, description = "") {
  const s = getStack(project);
  s.undo.push({ description, state: snap(project) });
  if (s.undo.length > MAX_DEPTH) s.undo.shift();
  s.redo.length = 0;
  notify();
}
export function beginTransaction(project) { pending.set(project.id, snap(project)); }
export function commitTransaction(project, description = "") {
  const s0 = pending.get(project.id);
  if (!s0) return;
  pending.delete(project.id);
  const s = getStack(project);
  s.undo.push({ description, state: s0 });
  if (s.undo.length > MAX_DEPTH) s.undo.shift();
  s.redo.length = 0;
  notify();
}
export function rollbackTransaction(project) { pending.delete(project.id); }
export function undo(project) {
  const s = getStack(project);
  if (!s.undo.length) return false;
  const entry = s.undo.pop();
  s.redo.push({ description: entry.description, state: snap(project) });
  apply(project, entry.state);
  notify();
  return true;
}
export function redo(project) {
  const s = getStack(project);
  if (!s.redo.length) return false;
  const entry = s.redo.pop();
  s.undo.push({ description: entry.description, state: snap(project) });
  apply(project, entry.state);
  notify();
  return true;
}
export function canUndo(project) { return (stacks.get(project.id)?.undo.length || 0) > 0; }
export function canRedo(project) { return (stacks.get(project.id)?.redo.length || 0) > 0; }
export function clearHistory(project) {
  stacks.delete(project.id);
  pending.delete(project.id);
  notify();
}