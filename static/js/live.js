import { getActive, uiState } from "./state.js";
import { api } from "./api.js";
import { renderReadings } from "./readings_display.js";

let timer = null;
let lastHash = "";
let running = false;

export function scheduleLive() {
  clearTimeout(timer);
  timer = setTimeout(() => runLive(false), 250);
}

export async function runLive(force = false) {
  const p = getActive();
  if (!p) return;
  const payload = { ...p };
  delete payload.dirty;

  const h = hashProject(payload);
  if (!force && h === lastHash) return;
  lastHash = h;

  if (running) return;
  running = true;
  try {
    const res = await api.simulate(payload);
    uiState.readings = res.readings || {};
    uiState.warnings = res.warnings || [];
  } catch (e) {
    uiState.readings = {};
    uiState.warnings = [e.payload?.errors?.join("; ") || e.message];
  } finally {
    running = false;
    renderReadings();
  }
}

function hashProject(p) {
  const parts = [];
  for (const c of p.components) {
    parts.push(c.type, JSON.stringify(c.properties), JSON.stringify(c.state));
  }
  for (const w of p.connections) {
    parts.push(w.ends.map((e) => JSON.stringify(e)).join("|"));
  }
  return parts.join("#");
}