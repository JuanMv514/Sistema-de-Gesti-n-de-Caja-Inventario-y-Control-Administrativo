// Controladores reactivos para Dashboard, Inventario, Contabilidad, Reportes y Usuarios.
// Cumple las Secciones 3, 5, 7, 8, 9, 10, 13 y 14:
// - Ningún indicador ni tabla utiliza cifras de demostración estáticas.
// - Cuando no existen registros, muestra estados vacíos reales ("No hay ventas registradas", etc.).
// - Sincroniza todas las vistas con las colecciones transaccionales en tiempo real.

import { getCurrentUser, hasPermission } from "../auth.js";
import {
  watchProductos,
  watchMovimientosInventario,
  getEstadoStock,
  obtenerAlertasInventario,
  formatCOP,
  roundCOP,
  crearProducto,
  actualizarProducto,
  cambiarEstadoProducto,
  registrarMovimientoBodega
} from "../services/inventario-service.js";
import {
  watchMovimientosContables,
  calcularResumenContable,
  filtrarMovimientosContables,
  generarInformeFinancieroContable,
  obtenerRangoPeriodo,
  registrarMovimientoContable,
  registrarTrasladoInterno,
  revertirMovimientoContable,
  exportarContabilidadCSV,
  TIPOS_CONTABLE
} from "../services/contabilidad-service.js";
import {
  watchCajas,
  watchVentas,
  calcularArqueoCaja
} from "../services/caja-service.js";
import {
  generarReportesConsolidados,
  generarCSVReporte
} from "../services/reportes-service.js";
import {
  watchUsuarios,
  watchAuditoria,
  crearUsuario,
  actualizarUsuario
} from "../services/usuarios-service.js";

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
  );
}

function formatShortDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("es-CO");
  } catch {
    return iso;
  }
}

function formatShortTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function formatDateTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-CO", {
      dateStyle: "short",
      timeStyle: "short"
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// 1. VISTA DE INVENTARIO (Sección 7)
// ---------------------------------------------------------------------------
export function mountInventarioView(root) {
  const $ = (sel) => root.querySelector(sel);
  let productos = [];
  let kardex = [];

  const feedbackEl = $("#inv-feedback");
  function showFeedback(msg, isError = false) {
    if (!feedbackEl) return;
    feedbackEl.textContent = msg;
    feedbackEl.className = `alert ${isError ? "alert-danger" : "alert-info"}`;
    feedbackEl.classList.remove("hidden");
  }

  function renderTablaInventario() {
    const tbody = root.querySelector("#tabla-productos tbody");
    if (!tbody) return;
    const q = ($("#buscar-inventario")?.value || "").trim().toLowerCase();
    const catFiltro = $("#inv-filtro-categoria")?.value || "Todos";
    const soloBajo = Boolean($("#solo-bajo")?.checked);
    const mostrarInactivos = Boolean($("#mostrar-inactivos")?.checked);
    const puedeGestionar = hasPermission("inventario.gestionar", getCurrentUser());

    const filtrados = productos.filter((p) => {
      if (!mostrarInactivos && p.activo === false) return false;
      if (catFiltro !== "Todos" && p.categoria !== catFiltro) return false;
      const matchQ =
        !q ||
        String(p.nombre || "").toLowerCase().includes(q) ||
        String(p.codigo || "").toLowerCase().includes(q) ||
        String(p.descripcion || "").toLowerCase().includes(q) ||
        String(p.categoria || "").toLowerCase().includes(q);
      const est = getEstadoStock(p);
      const matchBajo = !soloBajo || est.codigo === "agotado" || est.codigo === "bajo";
      return matchQ && matchBajo;
    });

    tbody.innerHTML = filtrados.length
      ? filtrados
          .map((p) => {
            const est = getEstadoStock(p);
            const esActivo = p.activo !== false;
            return `
              <tr class="${est.claseFila}">
                <td><b>${escapeHtml(p.codigo)}</b></td>
                <td>
                  ${escapeHtml(p.nombre)}
                  ${p.descripcion ? `<br><small class="text-muted">${escapeHtml(p.descripcion)}</small>` : ""}
                </td>
                <td>${escapeHtml(p.categoria)}</td>
                <td class="num">${formatCOP(p.precioCompra || 0)}</td>
                <td class="num"><b>${formatCOP(p.precio)}</b> / ${escapeHtml(p.unidad)}</td>
                <td class="num"><b>${p.stock} ${escapeHtml(p.unidad)}</b></td>
                <td class="num">${p.stockMinimo} ${escapeHtml(p.unidad)}</td>
                <td><span class="badge ${est.claseBadge}">${est.etiqueta}</span></td>
                <td class="text-right" style="white-space:nowrap">
                  ${
                    puedeGestionar
                      ? `
                        <button type="button" class="btn btn-outline" style="padding:.22rem .55rem; font-size:.76rem" data-edit-prod="${escapeHtml(p.id)}">Editar</button>
                        <button type="button" class="btn btn-outline" style="padding:.22rem .55rem; font-size:.76rem" data-toggle-prod="${escapeHtml(p.id)}">${esActivo ? "Desactivar" : "Activar"}</button>
                      `
                      : `<span class="text-muted" style="font-size:.76rem">Solo lectura</span>`
                  }
                </td>
              </tr>
            `;
          })
          .join("")
      : `<tr><td colspan="9" style="text-align:center; padding:1.5rem" class="text-muted">No hay productos disponibles.</td></tr>`;

    // Poblar selects de entrada y salida solo con productos activos
    const activos = productos.filter((p) => p.activo !== false);
    const opts = activos.length
      ? activos
          .map(
            (p) =>
              `<option value="${escapeHtml(p.id)}">${escapeHtml(p.nombre)} (${escapeHtml(p.codigo)} · Disp: ${p.stock} ${escapeHtml(p.unidad)})</option>`
          )
          .join("")
      : `<option value="">No hay productos disponibles</option>`;
    if ($("#ent-producto")) $("#ent-producto").innerHTML = opts;
    if ($("#sal-producto")) $("#sal-producto").innerHTML = opts;
  }

  function renderKardex() {
    const tbody = root.querySelector("#tabla-kardex-inventario tbody");
    const countEl = $("#inv-kardex-count");
    if (countEl) countEl.textContent = `${kardex.length} movimientos`;
    if (!tbody) return;

    tbody.innerHTML = kardex.length
      ? kardex
          .slice(0, 50)
          .map((m) => {
            const esEntrada = m.tipo === "Entrada";
            return `
              <tr>
                <td>${formatDateTime(m.fecha)}</td>
                <td><b>${escapeHtml(m.codigo || "—")}</b></td>
                <td>${escapeHtml(m.productoNombre)}</td>
                <td><span class="badge ${esEntrada ? "badge-success" : "badge-warning"}">${escapeHtml(m.tipo)}</span></td>
                <td>${escapeHtml(m.origen || "—")}</td>
                <td class="num ${esEntrada ? "text-income" : "text-expense"}">${esEntrada ? "+ " : "− "}${m.cantidad} ${escapeHtml(m.unidad || "")}</td>
                <td class="num">${m.stockAnterior ?? "—"}</td>
                <td class="num"><b>${m.stockNuevo ?? "—"}</b></td>
                <td>${escapeHtml(m.motivo || "—")}</td>
                <td>${escapeHtml(m.usuario || "—")}</td>
              </tr>
            `;
          })
          .join("")
      : `<tr><td colspan="10" style="text-align:center; padding:1.5rem" class="text-muted">No hay movimientos de inventario registrados.</td></tr>`;
  }

  function abrirModalProducto(prod = null) {
    const errEl = $("#prod-error");
    if (errEl) errEl.classList.add("hidden");

    const titulo = $("#titulo-producto");
    const fieldStockInicial = $("#field-prod-stock-inicial");

    if (prod) {
      if (titulo) titulo.textContent = `Editar producto · ${prod.codigo}`;
      if ($("#prod-id")) $("#prod-id").value = prod.id;
      if ($("#prod-nombre")) $("#prod-nombre").value = prod.nombre;
      if ($("#prod-codigo")) $("#prod-codigo").value = prod.codigo;
      if ($("#prod-categoria")) $("#prod-categoria").value = prod.categoria;
      if ($("#prod-unidad")) $("#prod-unidad").value = prod.unidad;
      if ($("#prod-precio-compra")) $("#prod-precio-compra").value = prod.precioCompra ?? 0;
      if ($("#prod-precio")) $("#prod-precio").value = prod.precio;
      if ($("#prod-minimo")) $("#prod-minimo").value = prod.stockMinimo ?? 0;
      if ($("#prod-descripcion")) $("#prod-descripcion").value = prod.descripcion || "";
      if (fieldStockInicial) fieldStockInicial.classList.add("hidden");
    } else {
      if (titulo) titulo.textContent = "Nuevo producto";
      $("#form-producto")?.reset();
      if ($("#prod-id")) $("#prod-id").value = "";
      if (fieldStockInicial) fieldStockInicial.classList.remove("hidden");
    }

    $("#modal-producto")?.classList.add("is-open");
  }

  $("#btn-nuevo-producto")?.addEventListener("click", () => abrirModalProducto(null));
  $("#buscar-inventario")?.addEventListener("input", renderTablaInventario);
  $("#inv-filtro-categoria")?.addEventListener("change", renderTablaInventario);
  $("#solo-bajo")?.addEventListener("change", renderTablaInventario);
  $("#mostrar-inactivos")?.addEventListener("change", renderTablaInventario);

  $("#prod-categoria")?.addEventListener("change", () => {
    const cat = $("#prod-categoria")?.value;
    const uEl = $("#prod-unidad");
    if (uEl && !$("#prod-id")?.value) {
      uEl.value = cat === "Vidrios" ? "m²" : cat === "Perfiles" ? "m" : "u";
    }
  });

  $("#ent-registrar-gasto")?.addEventListener("change", (e) => {
    const checked = e.target.checked;
    $("#box-ent-metodo")?.classList.toggle("hidden", !checked);
    $("#box-ent-costo")?.classList.toggle("hidden", !checked);
  });

  root.querySelector("#tabla-productos")?.addEventListener("click", async (e) => {
    const editBtn = e.target.closest("[data-edit-prod]");
    if (editBtn) {
      const prod = productos.find((p) => p.id === editBtn.dataset.editProd);
      if (prod) abrirModalProducto(prod);
      return;
    }
    const toggleBtn = e.target.closest("[data-toggle-prod]");
    if (toggleBtn) {
      const prod = productos.find((p) => p.id === toggleBtn.dataset.toggleProd);
      if (!prod) return;
      try {
        const nuevoEstado = prod.activo === false;
        await cambiarEstadoProducto(prod.id, nuevoEstado, getCurrentUser());
        showFeedback(
          `Producto "${prod.nombre}" ${nuevoEstado ? "activado" : "desactivado"} correctamente.`
        );
      } catch (err) {
        showFeedback(err.message, true);
      }
    }
  });

  $("#form-producto")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("#prod-error");
    if (errEl) errEl.classList.add("hidden");
    try {
      const id = $("#prod-id")?.value;
      const payload = {
        nombre: $("#prod-nombre")?.value,
        codigo: $("#prod-codigo")?.value,
        categoria: $("#prod-categoria")?.value,
        unidad: $("#prod-unidad")?.value,
        precioCompra: $("#prod-precio-compra")?.value,
        precio: $("#prod-precio")?.value,
        stock: $("#prod-stock")?.value,
        stockMinimo: $("#prod-minimo")?.value,
        descripcion: $("#prod-descripcion")?.value
      };

      if (id) {
        await actualizarProducto(id, payload, getCurrentUser());
        showFeedback(`Producto "${payload.nombre}" actualizado correctamente.`);
      } else {
        await crearProducto(payload, getCurrentUser());
        showFeedback(`Producto "${payload.nombre}" registrado en el catálogo.`);
      }
      $("#form-producto").reset();
      $("#modal-producto")?.classList.remove("is-open");
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message;
        errEl.classList.remove("hidden");
      }
    }
  });

  $("#form-entrada")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const mov = await registrarMovimientoBodega(
        {
          productoId: $("#ent-producto")?.value,
          tipo: "Entrada",
          origen: $("#ent-origen")?.value || "Entrada por compra",
          cantidad: $("#ent-cantidad")?.value,
          motivo: $("#ent-motivo")?.value,
          registrarGastoCompra: Boolean($("#ent-registrar-gasto")?.checked),
          metodoPagoCompra: $("#ent-metodo-pago")?.value || "Transferencia",
          costoTotalCompra: $("#ent-costo-total")?.value
        },
        getCurrentUser()
      );
      $("#ent-cantidad").value = "";
      $("#ent-motivo").value = "";
      if ($("#ent-costo-total")) $("#ent-costo-total").value = "";
      showFeedback(
        `Entrada registrada: +${mov.cantidad} ${mov.unidad} de "${mov.productoNombre}" (nuevo stock: ${mov.stockNuevo} ${mov.unidad}).`
      );
    } catch (err) {
      showFeedback(err.message, true);
    }
  });

  $("#form-salida")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const mov = await registrarMovimientoBodega(
        {
          productoId: $("#sal-producto")?.value,
          tipo: "Salida",
          origen: $("#sal-origen")?.value || "Pérdida o daño",
          cantidad: $("#sal-cantidad")?.value,
          motivo: $("#sal-motivo")?.value
        },
        getCurrentUser()
      );
      $("#sal-cantidad").value = "";
      $("#sal-motivo").value = "";
      showFeedback(
        `Salida registrada: −${mov.cantidad} ${mov.unidad} de "${mov.productoNombre}" (nuevo stock: ${mov.stockNuevo} ${mov.unidad}).`
      );
    } catch (err) {
      showFeedback(err.message, true);
    }
  });

  const unsubProd = watchProductos(
    (lista) => {
      productos = lista;
      renderTablaInventario();
    },
    { incluirInactivos: true }
  );

  const unsubKardex = watchMovimientosInventario((lista) => {
    kardex = lista;
    renderKardex();
  });

  return () => {
    unsubProd();
    unsubKardex();
  };
}

// ---------------------------------------------------------------------------
// 2. VISTA DE CONTABILIDAD BÁSICA (Secciones 1 a 16)
// ---------------------------------------------------------------------------
export function mountContabilidadView(root) {
  const $ = (sel) => root.querySelector(sel);
  let movimientos = [];
  let cajaAbierta = null;
  let ventas = [];
  let ultimosFiltrados = [];

  const feedbackEl = $("#cont-feedback");
  function showFeedback(msg, isError = false) {
    if (!feedbackEl) return;
    feedbackEl.textContent = msg;
    feedbackEl.className = `alert ${isError ? "alert-danger" : "alert-info"}`;
    feedbackEl.classList.remove("hidden");
  }

  const hoyIso = new Date().toISOString().slice(0, 10);
  const currentUser = getCurrentUser();
  if ($("#ing-fecha") && !$("#ing-fecha").value) $("#ing-fecha").value = hoyIso;
  if ($("#gas-fecha") && !$("#gas-fecha").value) $("#gas-fecha").value = hoyIso;
  if ($("#tras-fecha") && !$("#tras-fecha").value) $("#tras-fecha").value = hoyIso;
  if ($("#ing-responsable")) $("#ing-responsable").value = currentUser.name || currentUser.email;
  if ($("#gas-responsable")) $("#gas-responsable").value = currentUser.name || currentUser.email;

  function sincronizarVisibilidadCajaEfectivo() {
    const ingEsEfectivo = ($("#ing-metodo")?.value || "Efectivo") === "Efectivo";
    const gasEsEfectivo = ($("#gas-metodo")?.value || "Efectivo") === "Efectivo";

    const chkIng = $("#ing-afecta-caja");
    const boxIng = $("#box-ing-afecta-caja");
    if (chkIng && boxIng) {
      if (!ingEsEfectivo) chkIng.checked = false;
      chkIng.disabled = !ingEsEfectivo;
      boxIng.style.opacity = ingEsEfectivo ? "1" : "0.5";
    }

    const chkGas = $("#gas-afecta-caja");
    const boxGas = $("#box-gas-afecta-caja");
    if (chkGas && boxGas) {
      if (!gasEsEfectivo) chkGas.checked = false;
      chkGas.disabled = !gasEsEfectivo;
      boxGas.style.opacity = gasEsEfectivo ? "1" : "0.5";
    }
  }

  $("#ing-metodo")?.addEventListener("change", sincronizarVisibilidadCajaEfectivo);
  $("#gas-metodo")?.addEventListener("change", sincronizarVisibilidadCajaEfectivo);
  sincronizarVisibilidadCajaEfectivo();

  // Sincronizar selector de período superior con las fechas de filtro
  $("#cont-periodo-informe")?.addEventListener("change", () => {
    const per = $("#cont-periodo-informe")?.value || "todos";
    if (per !== "personalizado") {
      const { desde, hasta } = obtenerRangoPeriodo(per);
      if ($("#cont-desde")) $("#cont-desde").value = desde;
      if ($("#cont-hasta")) $("#cont-hasta").value = hasta;
    }
    renderContabilidad();
  });

  function renderContabilidad() {
    const periodoSel = $("#cont-periodo-informe")?.value || "todos";
    const desde = $("#cont-desde")?.value || "";
    const hasta = $("#cont-hasta")?.value || "";

    const informe = generarInformeFinancieroContable(movimientos, {
      periodo: periodoSel,
      desde,
      hasta
    });
    const resGlobal = calcularResumenContable(movimientos, {
      cajas: cajaAbierta ? [cajaAbierta] : [],
      ventas
    });
    const resPeriodo = informe.resumen;

    // Indicador 1: Ingresos
    if ($("#cont-kpi-ingresos")) {
      $("#cont-kpi-ingresos").textContent = formatCOP(resPeriodo.ingresos);
    }
    if ($("#cont-note-ingresos")) {
      $("#cont-note-ingresos").textContent = `${resPeriodo.countIngresos} ingresos · Efectivo: ${formatCOP(resPeriodo.ingresosEfectivo)} · Bancos: ${formatCOP(resPeriodo.ingresosBancos)}`;
    }

    // Indicador 2: Gastos
    if ($("#cont-kpi-gastos")) {
      $("#cont-kpi-gastos").textContent = formatCOP(resPeriodo.gastos);
    }
    if ($("#cont-note-gastos")) {
      $("#cont-note-gastos").textContent = `${resPeriodo.countGastos} egresos · Operativos: ${formatCOP(resPeriodo.gastosOperativos)} · Compras inv.: ${formatCOP(resPeriodo.comprasInventario)}`;
    }

    // Indicador 3: Resultado del período
    if ($("#cont-kpi-balance")) {
      const sign = resPeriodo.resultadoPeriodo > 0 ? "+ " : "";
      $("#cont-kpi-balance").textContent = `${sign}${formatCOP(resPeriodo.resultadoPeriodo)}`;
      $("#cont-kpi-balance").className = `stat-value num ${resPeriodo.resultadoPeriodo >= 0 ? "text-income" : "text-expense"}`;
    }
    if ($("#cont-note-balance")) {
      $("#cont-note-balance").textContent =
        resPeriodo.resultadoPeriodo >= 0
          ? "Resultado positivo (ingresos − gastos)"
          : "Resultado negativo (gastos superan ingresos)";
    }

    // Indicador 4: Saldo de efectivo en caja y Saldo de bancos (por separado, sin mezclar)
    const arqueo = cajaAbierta ? calcularArqueoCaja(cajaAbierta, ventas) : null;
    if ($("#cont-kpi-efectivo-caja")) {
      $("#cont-kpi-efectivo-caja").textContent = arqueo
        ? formatCOP(arqueo.efectivoEsperado)
        : "$ 0 (Caja cerrada)";
    }
    if ($("#cont-kpi-bancos")) {
      $("#cont-kpi-bancos").textContent = resGlobal.tieneDatosBancarios
        ? formatCOP(resGlobal.saldoBancos)
        : "Sin datos bancarios registrados";
    }
    if ($("#cont-note-por-cobrar")) {
      $("#cont-note-por-cobrar").textContent = `Cuentas por cobrar (saldos pendientes): ${formatCOP(resGlobal.cuentasPorCobrar)}`;
    }

    // Tabla de Historial de Movimientos Financieros (9 columnas + acción de detalle/reversión)
    const tbody = root.querySelector("#tabla-movimientos tbody");
    if (!tbody) return;

    const filtrados = filtrarMovimientosContables(movimientos, {
      tipo: $("#cont-filtro-tipo")?.value || "Todos",
      categoria: $("#cont-filtro-categoria")?.value || "Todas",
      metodoPago: $("#cont-filtro-metodo")?.value || "Todos",
      usuario: $("#cont-filtro-usuario")?.value || "Todos",
      desde,
      hasta,
      busqueda: $("#cont-buscar")?.value || ""
    });
    ultimosFiltrados = filtrados;

    if ($("#cont-historial-count")) {
      $("#cont-historial-count").textContent = `${filtrados.length} movimientos`;
    }

    tbody.innerHTML = filtrados.length
      ? filtrados
          .map((m) => {
            const esIng = m.tipo === TIPOS_CONTABLE.INGRESO;
            const esGas = m.tipo === TIPOS_CONTABLE.GASTO;
            const esTras = m.tipo === TIPOS_CONTABLE.TRASLADO;
            const revertido = Boolean(m.anulado || m.estado === "Revertido");
            const estadoTxt = revertido ? "Revertido" : m.estado || "Confirmado";
            const badgeTipoCls = esIng ? "badge-success" : esGas ? "badge-danger" : "badge-warning";
            const badgeEstadoCls = revertido ? "badge-danger" : "badge-success";
            const montoCls = revertido ? "text-muted" : esIng ? "text-income" : esGas ? "text-expense" : "";
            const prefijo = esIng ? "+ " : esGas ? "− " : "⇄ ";
            const refTexto = m.referencia || m.soporteReferencia || m.numeroVenta || m.referenciaId || "—";
            const metodoInfo = `${escapeHtml(m.metodoPago || "Efectivo")}${m.afectaCajaFisica ? " (Caja)" : ""}`;

            return `
              <tr style="${revertido ? "opacity:0.65" : ""}">
                <td>${formatShortDate(m.fechaEfectiva || m.fecha)}</td>
                <td><span class="badge ${badgeTipoCls}">${escapeHtml(m.tipo)}</span></td>
                <td>${escapeHtml(m.categoria)}</td>
                <td>
                  <b>${escapeHtml(m.concepto)}</b>
                  ${m.clienteRelacionado ? `<br><small class="text-muted">Cliente: ${escapeHtml(m.clienteRelacionado)}</small>` : ""}
                  ${m.proveedor ? `<br><small class="text-muted">Proveedor: ${escapeHtml(m.proveedor)}</small>` : ""}
                  ${m.pedidoRelacionado ? `<br><small class="text-muted">Pedido: ${escapeHtml(m.pedidoRelacionado)}${m.saldoPendientePedido > 0 ? ` · Saldo pend.: ${formatCOP(m.saldoPendientePedido)}` : ""}</small>` : ""}
                </td>
                <td><span class="badge">${metodoInfo}</span></td>
                <td>${escapeHtml(refTexto)}</td>
                <td class="num ${montoCls}"><b>${prefijo}${formatCOP(m.valor ?? m.monto)}</b></td>
                <td>${escapeHtml(m.responsable || m.usuario || "—")}</td>
                <td><span class="badge ${badgeEstadoCls}">${escapeHtml(estadoTxt)}</span></td>
                <td class="text-right" style="white-space:nowrap">
                  <button type="button" class="btn btn-outline" style="padding:.22rem .55rem; font-size:.76rem" data-ver-detalle-cont="${escapeHtml(m.id)}">Detalle</button>
                </td>
              </tr>
            `;
          })
          .join("")
      : `<tr><td colspan="10" style="text-align:center; padding:1.5rem" class="text-muted">No hay movimientos financieros que coincidan con los filtros seleccionados.</td></tr>`;

    // Renderizar las 3 tablas de Informes Financieros de Contabilidad (Sección 10)
    const tbInfIng = $("#cont-informe-ingresos");
    if (tbInfIng) {
      const filasCatIng = informe.ingresosPorCategoria.map(
        (c) => `<tr><td>Categoría: <b>${escapeHtml(c.nombre)}</b></td><td class="num">${c.movimientos}</td><td class="num text-income">+ ${formatCOP(c.total)}</td><td class="num">${c.porcentaje}%</td></tr>`
      );
      const filasMetIng = informe.ingresosPorMetodo.map(
        (c) => `<tr><td>Medio: <span class="badge">${escapeHtml(c.nombre)}</span></td><td class="num">${c.movimientos}</td><td class="num text-income">+ ${formatCOP(c.total)}</td><td class="num">${c.porcentaje}%</td></tr>`
      );
      const todasIng = [...filasCatIng, ...filasMetIng];
      tbInfIng.innerHTML = todasIng.length
        ? todasIng.join("")
        : `<tr><td colspan="4" class="text-muted" style="text-align:center; padding:1.25rem">Sin ingresos en el período seleccionado.</td></tr>`;
    }

    const tbInfGas = $("#cont-informe-gastos");
    if (tbInfGas) {
      const filasCatGas = informe.gastosPorCategoria.map(
        (c) => `<tr><td>Categoría: <b>${escapeHtml(c.nombre)}</b></td><td class="num">${c.movimientos}</td><td class="num text-expense">− ${formatCOP(c.total)}</td><td class="num">${c.porcentaje}%</td></tr>`
      );
      const filasMetGas = informe.gastosPorMetodo.map(
        (c) => `<tr><td>Medio: <span class="badge">${escapeHtml(c.nombre)}</span></td><td class="num">${c.movimientos}</td><td class="num text-expense">− ${formatCOP(c.total)}</td><td class="num">${c.porcentaje}%</td></tr>`
      );
      const todasGas = [...filasCatGas, ...filasMetGas];
      tbInfGas.innerHTML = todasGas.length
        ? todasGas.join("")
        : `<tr><td colspan="4" class="text-muted" style="text-align:center; padding:1.25rem">Sin gastos en el período seleccionado.</td></tr>`;
    }

    const tbEvol = $("#cont-informe-evolucion");
    if (tbEvol) {
      tbEvol.innerHTML = informe.evolucionDiaria.length
        ? informe.evolucionDiaria
            .map(
              (d) => `
                <tr>
                  <td><b>${escapeHtml(d.fecha)}</b></td>
                  <td class="num text-income">+ ${formatCOP(d.ingresos)}</td>
                  <td class="num text-expense">− ${formatCOP(d.gastos)}</td>
                  <td class="num ${d.resultado >= 0 ? "text-income" : "text-expense"}"><b>${d.resultado > 0 ? "+ " : ""}${formatCOP(d.resultado)}</b></td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="4" class="text-muted" style="text-align:center; padding:1.25rem">Sin movimientos en el período seleccionado.</td></tr>`;
    }
  }

  function abrirModalDetalleMovimiento(mov) {
    const modal = $("#modal-detalle-contable");
    const body = $("#detalle-contable-body");
    const formRev = $("#form-revertir-contable");
    const errRev = $("#rev-error");
    if (!modal || !body) return;
    if (errRev) errRev.classList.add("hidden");

    const revertido = Boolean(mov.anulado || mov.estado === "Revertido");
    const estadoTxt = revertido ? "Revertido" : mov.estado || "Confirmado";

    body.innerHTML = `
      <div class="summary-row"><span>Identificador:</span><b>${escapeHtml(mov.id)}</b></div>
      <div class="summary-row"><span>Tipo y categoría:</span><span><b>${escapeHtml(mov.tipo)}</b> · ${escapeHtml(mov.categoria)}</span></div>
      <div class="summary-row"><span>Concepto:</span><b>${escapeHtml(mov.concepto)}</b></div>
      <div class="summary-row"><span>Valor:</span><b class="num">${formatCOP(mov.valor ?? mov.monto)}</b></div>
      <div class="summary-row"><span>Fecha efectiva del movimiento:</span><span>${escapeHtml(mov.fechaEfectiva || formatShortDate(mov.fecha))}</span></div>
      <div class="summary-row"><span>Fecha y hora de registro:</span><span>${formatDateTime(mov.fechaRegistro || mov.fecha)}</span></div>
      <div class="summary-row"><span>Método de pago:</span><span>${escapeHtml(mov.metodoPago || "Efectivo")}${mov.afectaCajaFisica ? ` (Afectó caja física: ${escapeHtml(mov.cajaId || "Sí")})` : " (No afecta caja física)"}</span></div>
      ${mov.clienteRelacionado ? `<div class="summary-row"><span>Cliente relacionado:</span><span>${escapeHtml(mov.clienteRelacionado)}</span></div>` : ""}
      ${mov.proveedor ? `<div class="summary-row"><span>Proveedor:</span><span>${escapeHtml(mov.proveedor)}</span></div>` : ""}
      ${mov.pedidoRelacionado ? `<div class="summary-row"><span>Pedido / Instalación:</span><span>${escapeHtml(mov.pedidoRelacionado)}${mov.saldoPendientePedido > 0 ? ` (Saldo pendiente: ${formatCOP(mov.saldoPendientePedido)})` : ""}</span></div>` : ""}
      <div class="summary-row"><span>Referencia / Comprobante:</span><span>${escapeHtml(mov.referencia || mov.soporteReferencia || mov.numeroVenta || "—")}</span></div>
      <div class="summary-row"><span>Responsable del registro:</span><span>${escapeHtml(mov.responsable || mov.usuario || "—")}</span></div>
      <div class="summary-row"><span>Estado actual:</span><span class="badge ${revertido ? "badge-danger" : "badge-success"}">${escapeHtml(estadoTxt)}</span></div>
      <div class="summary-row"><span>Observaciones:</span><span>${escapeHtml(mov.observaciones || mov.nota || "Sin observaciones")}</span></div>
      ${
        revertido
          ? `
            <div class="summary-row"><span>Motivo de reversión:</span><span class="text-expense">${escapeHtml(mov.motivoReversion || "Ajuste autorizado")}</span></div>
            <div class="summary-row"><span>Revertido por:</span><span>${escapeHtml(mov.revertidoPor || "Administrador")} (${formatDateTime(mov.fechaReversion)})</span></div>
          `
          : ""
      }
    `;

    const puedeRevertir =
      hasPermission("contabilidad.revertir", getCurrentUser()) &&
      !revertido &&
      mov.origen !== "Venta POS";

    if (formRev) {
      formRev.classList.toggle("hidden", !puedeRevertir);
      if ($("#rev-movimiento-id")) $("#rev-movimiento-id").value = mov.id;
      if ($("#rev-motivo")) $("#rev-motivo").value = "";
    }

    modal.classList.add("is-open");
  }

  ["#cont-buscar", "#cont-filtro-tipo", "#cont-filtro-categoria", "#cont-filtro-metodo", "#cont-filtro-usuario", "#cont-desde", "#cont-hasta"].forEach(
    (sel) => {
      $(sel)?.addEventListener("input", () => {
        if ((sel === "#cont-desde" || sel === "#cont-hasta") && $("#cont-periodo-informe")) {
          $("#cont-periodo-informe").value = "personalizado";
        }
        renderContabilidad();
      });
      $(sel)?.addEventListener("change", () => {
        if ((sel === "#cont-desde" || sel === "#cont-hasta") && $("#cont-periodo-informe")) {
          $("#cont-periodo-informe").value = "personalizado";
        }
        renderContabilidad();
      });
    }
  );

  root.querySelector("#tabla-movimientos")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-ver-detalle-cont]");
    if (!btn) return;
    const mov = movimientos.find((m) => m.id === btn.dataset.verDetalleCont);
    if (mov) abrirModalDetalleMovimiento(mov);
  });

  $("#form-revertir-contable")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("#rev-error");
    if (errEl) errEl.classList.add("hidden");
    try {
      const movId = $("#rev-movimiento-id")?.value;
      const motivo = $("#rev-motivo")?.value;
      const rev = await revertirMovimientoContable({ movimientoId: movId, motivo }, getCurrentUser());
      $("#modal-detalle-contable")?.classList.remove("is-open");
      showFeedback(`Movimiento "${rev.concepto}" revertido correctamente con registro de auditoría.`);
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message;
        errEl.classList.remove("hidden");
      }
    }
  });

  $("#panel-ingreso")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const mov = await registrarMovimientoContable(
        {
          tipo: TIPOS_CONTABLE.INGRESO,
          concepto: $("#ing-concepto")?.value,
          categoria: $("#ing-categoria")?.value,
          monto: $("#ing-monto")?.value,
          fechaEfectiva: $("#ing-fecha")?.value,
          metodoPago: $("#ing-metodo")?.value || "Efectivo",
          clienteRelacionado: $("#ing-cliente")?.value || "",
          pedidoRelacionado: $("#ing-pedido")?.value || "",
          totalPedido: $("#ing-total-pedido")?.value || 0,
          referencia: $("#ing-soporte")?.value || "",
          afectaCajaFisica: Boolean($("#ing-afecta-caja")?.checked),
          observaciones: $("#ing-nota")?.value || ""
        },
        getCurrentUser()
      );
      $("#panel-ingreso").reset();
      if ($("#ing-fecha")) $("#ing-fecha").value = hoyIso;
      if ($("#ing-responsable")) $("#ing-responsable").value = currentUser.name || currentUser.email;
      sincronizarVisibilidadCajaEfectivo();
      showFeedback(
        `Ingreso registrado correctamente: ${mov.concepto} por ${formatCOP(mov.monto)}${mov.saldoPendientePedido > 0 ? ` (Saldo pendiente del pedido: ${formatCOP(mov.saldoPendientePedido)})` : ""}.`
      );
    } catch (err) {
      showFeedback(err.message, true);
    }
  });

  $("#panel-gasto")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const mov = await registrarMovimientoContable(
        {
          tipo: TIPOS_CONTABLE.GASTO,
          concepto: $("#gas-concepto")?.value,
          categoria: $("#gas-categoria")?.value,
          monto: $("#gas-monto")?.value,
          fechaEfectiva: $("#gas-fecha")?.value,
          metodoPago: $("#gas-metodo")?.value || "Efectivo",
          proveedor: $("#gas-proveedor")?.value || "",
          referencia: $("#gas-soporte")?.value || "",
          afectaCajaFisica: Boolean($("#gas-afecta-caja")?.checked),
          observaciones: $("#gas-nota")?.value || ""
        },
        getCurrentUser()
      );
      $("#panel-gasto").reset();
      if ($("#gas-fecha")) $("#gas-fecha").value = hoyIso;
      if ($("#gas-responsable")) $("#gas-responsable").value = currentUser.name || currentUser.email;
      sincronizarVisibilidadCajaEfectivo();
      showFeedback(`Gasto registrado correctamente: ${mov.concepto} por ${formatCOP(mov.monto)}.`);
    } catch (err) {
      showFeedback(err.message, true);
    }
  });

  $("#panel-traslado")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const tr = await registrarTrasladoInterno(
        {
          cuentaOrigen: $("#tras-origen")?.value,
          cuentaDestino: $("#tras-destino")?.value,
          monto: $("#tras-monto")?.value,
          fecha: $("#tras-fecha")?.value,
          referencia: $("#tras-referencia")?.value || "",
          observaciones: $("#tras-nota")?.value || "",
          afectaCajaFisica: Boolean($("#tras-afecta-caja")?.checked)
        },
        getCurrentUser()
      );
      $("#panel-traslado").reset();
      if ($("#tras-fecha")) $("#tras-fecha").value = hoyIso;
      showFeedback(`Traslado interno registrado: ${tr.concepto} por ${formatCOP(tr.monto)}.`);
    } catch (err) {
      showFeedback(err.message, true);
    }
  });

  $("#btn-cont-exportar-csv")?.addEventListener("click", () => {
    const csv = exportarContabilidadCSV(ultimosFiltrados);
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contabilidad-movimientos-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  const u1 = watchMovimientosContables((lista) => {
    movimientos = lista;
    renderContabilidad();
  });
  const u2 = watchCajas(({ cajaAbierta: c }) => {
    cajaAbierta = c;
    renderContabilidad();
  });
  const u3 = watchVentas((lista) => {
    ventas = lista;
    renderContabilidad();
  });

  return () => {
    u1();
    u2();
    u3();
  };
}

// ---------------------------------------------------------------------------
// 3. VISTA DE DASHBOARD OPERATIVO EN TIEMPO REAL (Sección 5)
// ---------------------------------------------------------------------------
export function mountDashboardView(root) {
  const $ = (sel) => root.querySelector(sel);
  let productos = [];
  let ventas = [];
  let cajaAbierta = null;
  let movsContables = [];
  let movsInventario = [];

  function setTxt(sel, val) {
    const el = $(sel);
    if (el) el.textContent = val;
  }

  function renderDashboard() {
    // 1. Pilar Caja y Ventas (calculado 100% desde registros reales)
    const arqueo = cajaAbierta ? calcularArqueoCaja(cajaAbierta, ventas) : null;
    const ventasEfectivas = ventas.filter((v) => v.estado !== "Anulada");

    const badgeCaja = $("#dash-caja-estado");
    if (badgeCaja) {
      badgeCaja.textContent = cajaAbierta ? "Caja abierta" : "Caja cerrada";
      badgeCaja.className = `badge ${cajaAbierta ? "badge-success" : "badge-warning"}`;
    }

    const totalVentasMostrar = arqueo
      ? arqueo.totalVendido
      : ventasEfectivas.reduce((s, v) => s + roundCOP(v.total), 0);
    const numVentasMostrar = arqueo ? arqueo.numeroVentas : ventasEfectivas.length;

    setTxt("#dash-ventas-turno", formatCOP(totalVentasMostrar));
    setTxt("#dash-ventas-count", `${numVentasMostrar} ventas`);
    setTxt("#dash-caja-base", formatCOP(arqueo ? arqueo.montoInicial : 0));
    setTxt("#dash-caja-esperado", formatCOP(arqueo ? arqueo.efectivoEsperado : 0));
    setTxt(
      "#dash-caja-cajero",
      cajaAbierta ? `Cajero: ${cajaAbierta.usuarioApertura}` : "Sin turno abierto"
    );

    // Distribución real por método de pago
    const rep = generarReportesConsolidados(
      {},
      { productos, ventas, cajas: cajaAbierta ? [cajaAbierta] : [], movsInventario, movsContables }
    );
    const metEf = rep.metodosDePago.find((m) => m.metodo === "Efectivo") || { total: 0, porcentaje: 0 };
    const metTr = rep.metodosDePago.find((m) => m.metodo === "Transferencia") || { total: 0, porcentaje: 0 };
    const metTd = rep.metodosDePago.find((m) => m.metodo === "Tarjeta débito") || { total: 0, porcentaje: 0 };
    const metTc = rep.metodosDePago.find((m) => m.metodo === "Tarjeta crédito") || { total: 0, porcentaje: 0 };
    const totalTarjeta = roundCOP(metTd.total + metTc.total);
    const pctTarjeta = Math.min(100, metTd.porcentaje + metTc.porcentaje);

    setTxt("#dash-met-ef-label", `Efectivo (${metEf.porcentaje} %)`);
    setTxt("#dash-met-ef-val", formatCOP(metEf.total));
    if ($("#dash-met-ef-bar")) $("#dash-met-ef-bar").style.width = `${metEf.porcentaje}%`;

    setTxt("#dash-met-tr-label", `Transferencia (${metTr.porcentaje} %)`);
    setTxt("#dash-met-tr-val", formatCOP(metTr.total));
    if ($("#dash-met-tr-bar")) $("#dash-met-tr-bar").style.width = `${metTr.porcentaje}%`;

    setTxt("#dash-met-tj-label", `Tarjeta (${pctTarjeta} %)`);
    setTxt("#dash-met-tj-val", formatCOP(totalTarjeta));
    if ($("#dash-met-tj-bar")) $("#dash-met-tj-bar").style.width = `${pctTarjeta}%`;

    // 2. Pilar Inventario (alertas reales)
    const alertas = obtenerAlertasInventario(productos);
    setTxt("#dash-inv-badge", `${alertas.criticos.length} por reponer`);
    setTxt("#dash-alertas-stock", `${alertas.criticos.length} críticos`);
    setTxt("#dash-total-productos", `${productos.length} productos`);
    setTxt(
      "#dash-inv-resumen-pie",
      `${alertas.agotados.length} agotados · ${alertas.stockBajo.length} en stock bajo`
    );

    const listaAlertas = $("#dash-lista-alertas");
    if (listaAlertas) {
      if (productos.length === 0) {
        listaAlertas.innerHTML = `<li><span class="text-muted">No hay productos disponibles.</span></li>`;
      } else if (alertas.criticos.length === 0) {
        listaAlertas.innerHTML = `<li><span class="text-muted">Todo el catálogo tiene stock suficiente.</span></li>`;
      } else {
        listaAlertas.innerHTML = alertas.criticos
          .slice(0, 4)
          .map((p) => {
            const est = getEstadoStock(p);
            return `
              <li>
                <span><b>${escapeHtml(p.nombre)}</b><br><span class="text-muted">Mínimo: ${p.stockMinimo} ${escapeHtml(p.unidad)}</span></span>
                <span class="badge ${est.claseBadge}">${p.stock <= 0 ? "Agotado (0)" : `Quedan ${p.stock} ${escapeHtml(p.unidad)}`}</span>
              </li>
            `;
          })
          .join("");
      }
    }

    // 3. Pilar Contabilidad Básica
    const resCont = calcularResumenContable(movsContables);
    const balHoyEl = $("#dash-balance-hoy");
    if (balHoyEl) {
      balHoyEl.textContent = `${resCont.balance > 0 ? "+ " : ""}${formatCOP(resCont.balance)}`;
      balHoyEl.className = `big num ${resCont.balance >= 0 ? "text-income" : "text-expense"}`;
    }
    setTxt("#dash-cont-count", `${resCont.totalMovimientos} mov.`);
    const badgeCont = $("#dash-cont-badge");
    if (badgeCont) {
      badgeCont.textContent =
        resCont.totalMovimientos === 0
          ? "Sin movimientos"
          : resCont.balance >= 0
            ? "Resultado positivo"
            : "Resultado negativo";
      badgeCont.className = `badge ${resCont.balance >= 0 ? "badge-success" : "badge-danger"}`;
    }

    setTxt("#dash-ingresos-val", `+ ${formatCOP(resCont.ingresos)}`);
    setTxt("#dash-gastos-val", `− ${formatCOP(resCont.gastos)}`);
    const maxFlujo = Math.max(resCont.ingresos, resCont.gastos, 1);
    if ($("#dash-ingresos-bar")) {
      $("#dash-ingresos-bar").style.width =
        resCont.ingresos > 0 ? `${Math.round((resCont.ingresos / maxFlujo) * 100)}%` : "0%";
    }
    if ($("#dash-gastos-bar")) {
      $("#dash-gastos-bar").style.width =
        resCont.gastos > 0 ? `${Math.round((resCont.gastos / maxFlujo) * 100)}%` : "0%";
    }

    setTxt(
      "#dash-ultimo-ingreso",
      resCont.ultimoIngreso
        ? `${resCont.ultimoIngreso.concepto} (${formatCOP(resCont.ultimoIngreso.monto)})`
        : "Sin ingresos registrados"
    );
    setTxt(
      "#dash-ultimo-gasto",
      resCont.ultimoGasto
        ? `${resCont.ultimoGasto.concepto} (${formatCOP(resCont.ultimoGasto.monto)})`
        : "Sin gastos registrados"
    );

    // 4. Tabla de últimas ventas registradas (siempre reemplaza el tbody, incluso cuando está vacío)
    const tbodyVentas = $("#dash-ultimas-ventas");
    if (tbodyVentas) {
      tbodyVentas.innerHTML = ventas.length
        ? ventas
            .slice(0, 5)
            .map(
              (v) => `
                <tr>
                  <td>${formatShortTime(v.fecha)}</td>
                  <td>${escapeHtml((v.items || []).map((i) => `${i.nombre} (${i.cantidad} ${i.unidad || ""})`).join(", "))}</td>
                  <td><span class="badge">${escapeHtml(v.metodoPago)}</span></td>
                  <td class="num">${formatCOP(v.total)}</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="4" class="text-muted" style="text-align:center; padding:1.25rem">No hay ventas registradas.</td></tr>`;
    }

    // 5. Tabla de actividad reciente combinada (Bodega y Contabilidad)
    const tbodyAct = $("#dash-actividad-reciente");
    if (tbodyAct) {
      const combinados = [
        ...movsContables.slice(0, 4).map((m) => ({
          fecha: m.fecha,
          modulo: "Contabilidad",
          badgeCls: m.tipo === "Ingreso" ? "badge-success" : "badge-danger",
          detalle: m.concepto,
          impacto: `${m.tipo === "Ingreso" ? "+ " : "− "}${formatCOP(m.monto)}`,
          impactoCls: m.tipo === "Ingreso" ? "text-income" : "text-expense"
        })),
        ...movsInventario.slice(0, 4).map((m) => ({
          fecha: m.fecha,
          modulo: "Inventario",
          badgeCls: m.tipo === "Entrada" ? "" : "badge-warning",
          detalle: `${m.tipo} · ${m.productoNombre}`,
          impacto: `${m.tipo === "Entrada" ? "+ " : "− "}${m.cantidad} ${m.unidad || ""}`,
          impactoCls: ""
        }))
      ]
        .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""))
        .slice(0, 5);

      tbodyAct.innerHTML = combinados.length
        ? combinados
            .map(
              (c) => `
                <tr>
                  <td>${formatShortTime(c.fecha)}</td>
                  <td><span class="badge ${c.badgeCls}">${escapeHtml(c.modulo)}</span></td>
                  <td>${escapeHtml(c.detalle)}</td>
                  <td class="num ${c.impactoCls}">${escapeHtml(c.impacto)}</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="4" class="text-muted" style="text-align:center; padding:1.25rem">No hay movimientos registrados.</td></tr>`;
    }

    // 6. Productos más vendidos y Ventas por día
    const tbodyTop = $("#dash-mas-vendidos");
    if (tbodyTop) {
      tbodyTop.innerHTML = rep.productosMasVendidos.length
        ? rep.productosMasVendidos
            .slice(0, 5)
            .map(
              (p) => `
                <tr>
                  <td><b>${escapeHtml(p.nombre)}</b> <small class="text-muted">(${escapeHtml(p.codigo)})</small></td>
                  <td>${escapeHtml(p.categoria)}</td>
                  <td class="num">${p.cantidadVendida} ${escapeHtml(p.unidad)}</td>
                  <td class="num"><b>${formatCOP(p.totalIngresos)}</b></td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="4" class="text-muted" style="text-align:center; padding:1.25rem">No hay ventas registradas para calcular productos más vendidos.</td></tr>`;
    }

    const tbodyDias = $("#dash-ventas-por-dia");
    if (tbodyDias) {
      tbodyDias.innerHTML = rep.ventasPorPeriodo.length
        ? rep.ventasPorPeriodo
            .slice(0, 5)
            .map(
              (d) => `
                <tr>
                  <td><b>${escapeHtml(d.fecha)}</b></td>
                  <td class="num">${d.cantidadVentas} ventas</td>
                  <td class="num"><b>${formatCOP(d.totalVendido)}</b></td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="3" class="text-muted" style="text-align:center; padding:1.25rem">No hay ventas registradas en el período.</td></tr>`;
    }
  }

  const u1 = watchProductos((l) => { productos = l; renderDashboard(); });
  const u2 = watchVentas((l) => { ventas = l; renderDashboard(); });
  const u3 = watchCajas(({ cajaAbierta: c }) => { cajaAbierta = c; renderDashboard(); });
  const u4 = watchMovimientosContables((l) => { movsContables = l; renderDashboard(); });
  const u5 = watchMovimientosInventario((l) => { movsInventario = l; renderDashboard(); });

  return () => { u1(); u2(); u3(); u4(); u5(); };
}

// ---------------------------------------------------------------------------
// 4. VISTA DE CONSULTAS Y LOS 11 REPORTES OBLIGATORIOS (Sección 9)
// ---------------------------------------------------------------------------
export function mountReportesView(root) {
  const $ = (sel) => root.querySelector(sel);
  let productos = [];
  let ventas = [];
  let cajas = [];
  let movsContables = [];
  let movsInventario = [];
  let ultimoConsolidado = null;

  function poblarSelectorProductos() {
    const sel = $("#rep-producto");
    if (!sel) return;
    const prev = sel.value || "Todos";
    sel.innerHTML = [
      `<option value="Todos">Todos los productos</option>`,
      ...productos.map(
        (p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.nombre)} (${escapeHtml(p.codigo)})</option>`
      )
    ].join("");
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }

  function obtenerFiltrosActuales() {
    const usrRaw = ($("#rep-usuario")?.value || "").trim();
    return {
      desde: $("#rep-desde")?.value || "",
      hasta: $("#rep-hasta")?.value || "",
      productoId: $("#rep-producto")?.value || "Todos",
      categoria: $("#rep-categoria")?.value || "Todas",
      metodoPago: $("#rep-metodo")?.value || "Todos",
      estadoVenta: $("#rep-estado")?.value || "Todos",
      usuario: usrRaw || "Todos"
    };
  }

  function renderReportes() {
    const rep = generarReportesConsolidados(obtenerFiltrosActuales(), {
      productos,
      ventas,
      cajas,
      movsInventario,
      movsContables
    });
    ultimoConsolidado = rep;

    if ($("#rep-total-ventas")) $("#rep-total-ventas").textContent = formatCOP(rep.kpis.totalVentasPeriodo);
    if ($("#rep-note-ventas")) $("#rep-note-ventas").textContent = `${rep.kpis.cantidadVentasPeriodo} ventas efectivas`;
    if ($("#rep-total-ingresos")) $("#rep-total-ingresos").textContent = formatCOP(rep.kpis.ingresosPeriodo);
    if ($("#rep-note-ingresos")) $("#rep-note-ingresos").textContent = `${rep.kpis.countIngresosPeriodo} registros contables`;
    if ($("#rep-total-gastos")) $("#rep-total-gastos").textContent = formatCOP(rep.kpis.gastosPeriodo);
    if ($("#rep-note-gastos")) $("#rep-note-gastos").textContent = `${rep.kpis.countGastosPeriodo} registros contables`;
    if ($("#rep-valor-bodega")) $("#rep-valor-bodega").textContent = formatCOP(rep.kpis.valorBodegaVenta);
    if ($("#rep-note-bodega")) {
      $("#rep-note-bodega").textContent = `${rep.kpis.totalProductosActivos} productos activos (Costo: ${formatCOP(rep.kpis.valorBodegaCosto)})`;
    }

    // 1. Ventas por período
    const tbPeriodo = $("#rep-tabla-ventas-periodo");
    if (tbPeriodo) {
      tbPeriodo.innerHTML = rep.ventasPorPeriodo.length
        ? rep.ventasPorPeriodo
            .map(
              (r) => `
                <tr>
                  <td><b>${escapeHtml(r.fecha)}</b></td>
                  <td class="num">${r.cantidadVentas}</td>
                  <td class="num">${formatCOP(r.descuentos)}</td>
                  <td class="num"><b>${formatCOP(r.totalVendido)}</b></td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="4" class="text-muted" style="text-align:center; padding:1.25rem">No hay ventas registradas en el período seleccionado.</td></tr>`;
    }

    // 2. Detalle de ventas
    if ($("#rep-detalle-count")) $("#rep-detalle-count").textContent = `${rep.detalleVentas.length} líneas`;
    const tbDetalle = $("#rep-tabla-detalle-ventas");
    if (tbDetalle) {
      tbDetalle.innerHTML = rep.detalleVentas.length
        ? rep.detalleVentas
            .slice(0, 50)
            .map((d) => {
              const med = d.dimensiones
                ? ` · ${d.dimensiones.ancho}×${d.dimensiones.largo} ${d.dimensiones.unidadDimension || "m"} (${d.dimensiones.piezas} pza)`
                : "";
              return `
                <tr>
                  <td><b>${escapeHtml(d.numero)}</b></td>
                  <td>${formatShortDate(d.fecha)}</td>
                  <td>${escapeHtml(d.cliente)}</td>
                  <td>${escapeHtml(d.nombre)} <small class="text-muted">(${escapeHtml(d.codigo)}${escapeHtml(med)})</small></td>
                  <td class="num">${d.cantidad} ${escapeHtml(d.unidad)}</td>
                  <td class="num">${formatCOP(d.subtotal)}</td>
                  <td><span class="badge ${d.estado === "Completada" ? "badge-success" : "badge-danger"}">${escapeHtml(d.estado)}</span></td>
                </tr>
              `;
            })
            .join("")
        : `<tr><td colspan="7" class="text-muted" style="text-align:center; padding:1.25rem">No hay detalle de ventas para mostrar.</td></tr>`;
    }

    // 3. Productos más vendidos
    const tbMasVendidos = $("#rep-tabla-mas-vendidos");
    if (tbMasVendidos) {
      tbMasVendidos.innerHTML = rep.productosMasVendidos.length
        ? rep.productosMasVendidos
            .map(
              (p) => `
                <tr>
                  <td><b>${escapeHtml(p.nombre)}</b> <small class="text-muted">(${escapeHtml(p.codigo)})</small></td>
                  <td>${escapeHtml(p.categoria)}</td>
                  <td class="num">${p.cantidadVendida} ${escapeHtml(p.unidad)}</td>
                  <td class="num"><b>${formatCOP(p.totalIngresos)}</b></td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="4" class="text-muted" style="text-align:center; padding:1.25rem">No hay productos vendidos en el período.</td></tr>`;
    }

    // 4. Inventario actual
    if ($("#rep-inv-count")) $("#rep-inv-count").textContent = `${rep.inventarioActual.length} productos`;
    const tbInv = $("#rep-tabla-inventario");
    if (tbInv) {
      tbInv.innerHTML = rep.inventarioActual.length
        ? rep.inventarioActual
            .map(
              (p) => `
                <tr>
                  <td><b>${escapeHtml(p.codigo)}</b></td>
                  <td>${escapeHtml(p.nombre)}</td>
                  <td class="num">${p.stock} ${escapeHtml(p.unidad)}</td>
                  <td class="num">${formatCOP(p.precio)}</td>
                  <td class="num"><b>${formatCOP(p.valorVentaTotal)}</b></td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="5" class="text-muted" style="text-align:center; padding:1.25rem">No hay productos registrados.</td></tr>`;
    }

    // 5. Productos con stock bajo
    if ($("#rep-bajo-count")) $("#rep-bajo-count").textContent = `${rep.productosStockBajo.length} alertas`;
    const tbBajo = $("#rep-tabla-stock-bajo");
    if (tbBajo) {
      tbBajo.innerHTML = rep.productosStockBajo.length
        ? rep.productosStockBajo
            .map(
              (p) => `
                <tr>
                  <td><b>${escapeHtml(p.codigo)}</b></td>
                  <td>${escapeHtml(p.nombre)}</td>
                  <td class="num"><b>${p.stock} ${escapeHtml(p.unidad)}</b></td>
                  <td class="num">${p.stockMinimo} ${escapeHtml(p.unidad)}</td>
                  <td><span class="badge ${p.claseBadge}">${escapeHtml(p.estadoEtiqueta)}</span></td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="5" class="text-muted" style="text-align:center; padding:1.25rem">No hay productos con stock bajo o agotado.</td></tr>`;
    }

    // 6. Movimientos de inventario
    if ($("#rep-mov-inv-count")) $("#rep-mov-inv-count").textContent = `${rep.movimientosInventario.length} movimientos`;
    const tbMovInv = $("#rep-tabla-mov-inventario");
    if (tbMovInv) {
      tbMovInv.innerHTML = rep.movimientosInventario.length
        ? rep.movimientosInventario
            .slice(0, 40)
            .map(
              (m) => `
                <tr>
                  <td>${formatShortDate(m.fecha)}</td>
                  <td>${escapeHtml(m.productoNombre)}</td>
                  <td><span class="badge ${m.tipo === "Entrada" ? "badge-success" : "badge-warning"}">${escapeHtml(m.tipo)}</span> · ${escapeHtml(m.origen || "")}</td>
                  <td class="num">${m.tipo === "Entrada" ? "+ " : "− "}${m.cantidad} ${escapeHtml(m.unidad || "")}</td>
                  <td class="num">${m.stockNuevo ?? "—"}</td>
                  <td>${escapeHtml(m.motivo || "—")}</td>
                  <td>${escapeHtml(m.usuario || "—")}</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="7" class="text-muted" style="text-align:center; padding:1.25rem">No hay movimientos de inventario en el período.</td></tr>`;
    }

    // 7. Ingresos y gastos por categoría
    const tbCat = $("#rep-tabla-categorias");
    if (tbCat) {
      tbCat.innerHTML = rep.ingresosYGastosPorCategoria.length
        ? rep.ingresosYGastosPorCategoria
            .map(
              (g) => `
                <tr>
                  <td>${escapeHtml(g.categoria)}</td>
                  <td><span class="badge ${g.tipo === "Ingreso" ? "badge-success" : "badge-danger"}">${escapeHtml(g.tipo)}</span></td>
                  <td class="num">${g.movimientos}</td>
                  <td class="num ${g.tipo === "Ingreso" ? "text-income" : "text-expense"}">${g.tipo === "Ingreso" ? "+ " : "− "}${formatCOP(g.total)}</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="4" class="text-muted" style="text-align:center; padding:1.25rem">No hay movimientos contables en el período.</td></tr>`;
    }

    // 8. Métodos de pago
    const tbMetodos = $("#rep-tabla-metodos");
    if (tbMetodos) {
      const conMovimiento = rep.metodosDePago.filter((m) => m.operaciones > 0);
      tbMetodos.innerHTML = conMovimiento.length
        ? rep.metodosDePago
            .map(
              (m) => `
                <tr>
                  <td><b>${escapeHtml(m.metodo)}</b></td>
                  <td class="num">${m.operaciones}</td>
                  <td class="num">${formatCOP(m.total)}</td>
                  <td class="num">${m.porcentaje}%</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="4" class="text-muted" style="text-align:center; padding:1.25rem">Sin pagos registrados en el período.</td></tr>`;
    }

    // 9 y 10. Cierres de caja y diferencias de efectivo
    if ($("#rep-cierres-count")) $("#rep-cierres-count").textContent = `${rep.cierresDeCaja.length} cierres`;
    const tbCierres = $("#rep-tabla-cierres");
    if (tbCierres) {
      tbCierres.innerHTML = rep.cierresDeCaja.length
        ? rep.cierresDeCaja
            .map((c) => {
              const dif = roundCOP(c.diferencia || 0);
              return `
                <tr>
                  <td>${formatShortDate(c.fechaCierre)}</td>
                  <td>${escapeHtml(c.usuarioCierre || c.usuarioApertura)}</td>
                  <td class="num">${formatCOP(c.efectivoEsperado)}</td>
                  <td class="num">${formatCOP(c.efectivoContado)}</td>
                  <td class="num ${dif === 0 ? "text-income" : "text-expense"}">${formatCOP(dif)}</td>
                </tr>
              `;
            })
            .join("")
        : `<tr><td colspan="5" class="text-muted" style="text-align:center; padding:1.25rem">No hay cierres de caja registrados.</td></tr>`;
    }

    // 11. Anulaciones y devoluciones
    if ($("#rep-anulaciones-count")) {
      $("#rep-anulaciones-count").textContent = `${rep.anulacionesYDevoluciones.length} registros`;
    }
    const tbAnul = $("#rep-tabla-anulaciones");
    if (tbAnul) {
      tbAnul.innerHTML = rep.anulacionesYDevoluciones.length
        ? rep.anulacionesYDevoluciones
            .map(
              (a) => `
                <tr>
                  <td><span class="badge badge-danger">${escapeHtml(a.tipo)}</span></td>
                  <td><b>${escapeHtml(a.referencia || "—")}</b></td>
                  <td>${formatShortDate(a.fecha)}</td>
                  <td class="num text-expense">${formatCOP(a.monto)}</td>
                  <td>${escapeHtml(a.motivo)} <small class="text-muted">(${escapeHtml(a.usuario)})</small></td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="5" class="text-muted" style="text-align:center; padding:1.25rem">No hay anulaciones ni devoluciones en el período.</td></tr>`;
    }
  }

  $("#form-filtro-reportes")?.addEventListener("submit", (e) => {
    e.preventDefault();
    renderReportes();
  });

  ["#rep-desde", "#rep-hasta", "#rep-producto", "#rep-categoria", "#rep-metodo", "#rep-estado", "#rep-usuario"].forEach(
    (sel) => {
      $(sel)?.addEventListener("change", renderReportes);
      $(sel)?.addEventListener("input", renderReportes);
    }
  );

  $("#btn-exportar-csv")?.addEventListener("click", () => {
    if (!ultimoConsolidado) renderReportes();
    const tipo = $("#rep-csv-tipo")?.value || "ventas_periodo";
    const csv = generarCSVReporte(tipo, ultimoConsolidado);
    if (!csv) return;
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reporte-${tipo}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  const u1 = watchProductos(
    (l) => {
      productos = l;
      poblarSelectorProductos();
      renderReportes();
    },
    { incluirInactivos: true }
  );
  const u2 = watchVentas((l) => { ventas = l; renderReportes(); });
  const u3 = watchCajas(({ historial }) => { cajas = historial; renderReportes(); });
  const u4 = watchMovimientosContables((l) => { movsContables = l; renderReportes(); });
  const u5 = watchMovimientosInventario((l) => { movsInventario = l; renderReportes(); });

  return () => { u1(); u2(); u3(); u4(); u5(); };
}

// ---------------------------------------------------------------------------
// 5. VISTA DE USUARIOS Y SEGURIDAD (Sección 10)
// ---------------------------------------------------------------------------
export function mountUsuariosView(root) {
  const $ = (sel) => root.querySelector(sel);
  let usuarios = [];
  let auditoria = [];

  const feedbackEl = $("#usr-feedback");
  function showFeedback(msg, isError = false) {
    if (!feedbackEl) return;
    feedbackEl.textContent = msg;
    feedbackEl.className = `alert ${isError ? "alert-danger" : "alert-info"}`;
    feedbackEl.classList.remove("hidden");
  }

  function renderUsuarios() {
    const tbody = root.querySelector("#tabla-usuarios tbody");
    if (!tbody) return;

    tbody.innerHTML = usuarios.length
      ? usuarios
          .map((u) => {
            const activo = u.activo !== false;
            return `
              <tr>
                <td><b>${escapeHtml(u.nombre)}</b></td>
                <td>${escapeHtml(u.email)}</td>
                <td><span class="badge ${u.rol === "Administrador" ? "" : "badge-warning"}">${escapeHtml(u.rol)}</span></td>
                <td><span class="badge ${activo ? "badge-success" : "badge-danger"}">${activo ? "Activo" : "Inactivo"}</span></td>
                <td class="text-right" style="white-space:nowrap">
                  <button type="button" class="btn btn-outline" style="padding:.22rem .55rem; font-size:.76rem" data-edit-usr="${escapeHtml(u.id)}">Editar</button>
                  <button type="button" class="btn btn-outline" style="padding:.22rem .55rem; font-size:.76rem" data-toggle-usr="${escapeHtml(u.id)}">${activo ? "Desactivar" : "Activar"}</button>
                </td>
              </tr>
            `;
          })
          .join("")
      : `<tr><td colspan="5" style="text-align:center; padding:1.5rem" class="text-muted">No hay usuarios registrados.</td></tr>`;
  }

  function renderAuditoria() {
    const tbody = root.querySelector("#tabla-auditoria tbody");
    const countEl = $("#usr-auditoria-count");
    if (countEl) countEl.textContent = `${auditoria.length} eventos`;
    if (!tbody) return;

    tbody.innerHTML = auditoria.length
      ? auditoria
          .slice(0, 40)
          .map((a) => {
            const detalle =
              a.motivo ||
              a.concepto ||
              a.emailObjetivo ||
              a.numero ||
              (a.montoInicial !== undefined ? `Monto inicial: ${formatCOP(a.montoInicial)}` : "") ||
              (a.total !== undefined ? `Total: ${formatCOP(a.total)}` : "Operación auditada");
            return `
              <tr>
                <td>${formatDateTime(a.fecha)}</td>
                <td><span class="badge">${escapeHtml(a.accion)}</span></td>
                <td>${escapeHtml(a.usuario || "Sistema")}</td>
                <td>${escapeHtml(detalle)}</td>
              </tr>
            `;
          })
          .join("")
      : `<tr><td colspan="4" style="text-align:center; padding:1.5rem" class="text-muted">No hay eventos de auditoría registrados.</td></tr>`;
  }

  function abrirModalUsuario(usr = null) {
    const errEl = $("#usr-error");
    if (errEl) errEl.classList.add("hidden");
    const titulo = $("#titulo-usuario");
    const correoInput = $("#usr-correo");

    if (usr) {
      if (titulo) titulo.textContent = `Editar usuario · ${usr.nombre}`;
      if ($("#usr-id")) $("#usr-id").value = usr.id;
      if ($("#usr-nombre")) $("#usr-nombre").value = usr.nombre;
      if (correoInput) {
        correoInput.value = usr.email;
        correoInput.disabled = true;
      }
      if ($("#usr-rol")) $("#usr-rol").value = usr.rol;
      if ($("#usr-estado")) $("#usr-estado").value = usr.activo === false ? "inactivo" : "activo";
    } else {
      if (titulo) titulo.textContent = "Nuevo usuario autorizado";
      $("#form-usuario")?.reset();
      if ($("#usr-id")) $("#usr-id").value = "";
      if (correoInput) correoInput.disabled = false;
      if ($("#usr-estado")) $("#usr-estado").value = "activo";
    }

    $("#modal-usuario")?.classList.add("is-open");
  }

  $("#btn-nuevo-usuario")?.addEventListener("click", () => abrirModalUsuario(null));

  root.querySelector("#tabla-usuarios")?.addEventListener("click", async (e) => {
    const editBtn = e.target.closest("[data-edit-usr]");
    if (editBtn) {
      const usr = usuarios.find((u) => u.id === editBtn.dataset.editUsr);
      if (usr) abrirModalUsuario(usr);
      return;
    }
    const toggleBtn = e.target.closest("[data-toggle-usr]");
    if (toggleBtn) {
      const usr = usuarios.find((u) => u.id === toggleBtn.dataset.toggleUsr);
      if (!usr) return;
      try {
        const nuevoEstado = usr.activo === false;
        await actualizarUsuario({ id: usr.id, activo: nuevoEstado }, getCurrentUser());
        showFeedback(
          `Cuenta de "${usr.nombre}" ${nuevoEstado ? "activada" : "desactivada"} correctamente.`
        );
      } catch (err) {
        showFeedback(err.message, true);
      }
    }
  });

  $("#form-usuario")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("#usr-error");
    if (errEl) errEl.classList.add("hidden");
    try {
      const id = $("#usr-id")?.value;
      const nombre = $("#usr-nombre")?.value;
      const email = $("#usr-correo")?.value;
      const rol = $("#usr-rol")?.value;
      const activo = ($("#usr-estado")?.value || "activo") === "activo";

      if (id) {
        await actualizarUsuario({ id, nombre, rol, activo }, getCurrentUser());
        showFeedback(`Usuario "${nombre}" actualizado correctamente.`);
      } else {
        await crearUsuario({ nombre, email, rol }, getCurrentUser());
        showFeedback(`Usuario "${nombre}" (${rol}) registrado correctamente.`);
      }
      $("#modal-usuario")?.classList.remove("is-open");
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message;
        errEl.classList.remove("hidden");
      }
    }
  });

  const u1 = watchUsuarios((l) => { usuarios = l; renderUsuarios(); });
  const u2 = watchAuditoria((l) => { auditoria = l; renderAuditoria(); });

  return () => { u1(); u2(); };
}
