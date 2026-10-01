import { specOf } from "./state.js";
import { terminalWorldPos } from "./svg_utils.js";

export function findNearestTerminal(worldPos, project, radius = 15) {
  let best = null, bestD = radius;
  for (const c of project.components) {
    const spec = specOf(c.type);
    if (!spec) continue;
    for (const t of spec.terminals) {
      const pos = terminalWorldPos(c, t);
      const d = Math.hypot(pos.x - worldPos.x, pos.y - worldPos.y);
      if (d < bestD) {
        bestD = d;
        best = {
          kind: "terminal",
          component_id: c.id,
          terminal_id: t.id,
          pos,
        };
      }
    }
  }
  return best;
}