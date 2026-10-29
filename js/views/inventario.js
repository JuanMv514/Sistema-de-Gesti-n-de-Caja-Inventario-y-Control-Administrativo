import { loadTemplate } from "../template-loader.js";
import { currentUser } from "../auth.js";
import {
  watchProductos, watchMovimientos, crearProducto, actualizarProducto,
  registrarMovimiento, stockBajo
} from "../services/inventario-service.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => "$" + Math.round(n).toLocaleString("es-CO");
const fmtFecha = (ts) => ts?.toDate ? ts.toDate().toLocaleString("es-CO") : "";

export async function render(root) {
  root.innerHTML = await loadTemplate("inventario");

  const $ = (s) => root.querySelector(s);
  const formProd = $("#form-producto");
  const formMov = $("#form-movimiento");
  let productos = [];
  let editandoId = null;
  let movProductoId = null;

  function pintarProductos() {
    const q = $("#buscar").value.trim().toLowerCase();
    const soloBajo = $("#solo-bajo").checked;
    const lista = productos.filter((p) =>
      (!q || p.nombre.toLowerCase().includes(q) || (p.codigo || "").toLowerCase().includes(q)) &&
      (!soloBajo || stockBajo(p)));

    $("#tabla-productos").innerHTML = lista.length ? lista.map((p) => `
      <tr class="border-t ${stockBajo(p) ? "bg-red-50" : ""}">
        <td class="p-2 font-medium">${esc(p.nombre)}</td>
        <td>${esc(p.codigo)}</td>
        <td>${fmt(p.precio)}</td>
        <td>${p.stock} ${stockBajo(p) ? '<span class="ml-1 text-xs bg-red-600 text-white rounded px-1">Bajo</span>' : ""}</td>
        <td>${p.stockMinimo}</td>
        <td class="text-right p-2 whitespace-nowrap">
          <button data-mov="${p.id}" class="text-navy-700 underline mr-2">Movimiento</button>
          <button data-edit="${p.id}" class="text-navy-700 underline">Editar</button>
        </td>
      </tr>`).join("")
      : `<tr><td colspan="6" class="p-4 text-center text-slate-500">Sin productos.</td></tr>`;
  }

  function abrirFormProducto(p) {
    editandoId = p?.id ?? null;
    $("#titulo-form").textContent = p ? "Editar producto" : "Nuevo producto";
    formProd.reset();
    if (p) {
      formProd.nombre.value = p.nombre; formProd.codigo.value = p.codigo || "";
      formProd.precio.value = p.precio; formProd.stockMinimo.value = p.stockMinimo;
    }
    // El stock solo se fija al crear; luego cambia con movimientos
    formProd.stock.classList.toggle("hidden", !!p);
    $("#msg-producto").textContent = "";
    formProd.classList.remove("hidden");
    formProd.nombre.focus();
  }

  const unsubProd = watchProductos((lista) => { productos = lista; pintarProductos(); });
  const unsubMov = watchMovimientos((movs) => {
    $("#tabla-movimientos").innerHTML = movs.length ? movs.map((m) => `
      <tr class="border-t">
        <td class="p-2">${fmtFecha(m.fecha)}</td><td>${esc(m.nombre)}</td>
        <td class="${m.tipo === "entrada" ? "text-navy-700" : "text-red-600"} font-medium">${m.tipo}</td>
        <td>${m.cantidad}</td><td>${esc(m.motivo)}</td><td>${esc(m.usuario)}</td>
      </tr>`).join("")
      : `<tr><td colspan="6" class="p-4 text-center text-slate-500">Sin movimientos.</td></tr>`;
  });

  $("#buscar").addEventListener("input", pintarProductos);
  $("#solo-bajo").addEventListener("change", pintarProductos);
  $("#btn-nuevo").addEventListener("click", () => abrirFormProducto(null));
  $("#btn-cancelar").addEventListener("click", () => formProd.classList.add("hidden"));
  $("#btn-cancelar-mov").addEventListener("click", () => formMov.classList.add("hidden"));

  $("#tabla-productos").addEventListener("click", (e) => {
    const { edit, mov } = e.target.dataset;
    if (edit) abrirFormProducto(productos.find((p) => p.id === edit));
    if (mov) {
      movProductoId = mov;
      $("#mov-producto").textContent = productos.find((p) => p.id === mov).nombre;
      formMov.reset(); $("#msg-mov").textContent = "";
      formMov.classList.remove("hidden");
      formMov.cantidad.focus();
    }
  });

  formProd.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = {
      nombre: formProd.nombre.value, codigo: formProd.codigo.value,
      precio: Number(formProd.precio.value), stock: Number(formProd.stock.value || 0),
      stockMinimo: Number(formProd.stockMinimo.value)
    };
    try {
      if (editandoId) await actualizarProducto(editandoId, data);
      else await crearProducto(data, currentUser);
      formProd.classList.add("hidden");
    } catch (err) { $("#msg-producto").textContent = err.message; }
  });

  formMov.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await registrarMovimiento({
        productoId: movProductoId, tipo: formMov.tipo.value,
        cantidad: Number(formMov.cantidad.value), motivo: formMov.motivo.value
      }, currentUser);
      formMov.classList.add("hidden");
    } catch (err) { $("#msg-mov").textContent = err.message; }
  });

  return () => { unsubProd(); unsubMov(); };
}
