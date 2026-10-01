// static/js/tabs.js
import {
  state, addProject, closeProject, setActive, getActive,
  newProjectPayload, uid, markDirty, on,
} from "./state.js";
import { renderAllComponents } from "./component.js";
import { renderAllConnections } from "./connections.js";
import { applyViewport } from "./workspace.js";
import { api } from "./api.js";

const tabsEl = document.getElementById("tabs");

/* ============================================================
 *  Отрисовка вкладок
 * ============================================================ */

export function renderTabs() {
  tabsEl.replaceChildren();
  for (const p of state.projects) {
    const tab = document.createElement("div");
    tab.className =
      "tab" +
      (p.id === state.activeId ? " active" : "") +
      (p.dirty ? " dirty" : "");
    tab.dataset.id = p.id;
    tab.innerHTML = `<span class="title"></span><span class="close">✕</span>`;
    const titleEl = tab.querySelector(".title");
    titleEl.textContent = p.name;

    tab.addEventListener("click", (e) => {
      if (e.target.classList.contains("close")) {
        if (p.dirty && !confirm(`Закрыть «${p.name}» без сохранения?`)) return;
        closeProject(p.id);
      } else {
        setActive(p.id);
      }
    });

    // Двойной клик по названию — быстрое переименование
    titleEl.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      promptRename(p);
    });

    // ПКМ — контекстное меню вкладки
    tab.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openTabMenu(e.clientX, e.clientY, p);
    });

    tabsEl.appendChild(tab);
  }
}

export function activateCurrent() {
  applyViewport();
  renderAllComponents();
  renderAllConnections();
}

export function initTabsUI() {
  document.getElementById("btn-new-project")
    .addEventListener("click", () => addProject(newProjectPayload()));
  document.getElementById("btn-open-project")
    .addEventListener("click", openProjectDialog);
  document.getElementById("btn-save-project")
    .addEventListener("click", saveCurrent);
}

/* ============================================================
 *  Переименование / дублирование / удаление
 * ============================================================ */

function promptRename(project) {
  const name = prompt("Новое название проекта:", project.name);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed || trimmed === project.name) return;
  project.name = trimmed;
  markDirty(project);
  renderTabs();
}

async function saveAsCopy(project) {
  const suggested = `${project.name} (копия)`;
  const name = prompt("Название копии:", suggested);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return;

  const payload = {
    ...project,
    id: uid("prj"),
    name: trimmed,
    created: new Date().toISOString(),
    modified: "",
  };
  delete payload.dirty;

  const saved = await api.saveProject(payload.id, payload);
  saved.dirty = false;
  addProject(saved);
}

async function deleteProjectTab(project) {
  if (!confirm(`Удалить проект «${project.name}»?\nЭто действие нельзя отменить.`)) return;
  try {
    await api.deleteProject(project.id);
  } catch {
    /* если на сервере файла нет — не страшно, всё равно закрываем вкладку */
  }
  closeProject(project.id);
}

/* ============================================================
 *  Меню вкладки
 * ============================================================ */

let menuEl = null;

function ensureMenu() {
  if (menuEl) return menuEl;
  menuEl = document.createElement("div");
  menuEl.id = "tab-menu";
  menuEl.hidden = true;
  document.body.appendChild(menuEl);

  document.addEventListener("pointerdown", (e) => {
    if (!menuEl.hidden && !menuEl.contains(e.target)) menuEl.hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") menuEl.hidden = true;
  });
  return menuEl;
}

function openTabMenu(clientX, clientY, project) {
  const menu = ensureMenu();
  menu.replaceChildren();

  const item = (label, action, opts = {}) => {
    const el = document.createElement("div");
    el.className = "tab-menu-item"
      + (opts.danger ? " danger" : "")
      + (opts.disabled ? " disabled" : "");
    el.textContent = label;
    if (!opts.disabled) {
      el.addEventListener("click", () => {
        menu.hidden = true;
        action();
      });
    }
    menu.appendChild(el);
  };
  const sep = () => {
    const s = document.createElement("div");
    s.className = "tab-menu-sep";
    menu.appendChild(s);
  };

  item("Переименовать", () => promptRename(project));
  item("Дублировать (сохранить как…)", () => saveAsCopy(project));
  item("Сохранить сейчас", async () => {
    setActive(project.id);
    await saveCurrent();
  }, { disabled: !project.dirty });
  sep();
  item("Удалить проект", () => deleteProjectTab(project), { danger: true });
  item("Закрыть вкладку", () => {
    if (project.dirty && !confirm(`Закрыть «${project.name}» без сохранения?`)) return;
    closeProject(project.id);
  });

  menu.hidden = false;
  menu.style.left = "0px";
  menu.style.top = "0px";
  const rect = menu.getBoundingClientRect();
  const x = Math.min(clientX, window.innerWidth - rect.width - 4);
  const y = Math.min(clientY, window.innerHeight - rect.height - 4);
  menu.style.left = x + "px";
  menu.style.top = y + "px";
}

/* ============================================================
 *  Открытие / сохранение через API
 * ============================================================ */

async function openProjectDialog() {
  const list = await api.listProjects();
  if (!list.length) { alert("Нет сохранённых проектов"); return; }
  const names = list.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
  const choice = prompt("Введите номер проекта для открытия:\n" + names);
  const idx = parseInt(choice, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= list.length) return;
  const project = await api.getProject(list[idx].id);
  project.dirty = false;
  addProject(project);
}

export async function saveCurrent() {
  const p = getActive();
  if (!p) return;
  const payload = { ...p };
  delete payload.dirty;
  const saved = await api.saveProject(p.id, payload);
  Object.assign(p, saved);
  p.dirty = false;
  renderTabs();
}