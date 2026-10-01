const THEME_KEY = "physics_lab.theme";
const GRID_KEY  = "physics_lab.grid";

export function initTheme() {
  const themeBtn = document.getElementById("btn-theme");
  themeBtn.addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme || "light";
    const next = cur === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    localStorage.setItem(THEME_KEY, next);
  });

  const gridBtn = document.getElementById("btn-grid");
  const savedGrid = localStorage.getItem(GRID_KEY) || "on";
  document.documentElement.dataset.grid = savedGrid;
  gridBtn.addEventListener("click", () => {
    const cur = document.documentElement.dataset.grid === "off" ? "off" : "on";
    const next = cur === "on" ? "off" : "on";
    document.documentElement.dataset.grid = next;
    localStorage.setItem(GRID_KEY, next);
  });
}