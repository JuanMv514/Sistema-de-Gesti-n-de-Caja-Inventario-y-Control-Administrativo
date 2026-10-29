// Controlador principal del SPA:
// - Alterna entre #login-view y #dashboard-view sin recargar la página.
// - Registra los controladores de vistas (Dashboard, Caja y Ventas, Inventario, Contabilidad, Reportes).
// - Gestiona roles, permisos de ruta, modales e impresión.

import {
  navigateTo,
  resolveRouteKey,
  getRouteFromLocation,
  registerView,
  DEFAULT_ROUTE
} from "./router.js";
import { getCurrentUser, setCurrentUser, ROLES, hasPermission } from "./auth.js";
import { ensureSeedData } from "./services/store.js";
import { mountCajaView } from "./views/caja-view.js";
import {
  mountInventarioView,
  mountContabilidadView,
  mountDashboardView,
  mountReportesView
} from "./views/other-views.js";

// Registrar los controladores reactivos de cada módulo en el router
registerView("dashboard", mountDashboardView);
registerView("caja", mountCajaView);
registerView("inventario", mountInventarioView);
registerView("contabilidad", mountContabilidadView);
registerView("reportes", mountReportesView);

const loginView = document.getElementById("login-view");
const dashboardView = document.getElementById("dashboard-view");
const loginForm = document.getElementById("login-form");

function hasActiveSession() {
  try {
    return Boolean(sessionStorage.getItem("elcarmen_spa_session"));
  } catch {
    return false;
  }
}

export function showLoginView() {
  if (!loginView || !dashboardView) {
    window.location.href = "../index.html";
    return;
  }
  dashboardView.classList.add("hidden");
  loginView.classList.remove("hidden");
  document.title = "Iniciar sesión | Vidrios y Aluminios El Carmen";
  window.history.replaceState({}, "", window.location.pathname);
}

export async function showDashboardView(user, initialRoute) {
  if (loginView && dashboardView) {
    loginView.classList.add("hidden");
    dashboardView.classList.remove("hidden");
  }

  const nameEl = document.getElementById("user-name");
  const roleEl = document.getElementById("user-role");
  if (user && nameEl) nameEl.textContent = user.name;
  if (user && roleEl) roleEl.textContent = `Rol: ${user.role}`;

  // Ocultar módulos exclusivos de Administrador si el usuario es Empleado
  document.querySelectorAll("[data-role='admin']").forEach((el) => {
    el.classList.toggle("hidden", !hasPermission("usuarios.gestionar", user));
  });

  const target = initialRoute || getRouteFromLocation() || DEFAULT_ROUTE;
  await navigateTo(target, { replace: true });
}

function closeAllModals() {
  document.querySelectorAll(".modal-overlay.is-open").forEach((m) => m.classList.remove("is-open"));
}

function setupEventDelegation() {
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = (loginForm.email?.value || "admin@elcarmen.com").trim().toLowerCase();
      const isEmpleado = email.startsWith("empleado") || email.startsWith("caja") || email.startsWith("bodega");
      const role = isEmpleado ? ROLES.EMPLEADO : ROLES.ADMIN;
      const rawName = email.split("@")[0] || "Administrador";
      const user = {
        uid: `usr-${rawName}`,
        email,
        name: rawName.charAt(0).toUpperCase() + rawName.slice(1),
        role
      };
      setCurrentUser(user);
      await showDashboardView(user, DEFAULT_ROUTE);
    });
  }

  document.addEventListener("click", async (e) => {
    const printBtn = e.target.closest("#btn-imprimir");
    if (printBtn) {
      e.preventDefault();
      window.print();
      return;
    }

    if (e.target.classList.contains("modal-overlay")) {
      e.target.classList.remove("is-open");
      return;
    }

    const link = e.target.closest("a, button[data-route]");
    if (!link) return;

    if (link.classList.contains("logout")) {
      e.preventDefault();
      setCurrentUser(null);
      showLoginView();
      return;
    }

    const href = link.getAttribute("href") || "";

    if (href.startsWith("#modal-")) {
      const modal = document.querySelector(href);
      if (modal) {
        e.preventDefault();
        modal.classList.add("is-open");
      }
      return;
    }

    if (href === "#" && link.closest(".modal-overlay")) {
      e.preventDefault();
      link.closest(".modal-overlay").classList.remove("is-open");
      return;
    }

    if (link.closest("#login-form")) {
      e.preventDefault();
      if (loginForm) loginForm.requestSubmit();
      return;
    }

    const routeKey = link.dataset.route || resolveRouteKey(href);
    if (routeKey) {
      e.preventDefault();
      closeAllModals();
      await navigateTo(routeKey);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllModals();
  });

  window.addEventListener("popstate", (e) => {
    const routeKey = e.state?.route || getRouteFromLocation();
    if (routeKey) navigateTo(routeKey, { updateHistory: false });
  });
}

function initApp() {
  ensureSeedData();
  setupEventDelegation();

  if (loginView && dashboardView) {
    const hasRouteHash = window.location.hash.startsWith("#/");
    if (hasActiveSession() || hasRouteHash) {
      const user = getCurrentUser();
      setCurrentUser(user);
      showDashboardView(user, getRouteFromLocation());
    } else {
      showLoginView();
    }
    return;
  }

  // Si se abre directamente un archivo html/<modulo>.html
  const user = getCurrentUser();
  setCurrentUser(user);
  navigateTo(getRouteFromLocation(), { replace: true, updateHistory: false });
}

initApp();
