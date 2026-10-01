import { markDirty, uid } from "./state.js";
import { pushHistory } from "./history.js";
import { getSelectedComponents, selectComponent, clearSelection } from "./selection.js";
import { renderAllComponents } from "./component.js";
import { renderAllConnections } from "./connections.js";
import { scheduleLive } from "./live.js";

let clipboard = null;
export function hasClipboard() { return clipboard !== null; }

export function copySelection(project) {
  const ids = [...getSelectedComponents()];
  if (!ids.length) return;
  clipboard = {
    components: ids
      .map((id) => project.components.find((c) => c.id === id))
      .filter(Boolean)
      .map((c) => structuredClone(c)),
    connections: [],
    pasteCount: 0,
  };
}

export function duplicateSelection(project) {
  copySelection(project);
  pasteClipboard(project);
}

export function pasteClipboard(project) {
  if (!clipboard) return;
  const offset = 20 * (clipboard.pasteCount + 1);
  clipboard.pasteCount++;
  pushHistory(project, "paste");

  const idMap = new Map();
  const newComps = clipboard.components.map((c) => {
    const newId = uid("c");
    idMap.set(c.id, newId);
    return {
      ...structuredClone(c),
      id: newId,
      position: { x: c.position.x + offset, y: c.position.y + offset },
    };
  });
  project.components.push(...newComps);
  markDirty(project);
  renderAllComponents(); renderAllConnections(); scheduleLive();
  clearSelection();
  for (const c of newComps) selectComponent(c.id, true);
}