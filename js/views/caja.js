import { loadTemplate } from "../template-loader.js";
import { currentUser } from "../auth.js";
import { renderEstadoCaja, fmt } from "./caja-estado.js";
import { METODOS_PAGO, registrarVenta, calcularTotal } from "../services/caja-service.js";

// Vista Caja y Ventas: estado de caja + punto de venta
export async function render(root) {
  root.innerHTML = await loadTemplate("caja");
  root.querySelector("#metodo-pago").innerHTML =
    METODOS_PAGO.map((m) => `<option value="${m}">${m}</option>`).join("");

  const pos = root.querySelector("#pos");
  const tbody = root.querySelector("#items");
  const formPago = root.querySelector("#form-pago");
  const msg = root.querySelector("#msg-venta");
  let items = [];

  const estado = renderEstadoCaja(root.querySelector("#caja-estado"), (caja) => {
    pos.classList.toggle("hidden", !caja);
    if (!caja) { items = []; pintarItems(); }
  });

  function pintarItems() {
    tbody.innerHTML = items.map((i, idx) => `
      <tr class="border-t">
        <td>${i.nombre.replace(/</g, "&lt;")}</td><td>${i.cantidad}</td>
        <td>${fmt(i.precio)}</td><td>${fmt(i.cantidad * i.precio)}</td>
        <td><button data-del="${idx}" class="text-red-600">✕</button></td>
      </tr>`).join("");
    root.querySelector("#total").textContent = fmt(calcularTotal(items));
    pintarCambio();
  }

  function pintarCambio() {
    const esEfectivo = formPago.metodo.value === "efectivo";
    root.querySelector("#box-recibido").classList.toggle("hidden", !esEfectivo);
    const cambio = esEfectivo ? Math.max(0, Number(formPago.recibido.value || 0) - calcularTotal(items)) : 0;
    root.querySelector("#cambio").textContent = fmt(cambio);
  }

  root.querySelector("#form-item").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    items.push({ nombre: f.nombre.value.trim(), cantidad: Number(f.cantidad.value), precio: Number(f.precio.value) });
    f.reset(); f.cantidad.value = 1; f.nombre.focus();
    pintarItems();
  });

  tbody.addEventListener("click", (e) => {
    const idx = e.target.dataset.del;
    if (idx !== undefined) { items.splice(Number(idx), 1); pintarItems(); }
  });

  formPago.addEventListener("input", pintarCambio);

  formPago.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "";
    try {
      await registrarVenta({
        cajaId: estado.getCaja().id, items,
        metodoPago: formPago.metodo.value,
        recibido: Number(formPago.recibido.value || 0),
        user: currentUser
      });
      items = []; formPago.reset(); pintarItems();
      msg.textContent = "Venta registrada.";
      msg.className = "text-sm w-full text-green-700";
    } catch (err) {
      msg.textContent = err.message;
      msg.className = "text-sm w-full text-red-600";
    }
  });

  pintarItems();
  return () => estado.destroy();
}
