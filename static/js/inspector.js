// static/js/inspector.js
import { getActive, markDirty, specOf } from "./state.js";
import { describeSelection } from "./selection.js";
import { renderAllComponents } from "./component.js";
import { renderAllConnections, rerouteConnectionsOfComponent } from "./connections.js";
import {
  deleteComponent, deleteConnection, deleteSelection, rotateSelection,
} from "./operations.js";
import { pushHistory } from "./history.js";

const host = document.getElementById("inspector");

export function renderInspector() {
  host.replaceChildren();
  const p = getActive();
  if (!p) { host.innerHTML = `<div class="empty">Нет активного проекта</div>`; return; }

  const { comps, conns } = describeSelection(p);
  if (comps.length + conns.length === 0) {
    host.innerHTML = `<div class="empty">Ничего не выбрано</div>`;
    return;
  }
  if (comps.length + conns.length > 1) {
    host.appendChild(buildMultiInspector(p, comps, conns));
    return;
  }
  if (comps.length === 1) host.appendChild(buildComponentInspector(p, comps[0]));
  else host.appendChild(buildConnectionInspector(p, conns[0]));
}

/* ============================================================
 *  Мультивыделение
 * ============================================================ */

function buildMultiInspector(project, comps, conns) {
  const root = document.createElement("div");
  root.className = "inspector";
  const t = document.createElement("div");
  t.className = "title";
  t.textContent = `Выделено: ${comps.length} комп., ${conns.length} соед.`;
  root.appendChild(t);

  const actions = document.createElement("div");
  actions.className = "actions";
  const rot = document.createElement("button");
  rot.textContent = "Повернуть 90°";
  rot.disabled = comps.length === 0;
  rot.addEventListener("click", () => rotateSelection(project, 90));
  const del = document.createElement("button");
  del.className = "danger";
  del.textContent = "Удалить всё";
  del.addEventListener("click", () => deleteSelection(project));
  actions.append(rot, del);
  root.appendChild(actions);
  return root;
}

/* ============================================================
 *  Компонент
 * ============================================================ */

function buildComponentInspector(project, comp) {
  const spec = specOf(comp.type);
  const root = document.createElement("div");
  root.className = "inspector";

  const head = document.createElement("div");
  head.innerHTML = `<div class="title"></div><div class="subtitle"></div>`;
  head.querySelector(".title").textContent = spec.label;
  head.querySelector(".subtitle").textContent = comp.id;
  root.appendChild(head);

  root.appendChild(section("Позиция", [
    fieldNumber("X", comp.position.x, (v) => { comp.position.x = v; onGeometryChanged(project, comp); }),
    fieldNumber("Y", comp.position.y, (v) => { comp.position.y = v; onGeometryChanged(project, comp); }),
  ]));

  root.appendChild(section("Поворот", [
    fieldSelect("Угол, °", comp.rotation || 0, [0, 90, 180, 270], (v) => {
      comp.rotation = +v; onGeometryChanged(project, comp);
    }),
  ]));

  if (spec.properties?.length) {
    const rows = spec.properties.map((prop) =>
      fieldFromSpec(prop, comp.properties[prop.id], (v) => {
        comp.properties[prop.id] = v;
        markDirty(project);
        renderAllComponents();
      })
    );
    root.appendChild(section("Свойства", rows));
  }

  if (spec.state?.length) {
    const rows = spec.state.map((st) =>
      fieldFromSpec(st, comp.state[st.id], (v) => {
        comp.state[st.id] = v;
        markDirty(project);
        renderAllComponents();
        renderAllConnections();
      })
    );
    root.appendChild(section("Состояние", rows));
  }

  // --- Стиль ---
  const styleRows = [
    fieldColor("Фон",          comp.style?.background, "#ffffff", (v) => {
      comp.style = comp.style || {}; comp.style.background = v;
      markDirty(project); renderAllComponents();
    }),
    fieldColor("Цвет текста",  comp.style?.textColor,  "#1e2530", (v) => {
      comp.style = comp.style || {}; comp.style.textColor = v;
      markDirty(project); renderAllComponents();
    }),
    fieldSelectFree(
      "Шрифт",
      comp.style?.fontFamily,
      "system-ui",
      [
        "system-ui",
        "Arial",
        "Times New Roman",
        "Courier New",
        "Georgia",
        "Verdana",
      ],
      (v) => {
        comp.style = comp.style || {}; comp.style.fontFamily = v;
        markDirty(project); renderAllComponents();
      }
    ),
    fieldNumber("Размер шрифта", comp.style?.fontSize ?? 11, (v) => {
      comp.style = comp.style || {}; comp.style.fontSize = Math.max(6, Math.min(48, v));
      markDirty(project); renderAllComponents();
    }),
  ];

  const styleSection = section("Стиль", styleRows);

  const resetBtn = document.createElement("button");
  resetBtn.textContent = "Сбросить стиль";
  resetBtn.style.marginTop = "6px";
  resetBtn.style.width = "100%";
  resetBtn.style.padding = "4px 8px";
  resetBtn.style.border = "1px solid var(--border)";
  resetBtn.style.background = "var(--panel-2)";
  resetBtn.style.color = "var(--text)";
  resetBtn.style.borderRadius = "4px";
  resetBtn.style.cursor = "pointer";
  resetBtn.style.font = "inherit";
  resetBtn.style.fontSize = "12px";
  resetBtn.addEventListener("click", () => {
    pushHistory(project, "reset style");
    comp.style = {};
    markDirty(project);
    renderAllComponents();
    renderInspector();
  });
  styleSection.appendChild(resetBtn);

  root.appendChild(styleSection);

  // --- Действия ---
  const actions = document.createElement("div");
  actions.className = "actions";
  const del = document.createElement("button");
  del.className = "danger";
  del.textContent = "Удалить";
  del.addEventListener("click", () => deleteComponent(project, comp.id));
  actions.appendChild(del);
  root.appendChild(actions);

  return root;
}

function onGeometryChanged(project, comp) {
  markDirty(project);
  renderAllComponents();
  rerouteConnectionsOfComponent(project, comp);
}

/* ============================================================
 *  Соединение
 * ============================================================ */

function buildConnectionInspector(project, conn) {
  const root = document.createElement("div");
  root.className = "inspector";

  const head = document.createElement("div");
  head.innerHTML = `<div class="title">Соединение</div><div class="subtitle"></div>`;
  head.querySelector(".subtitle").textContent = conn.id;
  root.appendChild(head);

  const info = document.createElement("div");
  info.className = "info";
  info.textContent = conn.ends.map((e) => describeEnd(e, project)).join("  ↔  ");
  root.appendChild(info);

  const colorRow = document.createElement("label");
  colorRow.className = "field";
  colorRow.innerHTML = `<span>Цвет линии</span>`;
  const color = document.createElement("input");
  color.type = "color";
  color.value = conn.color || "#222222";
  color.addEventListener("change", () => {
    conn.color = color.value;
    markDirty(project);
    renderAllConnections();
  });
  colorRow.appendChild(color);
  root.appendChild(colorRow);

  const actions = document.createElement("div");
  actions.className = "actions";
  const del = document.createElement("button");
  del.className = "danger";
  del.textContent = "Удалить";
  del.addEventListener("click", () => deleteConnection(project, conn.id));
  actions.appendChild(del);
  root.appendChild(actions);

  return root;
}

function describeEnd(e, project) {
  if (e.kind === "terminal") {
    const c = project.components.find((x) => x.id === e.component_id);
    const spec = c ? specOf(c.type) : null;
    const t = spec?.terminals.find((x) => x.id === e.terminal_id);
    return `${spec?.label || "?"} · ${t?.label || e.terminal_id}`;
  }
  if (e.kind === "free") return "свободный";
  return `→ провод ${String(e.connection_id).slice(-4)}`;
}

/* ============================================================
 *  Хелперы формы
 * ============================================================ */

function section(title, rows) {
  const s = document.createElement("div");
  s.className = "section";
  const h = document.createElement("div");
  h.className = "section-title";
  h.textContent = title;
  s.appendChild(h);
  for (const r of rows) s.appendChild(r);
  return s;
}

function fieldNumber(label, value, onChange) {
  const row = document.createElement("label");
  row.className = "field";
  const span = document.createElement("span");
  span.textContent = label;
  row.appendChild(span);
  const input = document.createElement("input");
  input.type = "number";
  input.step = "any";
  input.value = value ?? 0;
  input.addEventListener("change", () => {
    let v = parseFloat(input.value);
    if (isNaN(v)) v = value ?? 0;
    input.value = v;
    onChange(v);
  });
  row.appendChild(input);
  return row;
}

/* ------------------------------------------------------------------
 *  Универсальный <select>. Поддерживает два формата options:
 *    1) массив строк/чисел: ["A", "B", ...]
 *    2) массив объектов:   [{value, label?, color?, edge?}, ...]
 *
 *  Если у объекта есть color — опция раскрашивается фоном и перед
 *  названием ставится символ ●; текст подбирается контрастным.
 * ------------------------------------------------------------------ */
function fieldSelect(label, value, options, onChange) {
  const row = document.createElement("label");
  row.className = "field";
  const span = document.createElement("span");
  span.textContent = label;
  row.appendChild(span);

  const select = document.createElement("select");

  const normalized = (options || []).map((o) => {
    if (typeof o === "object" && o !== null) {
      return {
        value: o.value,
        label: o.label ?? String(o.value),
        color: o.color,
        edge:  o.edge,
      };
    }
    return { value: o, label: String(o) };
  });

  for (const o of normalized) {
    const opt = document.createElement("option");
    opt.value = String(o.value);

    if (o.color) {
      // Символ-маркер + текст. Фон опции — сам цвет; цвет текста —
      // контрастный (белый/чёрный) или edge, если он есть.
      opt.textContent = `● ${o.label}`;
      opt.style.backgroundColor = o.color;
      opt.style.color = o.edge || contrastText(o.color);
    } else {
      opt.textContent = o.label;
    }
    if (String(o.value) === String(value)) opt.selected = true;
    select.appendChild(opt);
  }

  select.addEventListener("change", () => onChange(select.value));
  row.appendChild(select);
  return row;
}

function contrastText(hex) {
  const h = hex.replace("#", "");
  if (h.length !== 6) return "#000";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? "#000" : "#fff";
}

/** Select со свободным вводом: значение не из списка добавляется отдельной опцией. */
function fieldSelectFree(label, value, fallback, options, onChange) {
  const row = document.createElement("label");
  row.className = "field";
  const span = document.createElement("span");
  span.textContent = label;
  row.appendChild(span);

  const select = document.createElement("select");
  const current = value || fallback;

  const seen = new Set();
  const push = (v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    if (v === current) opt.selected = true;
    select.appendChild(opt);
    seen.add(v);
  };
  if (!options.includes(current)) push(current);
  for (const o of options) if (!seen.has(o)) push(o);

  select.addEventListener("change", () => onChange(select.value));
  row.appendChild(select);
  return row;
}

function fieldColor(label, value, fallback, onChange) {
  const row = document.createElement("label");
  row.className = "field";
  const span = document.createElement("span");
  span.textContent = label;
  row.appendChild(span);
  const input = document.createElement("input");
  input.type = "color";
  input.value = normalizeHex(value || fallback);
  input.addEventListener("change", () => onChange(input.value));
  row.appendChild(input);
  return row;
}

function normalizeHex(v) {
  if (!v) return "#000000";
  if (v.startsWith("#")) {
    if (v.length === 4) {
      return "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    }
    if (v.length === 7) return v;
  }
  return "#000000";
}

function fieldFromSpec(spec, value, onChange) {
  if (spec.type === "bool") {
    const row = document.createElement("label");
    row.className = "field checkbox";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!value;
    input.addEventListener("change", () => onChange(input.checked));
    row.appendChild(input);
    const span = document.createElement("span");
    span.textContent = spec.label;
    row.appendChild(span);
    return row;
  }
  if (spec.type === "select") {
    return fieldSelect(spec.label, value, spec.options || [], onChange);
  }

  const row = document.createElement("label");
  row.className = "field";
  const span = document.createElement("span");
  span.textContent = spec.unit ? `${spec.label}, ${spec.unit}` : spec.label;
  row.appendChild(span);

  const input = document.createElement("input");
  input.type = "number";
  input.step = spec.type === "int" ? "1" : "any";
  if (spec.min !== undefined) input.min = spec.min;
  if (spec.max !== undefined) input.max = spec.max;
  input.value = value ?? spec.default ?? 0;
  input.addEventListener("change", () => {
    let v = parseFloat(input.value);
    if (isNaN(v)) v = spec.default ?? 0;
    if (spec.type === "int") v = Math.round(v);
    if (spec.min !== undefined && v < spec.min) v = spec.min;
    if (spec.max !== undefined && v > spec.max) v = spec.max;
    input.value = v;
    onChange(v);
  });
  row.appendChild(input);
  return row;
}