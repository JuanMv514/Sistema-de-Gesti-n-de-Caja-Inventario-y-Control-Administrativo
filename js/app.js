import { watchAuth, login, logout, isAdmin } from "./auth.js";
import { initRouter, render, navigate, DEFAULT_ROUTE } from "./router.js";

const appRoot = document.getElementById("app-root");
const nav = document.getElementById("main-nav");

function showLogin() {
  nav.classList.add("hidden");
  appRoot.innerHTML = `
    <form id="login-form" class="max-w-sm mx-auto mt-20 bg-white p-6 rounded shadow space-y-4">
      <h1 class="text-xl font-bold text-center">Vidrios y Aluminios El Carmen</h1>
      <input id="email" type="email" placeholder="Correo" required class="w-full border rounded p-2">
      <input id="password" type="password" placeholder="Contraseña" required class="w-full border rounded p-2">
      <p id="login-error" class="text-red-600 text-sm hidden"></p>
      <button class="w-full bg-blue-600 hover:bg-blue-700 text-white rounded p-2">Ingresar</button>
    </form>`;

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

