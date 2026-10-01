// static/js/nodes.js
import { specOf } from "./state.js";

/** Множество занятых терминалов узла (на основе уже существующих соединений). */
export function usedJunctionTerminals(project, junctionId) {
  const used = new Set();
  for (const conn of project.connections) {
    for (const end of conn.ends) {
      if (end.kind === "terminal" && end.component_id === junctionId) {
        used.add(end.terminal_id);
      }
    }
  }
  return used;
}

/**
 * Выбирает свободный порт узла, направление которого лучше всего
 * соответствует вектору к targetPos.
 *
 * Логика:
 *   1. Если |dx| > |dy| — горизонтальная ось доминирует, предпочтение e/w.
 *   2. Иначе — вертикальная ось доминирует, предпочтение n/s.
 *   3. Среди двух портов выбранной оси берётся тот, что смотрит по знаку
 *      к цели.
 *
 * @param extraReserved — Set<string> вида "junctionId/termId", чтобы
 *   не выбрать один порт дважды в рамках одной операции.
 * @returns "n" | "e" | "s" | "w" | null
 */
export function pickJunctionTerminal(project, junctionId, targetPos, extraReserved = new Set()) {
  const comp = project.components.find((c) => c.id === junctionId);
  if (!comp) return null;
  const spec = specOf(comp.type);
  if (!spec) return null;

  const jPos = {
    x: comp.position.x + spec.size[0] / 2,
    y: comp.position.y + spec.size[1] / 2,
  };

  const used = usedJunctionTerminals(project, junctionId);

  const free = (id) => !used.has(id) && !extraReserved.has(`${junctionId}/${id}`);

  const dx = targetPos.x - jPos.x;
  const dy = targetPos.y - jPos.y;

  // Приоритет оси: что преобладает в направлении к цели.
  if (Math.abs(dx) > Math.abs(dy)) {
    const first  = dx >= 0 ? "e" : "w";
    const second = dx >= 0 ? "w" : "e";
    if (free(first)) return first;
    if (free(second)) return second;
    const vFirst  = dy >= 0 ? "s" : "n";
    const vSecond = dy >= 0 ? "n" : "s";
    if (free(vFirst)) return vFirst;
    if (free(vSecond)) return vSecond;
    return null;
  } else {
    const first  = dy >= 0 ? "s" : "n";
    const second = dy >= 0 ? "n" : "s";
    if (free(first)) return first;
    if (free(second)) return second;
    const hFirst  = dx >= 0 ? "e" : "w";
    const hSecond = dx >= 0 ? "w" : "e";
    if (free(hFirst)) return hFirst;
    if (free(hSecond)) return hSecond;
    return null;
  }
}