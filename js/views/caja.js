import { currentUser } from "../auth.js";
import { renderEstadoCaja, fmt } from "./caja-estado.js";
import { METODOS_PAGO, registrarVenta, calcularTotal } from "../services/caja-service.js";

// Vista Caja y Ventas: estado de caja + punto de venta
export async function render(root) {
  root.innerHTML = `
    <div class="space-y-4">
      <div id="caja-estado"></div>
      <section id="pos" class="bg-white p-4 rounded shadow space-y-3 hidden">
        <h2 class="text-lg font-bold">Nueva venta</h2>
        <form id="form-item" class="grid grid-cols-12 gap-2">
          <input name="nombre" placeholder="Producto" required class="col-span-12 md:col-span-6 border rounded p-2">
          <input name="cantidad" type="number" min="0.01" step="any" value="1" required class="col-span-5 md:col-span-2 border rounded p-2">
          <input name="precio" type="number" min="0" step="any" placeholder="Precio" required class="col-span-7 md:col-span-2 border rounded p-2">
          <button class="col-span-12 md:col-span-2 bg-blue-600 hover:bg-blue-700 text-white rounded p-2">Agregar</button>
        </form>
        <table class="w-full text-sm">
          <thead class="text-left text-slate-500"><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th><th></th></tr></thead>
          <tbody id="items"></tbody>
        </table>
        <p class="text-right text-xl font-bold">Total: <span id="total">$0</span></p>
        <form id="form-pago" class="flex flex-wrap items-end gap-3 border-t pt-3">
          <div>
            <label class="text-sm text-slate-500">Método de pago</label>
            <select name="metodo" class="block border rounded p-2">
              ${METODOS_PAGO.map((m) => `<option value="${m}">${m}</option>`).join("")}
            </select>
          </div>
          <div id="box-recibido">
            <label class="text-sm text-slate-500">Valor recibido</label>
            <input name="recibido" type="number" min="0" step="any" class="block border rounded p-2">
          </div>
          <p class="text-sm">Cambio: <b id="cambio">$0</b></p>
          <button class="bg-green-600 hover:bg-green-700 text-white rounded px-4 py-2 ml-auto">Registrar venta</button>
          <p id="msg-venta" class="text-sm w-full"></p>
        </form>
      </section>
    </div>`;

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
