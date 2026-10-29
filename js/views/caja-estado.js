import { currentUser } from "../auth.js";
import {
  watchCajaAbierta, abrirCaja, cerrarCaja, watchVentasCaja, totalesPorMetodo
} from "../services/caja-service.js";

export const fmt = (n) => "$" + Math.round(n).toLocaleString("es-CO");

// Panel de apertura/cierre de caja. Devuelve { destroy } para cancelar listeners.
export function renderEstadoCaja(container, onCajaChange) {
  let unsubVentas = null;
  let cajaActual = null;

  const unsubCaja = watchCajaAbierta((caja) => {
    cajaActual = caja;
    if (unsubVentas) { unsubVentas(); unsubVentas = null; }
    onCajaChange(caja);

    if (!caja) return pintarCerrada();
    unsubVentas = watchVentasCaja(caja.id, (ventas) => pintarAbierta(caja, ventas));
  });

  function pintarCerrada() {
    container.innerHTML = `
      <form id="form-abrir" class="bg-white p-4 rounded shadow flex flex-wrap items-end gap-3">
        <div>
          <p class="font-semibold">Caja cerrada</p>
          <label class="text-sm text-slate-500">Monto inicial</label>
          <input name="monto" type="number" min="0" step="any" required class="block border rounded p-2">
        </div>
        <button class="bg-green-600 hover:bg-green-700 text-white rounded px-4 py-2">Abrir caja</button>
        <p id="msg-caja" class="text-red-600 text-sm w-full"></p>
      </form>`;
    container.querySelector("#form-abrir").addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await abrirCaja(Number(e.target.monto.value), currentUser); }
      catch (err) { container.querySelector("#msg-caja").textContent = err.message; }
    });
  }

  function pintarAbierta(caja, ventas) {
    const t = totalesPorMetodo(ventas);
    const esperado = caja.montoInicial + t.efectivo;
    container.innerHTML = `
      <div class="bg-white p-4 rounded shadow space-y-3">
        <div class="flex flex-wrap justify-between gap-2">
          <p class="font-semibold text-green-700">Caja abierta por ${caja.abiertaPor}</p>
          <p class="text-sm text-slate-500">Monto inicial: ${fmt(caja.montoInicial)} · Ventas: ${ventas.length}</p>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <div class="bg-slate-50 p-2 rounded">Efectivo<br><b>${fmt(t.efectivo)}</b></div>
          <div class="bg-slate-50 p-2 rounded">Transferencia<br><b>${fmt(t.transferencia)}</b></div>
          <div class="bg-slate-50 p-2 rounded">Tarjeta<br><b>${fmt(t.tarjeta)}</b></div>
          <div class="bg-blue-50 p-2 rounded">Efectivo esperado<br><b>${fmt(esperado)}</b></div>
        </div>
        <form id="form-cerrar" class="flex flex-wrap items-end gap-3 border-t pt-3">
          <div>
            <label class="text-sm text-slate-500">Efectivo contado</label>
            <input name="contado" type="number" min="0" step="any" required class="block border rounded p-2">
          </div>
          <button class="bg-red-600 hover:bg-red-700 text-white rounded px-4 py-2">Cerrar caja</button>
          <p id="msg-caja" class="text-sm w-full"></p>
        </form>
      </div>`;
    container.querySelector("#form-cerrar").addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = container.querySelector("#msg-caja");
      if (!confirm("¿Cerrar la caja? Esta acción no se puede deshacer.")) return;
      try {
        const r = await cerrarCaja(caja, Number(e.target.contado.value), currentUser);
        alert(`Caja cerrada. Esperado: ${fmt(r.montoEsperado)} · Diferencia: ${fmt(r.diferencia)}`);
      } catch (err) { msg.textContent = err.message; msg.className = "text-sm w-full text-red-600"; }
    });
  }

  return {
    getCaja: () => cajaActual,
    destroy() { unsubCaja(); if (unsubVentas) unsubVentas(); }
  };
}
