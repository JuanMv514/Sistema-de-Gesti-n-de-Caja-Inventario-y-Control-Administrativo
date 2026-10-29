import { currentUser, isAdmin } from "./auth.js";

const appRoot = document.getElementById("app-root");

// Tabla de rutas: path -> { load: () => import(vista), admin?: true }
const routes = {
  "/caja":         { load: () => import("./views/caja.js") },
  "/inventario":   { load: () => import("./views/inventario.js") },
  "/contabilidad": { load: () => import("./views/contabilidad.js") },
  "/reportes":     { load: () => import("./views/reportes.js") },
  "/usuarios":     { load: () => import("./views/usuarios.js"), admin: true }
};
export const DEFAULT_ROUTE = "/caja";

let cleanup = null; // para cancelar listeners onSnapshot de la vista anterior

export function navigate(path, replace = false) {
  history[replace ? "replaceState" : "pushState"]({}, "", path);
  render();
}

export async function render() {
  if (typeof cleanup === "function") { cleanup(); cleanup = null; }

  // Route guard: sin sesión no hay vistas internas
  if (!currentUser) return;

  const path = location.pathname;
  const route = routes[path];
  if (!route) return navigate(DEFAULT_ROUTE, true);
  if (route.admin && !isAdmin()) return navigate(DEFAULT_ROUTE, true);

  appRoot.innerHTML = "";
  const view = await route.load();
  cleanup = await view.render(appRoot);

  document.querySelectorAll("[data-link]").forEach(a =>
    a.classList.toggle("active", a.getAttribute("href") === path));
}

// Intercepta clics del menú sin recargar la página
export function initRouter() {
  document.addEventListener("click", (e) => {
    const link = e.target.closest("[data-link]");
    if (!link) return;
    e.preventDefault();
    navigate(link.getAttribute("href"));
  });
  window.addEventListener("popstate", render);
}

