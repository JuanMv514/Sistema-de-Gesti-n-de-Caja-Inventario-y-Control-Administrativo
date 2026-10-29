import { loadTemplate } from "./template-loader.js";
import { watchAuth, login, logout, isAdmin } from "./auth.js";
import { initRouter, render, navigate, DEFAULT_ROUTE } from "./router.js";

const appRoot = document.getElementById("app-root");
const nav = document.getElementById("main-nav");

async function showLogin() {
  nav.classList.add("hidden");
  appRoot.innerHTML = await loadTemplate("login");

  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("login-error");
    err.classList.add("hidden");
    try {
      await login(e.target.email.value, e.target.password.value);
    } catch {
      err.textContent = "Credenciales inválidas.";
      err.classList.remove("hidden");
    }
  });
}

function showApp(user) {
  nav.classList.remove("hidden");
  document.getElementById("user-info").textContent = `${user.email} (${user.role})`;
  document.querySelectorAll("[data-role='admin']").forEach(el =>
    el.classList.toggle("hidden", !isAdmin()));
  // Si la URL es la raíz, ir a la vista por defecto
  if (location.pathname === "/") navigate(DEFAULT_ROUTE, true);
  else render();
}

initRouter();
document.getElementById("btn-logout").addEventListener("click", logout);
watchAuth((user) => (user ? showApp(user) : showLogin()));

