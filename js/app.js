// Controlador principal del SPA:
// - Alterna entre #login-view y #dashboard-view sin recargar la página.
// - Intercepta todos los enlaces a módulos (menú lateral, botones de acceso rápido, tarjetas).
// - Gestiona la apertura/cierre de modales y el botón de impresión sin romper la ruta activa.

import { navigateTo, resolveRouteKey, getRouteFromLocation, DEFAULT_ROUTE } from "./router.js";

const SESSION_KEY = "elcarmen_spa_session";

const loginView = document.getElementById("login-view");
const dashboardView = document.getElementById("dashboard-view");
const loginForm = document.getElementById("login-form");

function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setSession(user) {
  try {
    if (user) sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignorar si sessionStorage no está disponible
  }
}

// Muestra #login-view y oculta #dashboard-view
export function showLoginView() {
  if (!loginView || !dashboardView) {
    // Si estamos en html/<modulo>.html sin #login-view, volver a index.html
    window.location.href = "../index.html";
    return;
  }
  dashboardView.classList.add("hidden");
  loginView.classList.remove("hidden");
  document.title = "Iniciar sesión | Vidrios y Aluminios El Carmen";
  window.history.replaceState({}, "", window.location.pathname);
}

// Oculta #login-view, muestra #dashboard-view y carga el módulo correspondiente
export async function showDashboardView(user, initialRoute) {
  if (loginView && dashboardView) {
    loginView.classList.add("hidden");
    dashboardView.classList.remove("hidden");
  }

  const nameEl = document.getElementById("user-name");
  const roleEl = document.getElementById("user-role");
  if (user && nameEl) nameEl.textContent = user.name;
  if (user && roleEl) roleEl.textContent = `Rol: ${user.role}`;

  const target = initialRoute || getRouteFromLocation() || DEFAULT_ROUTE;
  await navigateTo(target, { replace: true });
}

function closeAllModals() {
  document.querySelectorAll(".modal-overlay.is-open").forEach((m) => m.classList.remove("is-open"));
}

function setupEventDelegation() {
  // 1. Envío del formulario de Login
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = loginForm.email?.value?.trim() || "admin@elcarmen.com";
      const name = email.split("@")[0] || "Administrador";
      const user = { email, name: name.charAt(0).toUpperCase() + name.slice(1), role: "Administrador" };
      setSession(user);
      await showDashboardView(user, DEFAULT_ROUTE);
    });
  }

  // 2. Delegación global de clics (navegación SPA, modales, logout e impresión)
  document.addEventListener("click", async (e) => {
    // Botón de imprimir en Reportes
    const printBtn = e.target.closest("#btn-imprimir");
    if (printBtn) {
      e.preventDefault();
      window.print();
      return;
    }

    // Cerrar modal haciendo clic en el fondo oscuro
    if (e.target.classList.contains("modal-overlay")) {
      e.target.classList.remove("is-open");
      return;
    }

    const link = e.target.closest("a, button[data-route]");
    if (!link) return;

    // Botón de cerrar sesión (.logout)
    if (link.classList.contains("logout")) {
      e.preventDefault();
      setSession(null);
      showLoginView();
      return;
    }

    const href = link.getAttribute("href") || "";

    // Apertura de modales (#modal-cierre, #modal-producto, #modal-usuario) sin ensuciar el hash del router
    if (href.startsWith("#modal-")) {
      const modal = document.querySelector(href);
      if (modal) {
        e.preventDefault();
        modal.classList.add("is-open");
      }
      return;
    }

    // Cierre de modales (href="#" dentro de un modal)
    if (href === "#" && link.closest(".modal-overlay")) {
      e.preventDefault();
      link.closest(".modal-overlay").classList.remove("is-open");
      return;
    }

    // Botón de ingreso en login si fuera un <a>
    if (link.closest("#login-form")) {
      e.preventDefault();
      if (loginForm) loginForm.requestSubmit();
      return;
    }

    // Enlaces a módulos (menú lateral, tarjetas de pilares, botones de acceso rápido)
    const routeKey = link.dataset.route || resolveRouteKey(href);
    if (routeKey) {
      e.preventDefault();
      closeAllModals();
      await navigateTo(routeKey);
    }
  });

  // Cerrar modales con tecla Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllModals();
  });

  // Botón Atrás / Adelante del navegador
  window.addEventListener("popstate", (e) => {
    const routeKey = e.state?.route || getRouteFromLocation();
    if (routeKey) navigateTo(routeKey, { updateHistory: false });
  });
}

// Inicialización al cargar el DOM
function initApp() {
  setupEventDelegation();

  // Si estamos en index.html (contiene #login-view y #dashboard-view)
  if (loginView && dashboardView) {
    const session = getSession();
    const hasRouteHash = window.location.hash.startsWith("#/");
    if (session || hasRouteHash) {
      showDashboardView(session || { name: "Administrador", role: "Administrador" }, getRouteFromLocation());
    } else {
      showLoginView();
    }
    return;
  }

  // Si se abrió directamente html/<modulo>.html, activar navegación SPA sobre ese contenedor
  navigateTo(getRouteFromLocation(), { replace: true, updateHistory: false });
}

initApp();
