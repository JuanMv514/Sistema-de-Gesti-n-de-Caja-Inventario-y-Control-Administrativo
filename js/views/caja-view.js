// Controlador de la vista Caja y Ventas — Vidrios y Aluminios El Carmen.
// Conecta la plantilla de Caja y Ventas con inventario en tiempo real, apertura/cierre de caja,
// carrito con unidades enteras y decimales (m, m²), calculadora de cortes de vidrio en cm,
// cobro transaccional con idempotencia, comprobante imprimible e historial con anulaciones.

import { getCurrentUser, hasPermission } from "../auth.js";
import {
  watchProductos,
  filtrarCatalogo,
  getEstadoStock,
  formatCOP,
  roundQty,
  roundCOP,
  calcularAreaM2
} from "../services/inventario-service.js";
import { watchClientes, crearCliente } from "../services/clientes-service.js";
import {
  watchCajas,
  watchVentas,
  abrirCaja,
  cerrarCaja,
  registrarMovimientoEfectivoCaja,
  calcularTotalesVenta,
  evaluarPagos,
  registrarVenta,
  anularVenta,
  registrarDevolucionVenta,
  calcularArqueoCaja,
  filtrarHistorialVentas,
  generarDatosComprobante
} from "../services/caja-service.js";

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
  );
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

export function mountCajaView(root) {
  const $ = (sel) => root.querySelector(sel);

  let productos = [];
  let clientes = [];
  let cajaAbierta = null;
  let ventas = [];
  let categoriaActiva = "Todos";
  let cart = []; // [{ productoId, codigo, nombre, unidad, permiteDecimal, precioUnitario, cantidad, dimensiones }]
  let isProcessingSale = false;

  const feedbackEl = $("#pos-feedback");

  function showFeedback(message, type = "info") {
    if (!feedbackEl) return;
    feedbackEl.textContent = message;
    feedbackEl.className = `alert ${type === "danger" ? "alert-danger" : "alert-info"}`;
    feedbackEl.classList.remove("hidden");
  }

  function hideFeedback() {
    if (feedbackEl) feedbackEl.classList.add("hidden");
  }

  // -------------------------------------------------------------------------
  // 1. RENDERIZADO DEL ESTADO DE CAJA (ABIERTA / CERRADA)
  // -------------------------------------------------------------------------
  function renderEstadoCaja() {
    const user = getCurrentUser();
    const badgeEl = $("#caja-badge-estado");
    const metaEl = $("#caja-meta-info");
    const actionsEl = $("#caja-status-actions");
    const panelApertura = $("#panel-apertura-caja");
    const posWorkspace = $("#pos-workspace");

    if (!cajaAbierta) {
      if (badgeEl) {
        badgeEl.textContent = "Caja cerrada";
        badgeEl.className = "badge badge-warning";
      }
      if (metaEl) {
        metaEl.innerHTML = `<span>Debes abrir una caja antes de registrar ventas en este turno.</span>`;
      }
      if (actionsEl) actionsEl.classList.add("hidden");
      if (panelApertura) {
        panelApertura.classList.remove("hidden");
        const usrInput = $("#apertura-usuario");
        const fechaInput = $("#apertura-fecha");
        if (usrInput) usrInput.value = user.name || user.email;
        if (fechaInput) fechaInput.value = formatDateTime(new Date().toISOString());
      }
      if (posWorkspace) posWorkspace.style.opacity = "0.55";
      updateCobrarButtonState();
      return;
    }

    const arqueo = calcularArqueoCaja(cajaAbierta, ventas);
    if (badgeEl) {
      badgeEl.textContent = "Caja abierta";
      badgeEl.className = "badge badge-success";
    }
    if (metaEl && arqueo) {
      metaEl.innerHTML = `
        <span>Abierta por: <b>${escapeHtml(cajaAbierta.usuarioApertura)}</b></span>
        <span>Monto inicial: <b class="num">${formatCOP(arqueo.montoInicial)}</b></span>
        <span>Ventas del turno: <b>${arqueo.numeroVentas}</b></span>
        <span>Efectivo esperado: <b class="num">${formatCOP(arqueo.efectivoEsperado)}</b></span>
      `;
    }
    if (actionsEl) actionsEl.classList.remove("hidden");
    if (panelApertura) panelApertura.classList.add("hidden");
    if (posWorkspace) posWorkspace.style.opacity = "1";

    renderResumenModalCierre(arqueo);
    updateCobrarButtonState();
  }

  function renderResumenModalCierre(arqueo) {
    if (!arqueo) return;
    const setTxt = (sel, val) => {
      const el = $(sel);
      if (el) el.textContent = val;
    };
    setTxt("#cierre-responsable", arqueo.usuarioApertura);
    setTxt("#cierre-fecha-apertura", formatDateTime(arqueo.fechaApertura));
    setTxt("#cierre-cant-ventas", `${arqueo.numeroVentas} completadas / ${arqueo.numeroAnuladas} anuladas`);
    setTxt("#cierre-total-vendido", formatCOP(arqueo.totalVendido));
    setTxt("#cierre-base", formatCOP(arqueo.montoInicial));
    setTxt("#cierre-efectivo-ventas", formatCOP(arqueo.entradasEfectivoVentas));
    setTxt("#cierre-entradas-extra", formatCOP(arqueo.entradasEfectivoManual));
    setTxt("#cierre-salidas-extra", `− ${formatCOP(arqueo.totalSalidasEfectivo)}`);
    setTxt("#cierre-transferencia", formatCOP(arqueo.pagosPorMetodo.Transferencia || 0));
    setTxt(
      "#cierre-tarjeta",
      formatCOP((arqueo.pagosPorMetodo["Tarjeta débito"] || 0) + (arqueo.pagosPorMetodo["Tarjeta crédito"] || 0))
    );
    setTxt("#cierre-esperado", formatCOP(arqueo.efectivoEsperado));
    actualizarDiferenciaCierre();
  }

  function actualizarDiferenciaCierre() {
    if (!cajaAbierta) return;
    const arqueo = calcularArqueoCaja(cajaAbierta, ventas);
    const contadoEl = $("#efectivo-contado");
    const difEl = $("#cierre-diferencia");
    if (!contadoEl || !difEl || !arqueo) return;

    const raw = contadoEl.value.trim();
    const contado = raw === "" ? arqueo.efectivoEsperado : roundCOP(raw);
    const dif = roundCOP(contado - arqueo.efectivoEsperado);
    difEl.textContent = dif > 0 ? `+ ${formatCOP(dif)} (Sobrante)` : dif < 0 ? `${formatCOP(dif)} (Faltante)` : "$ 0 (Cuadre exacto)";
    difEl.className = `input num ${dif === 0 ? "text-income" : "text-expense"}`;
  }

  // -------------------------------------------------------------------------
  // 2. CATÁLOGO Y BÚSQUEDA DE PRODUCTOS (Sección 4)
  // -------------------------------------------------------------------------
  function renderCatalogo() {
    const gridEl = $("#product-grid");
    if (!gridEl) return;

    const busqueda = $("#buscar-producto")?.value || "";
    const filtrados = filtrarCatalogo(productos, {
      categoria: categoriaActiva,
      busqueda
    });

    if (filtrados.length === 0) {
      gridEl.innerHTML = `
        <div class="card" style="grid-column: 1 / -1">
          <div class="empty" style="padding:1.75rem">
            <h3>Sin coincidencias</h3>
            <p>No se encontraron productos para esta búsqueda o categoría.</p>
          </div>
        </div>
      `;
      return;
    }

    gridEl.innerHTML = filtrados
      .map((p) => {
        const estado = getEstadoStock(p);
        const agotado = estado.codigo === "agotado";
        const siglas = escapeHtml(
          p.codigo
            ? p.codigo.split("-")[0]
            : p.nombre
                .split(" ")
                .slice(0, 2)
                .map((w) => w[0])
                .join("")
                .toUpperCase()
        );
        return `
          <button type="button" class="product-card" data-add-prod="${escapeHtml(p.id)}" ${agotado ? "disabled" : ""}>
            <div class="product-thumb" style="display:flex; justify-content:space-between; align-items:center; padding:0 .65rem">
              <span>${siglas}</span>
              <span class="badge ${estado.claseBadge}" style="font-size:.68rem">${estado.etiqueta}</span>
            </div>
            <span class="product-name">${escapeHtml(p.nombre)}</span>
            <span class="product-meta">Cód: <b>${escapeHtml(p.codigo)}</b> · ${escapeHtml(p.categoria)}</span>
            <span class="product-meta">Disponible: <b>${p.stock} ${escapeHtml(p.unidad)}</b></span>
            <span class="product-price num">${formatCOP(p.precio)} <small style="font-weight:500; font-size:.75rem; color:var(--text-muted)">/ ${escapeHtml(p.unidad)}</small></span>
          </button>
        `;
      })
      .join("");

    // Poblar también el selector del modal de corte a medida (m²)
    const medSelect = $("#med-producto");
    if (medSelect) {
      const m2Prods = productos.filter((p) => p.unidad === "m²" && p.stock > 0);
      medSelect.innerHTML = m2Prods.length
        ? m2Prods
            .map(
              (p) =>
                `<option value="${escapeHtml(p.id)}">${escapeHtml(p.nombre)} (${formatCOP(p.precio)} / m² · Disp: ${p.stock} m²)</option>`
            )
            .join("")
        : `<option value="">Sin vidrios o espejos disponibles</option>`;
    }
  }

  // -------------------------------------------------------------------------
  // 3. CARRITO DE VENTA ACTUAL, UNIDADES Y CÁLCULOS (Secciones 5, 6 y 8)
  // -------------------------------------------------------------------------
  function getCantidadEnCarrito(productoId) {
    return roundQty(
      cart
        .filter((i) => i.productoId === productoId)
        .reduce((acc, i) => acc + Number(i.cantidad || 0), 0)
    );
  }

  function agregarProductoAlCarrito(productoId, cantidadAgregar = 1, dimensiones = null) {
    hideFeedback();
    if (!cajaAbierta) {
      showFeedback("Debes abrir una caja antes de registrar ventas.", "danger");
      return;
    }

    const prod = productos.find((p) => p.id === productoId);
    if (!prod) {
      showFeedback("Producto no encontrado en el inventario.", "danger");
      return;
    }

    const cantSolicitada = roundQty(cantidadAgregar);
    if (!(cantSolicitada > 0)) {
      showFeedback("La cantidad debe ser mayor que cero.", "danger");
      return;
    }

    const enCarrito = getCantidadEnCarrito(prod.id);
    if (roundQty(enCarrito + cantSolicitada) > roundQty(prod.stock)) {
      showFeedback(
        `No hay existencias suficientes para esta cantidad (${prod.nombre}: disponible ${prod.stock} ${prod.unidad}).`,
        "danger"
      );
      return;
    }

    // Si es producto estándar sin corte especial y ya está en el carrito, incrementar su cantidad
    const existingIndex = !dimensiones
      ? cart.findIndex((i) => i.productoId === prod.id && !i.dimensiones)
      : -1;

    if (existingIndex >= 0) {
      cart[existingIndex].cantidad = roundQty(cart[existingIndex].cantidad + cantSolicitada);
      cart[existingIndex].precioUnitario = roundCOP(prod.precio);
    } else {
      cart.push({
        lineId: `line-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        productoId: prod.id,
        codigo: prod.codigo,
        nombre: prod.nombre,
        unidad: prod.unidad,
        permiteDecimal: Boolean(prod.permiteDecimal || prod.unidad === "m" || prod.unidad === "m²"),
        precioUnitario: roundCOP(prod.precio),
        cantidad: cantSolicitada,
        dimensiones
      });
    }

    renderCarrito();
  }

  function actualizarCantidadLinea(lineId, nuevaCantidad) {
    hideFeedback();
    const idx = cart.findIndex((i) => i.lineId === lineId);
    if (idx === -1) return;

    const item = cart[idx];
    const prod = productos.find((p) => p.id === item.productoId);
    if (!prod) return;

    const cant = roundQty(nuevaCantidad);
    if (!(cant > 0)) {
      showFeedback("La cantidad no puede ser cero ni negativa. Usa el botón × para eliminar la línea.", "danger");
      renderCarrito();
      return;
    }
    if (!item.permiteDecimal && !Number.isInteger(cant)) {
      showFeedback(`El producto "${item.nombre}" solo admite unidades enteras.`, "danger");
      renderCarrito();
      return;
    }

    const otrosMismoProd = roundQty(
      cart
        .filter((i) => i.productoId === item.productoId && i.lineId !== lineId)
        .reduce((s, i) => s + i.cantidad, 0)
    );
    if (roundQty(otrosMismoProd + cant) > roundQty(prod.stock)) {
      showFeedback(
        `No hay existencias suficientes para esta cantidad (máximo disponible: ${prod.stock} ${prod.unidad}).`,
        "danger"
      );
      renderCarrito();
      return;
    }

    cart[idx].cantidad = cant;
    cart[idx].precioUnitario = roundCOP(prod.precio);
    renderCarrito();
  }

  function eliminarLineaCarrito(lineId) {
    cart = cart.filter((i) => i.lineId !== lineId);
    renderCarrito();
  }

  function obtenerPagosFormulario(totalVenta) {
    const metodo = $("#metodo-pago")?.value || "Efectivo";
    if (metodo === "Efectivo") {
      const raw = $("#recibido")?.value;
      const recibido = raw === "" || raw === undefined ? 0 : roundCOP(raw);
      return [{ metodo: "Efectivo", importe: recibido }];
    }
    if (metodo === "Mixto") {
      const ef = roundCOP($("#mixto-efectivo")?.value || 0);
      const otroMetodo = $("#mixto-otro-metodo")?.value || "Transferencia";
      const otroImp = roundCOP($("#mixto-otro-importe")?.value || 0);
      const ref = $("#mixto-referencia")?.value || "";
      const lista = [];
      if (ef > 0) lista.push({ metodo: "Efectivo", importe: ef });
      if (otroImp > 0) lista.push({ metodo: otroMetodo, importe: otroImp, referencia: ref });
      return lista;
    }
    return [
      {
        metodo,
        importe: roundCOP(totalVenta),
        referencia: $("#referencia-pago")?.value || ""
      }
    ];
  }

  function renderCarrito() {
    const listEl = $("#cart-items");
    const emptyEl = $("#cart-empty");
    if (!listEl || !emptyEl) return;

    if (cart.length === 0) {
      listEl.innerHTML = "";
      emptyEl.classList.remove("hidden");
    } else {
      emptyEl.classList.add("hidden");
      listEl.innerHTML = cart
        .map((item) => {
          const subtotal = roundCOP(item.precioUnitario * item.cantidad);
          const step = item.permiteDecimal ? "0.01" : "1";
          const dimText = item.dimensiones
            ? `<br><span class="unit">Corte: ${item.dimensiones.anchoCm}×${item.dimensiones.altoCm} cm (${item.dimensiones.piezas} pza)</span>`
            : "";
          return `
            <li class="cart-item" data-line="${escapeHtml(item.lineId)}">
              <span class="name">
                ${escapeHtml(item.nombre)} <small class="text-muted">(${escapeHtml(item.codigo)})</small>
                <br><span class="unit num">${formatCOP(item.precioUnitario)} / ${escapeHtml(item.unidad)}</span>
                ${dimText}
              </span>
              <span class="sub num">${formatCOP(subtotal)}</span>
              <span class="qty">
                <button type="button" data-qty-dec="${escapeHtml(item.lineId)}" aria-label="Disminuir">−</button>
                <input
                  type="number"
                  min="${step}"
                  step="${step}"
                  value="${item.cantidad}"
                  data-qty-input="${escapeHtml(item.lineId)}"
                  aria-label="Cantidad de ${escapeHtml(item.nombre)}"
                  style="width:54px; text-align:center; border:0; font-weight:600; font-size:.86rem"
                >
                <button type="button" data-qty-inc="${escapeHtml(item.lineId)}" aria-label="Aumentar">+</button>
              </span>
              <button
                type="button"
                data-line-del="${escapeHtml(item.lineId)}"
                title="Eliminar producto"
                aria-label="Eliminar producto"
                style="justify-self:end; border:0; background:none; color:var(--danger); font-weight:700; cursor:pointer; padding:.2rem .4rem"
              >×</button>
            </li>
          `;
        })
        .join("");
    }

    recalcularResumenPago();
  }

  function recalcularResumenPago() {
    const descInput = $("#cart-descuento-input");
    const user = getCurrentUser();
    if (descInput) {
      const puedeDescuento = hasPermission("ventas.descuento", user);
      descInput.disabled = !puedeDescuento;
      if (!puedeDescuento) descInput.value = "0";
    }

    const descuento = Math.max(0, roundCOP(descInput?.value || 0));
    let calculo = { subtotal: 0, descuento: 0, impuesto: 0, total: 0 };
    const errEl = $("#cart-error");
    if (errEl) {
      errEl.textContent = "";
      errEl.classList.add("hidden");
    }

    try {
      if (cart.length > 0) {
        calculo = calcularTotalesVenta(cart, { descuento });
      }
    } catch (e) {
      if (errEl) {
        errEl.textContent = e.message;
        errEl.classList.remove("hidden");
      }
    }

    const subEl = $("#cart-subtotal");
    const rowDesc = $("#row-descuento");
    const descEl = $("#cart-descuento");
    const totEl = $("#cart-total");

    if (subEl) subEl.textContent = formatCOP(calculo.subtotal);
    if (rowDesc && descEl) {
      rowDesc.classList.toggle("hidden", calculo.descuento <= 0);
      descEl.textContent = `− ${formatCOP(calculo.descuento)}`;
    }
    if (totEl) totEl.textContent = formatCOP(calculo.total);

    // Visibilidad según método de pago seleccionado
    const metodo = $("#metodo-pago")?.value || "Efectivo";
    $("#box-pago-efectivo")?.classList.toggle("hidden", metodo !== "Efectivo");
    $("#box-pago-electronico")?.classList.toggle(
      "hidden",
      metodo === "Efectivo" || metodo === "Mixto"
    );
    $("#box-pago-mixto")?.classList.toggle("hidden", metodo !== "Mixto");
    $("#row-cambio")?.classList.toggle(
      "hidden",
      metodo !== "Efectivo" && metodo !== "Mixto"
    );

    updateCobrarButtonState(calculo.total);
  }

  function updateCobrarButtonState(totalActual = null) {
    const btnCobrar = $("#btn-cobrar");
    const labelCambio = $("#label-cambio-faltante");
    const cambioEl = $("#cart-cambio");
    const errEl = $("#cart-error");
    if (!btnCobrar) return;

    const descuento = Math.max(0, roundCOP($("#cart-descuento-input")?.value || 0));
    let total = totalActual;
    if (total === null) {
      try {
        total = cart.length ? calcularTotalesVenta(cart, { descuento }).total : 0;
      } catch {
        total = 0;
      }
    }

    if (!cajaAbierta || cart.length === 0 || !(total > 0) || isProcessingSale) {
      btnCobrar.disabled = true;
      if (labelCambio) labelCambio.textContent = "Cambio";
      if (cambioEl) {
        cambioEl.textContent = "$ 0";
        cambioEl.className = "num";
      }
      return;
    }

    try {
      const pagos = obtenerPagosFormulario(total);
      const ev = evaluarPagos({ total, pagos });
      if (!ev.completo) {
        if (labelCambio) labelCambio.textContent = "Faltante";
        if (cambioEl) {
          cambioEl.textContent = formatCOP(ev.faltante);
          cambioEl.className = "num text-expense";
        }
        btnCobrar.disabled = true;
      } else {
        if (labelCambio) labelCambio.textContent = "Cambio";
        if (cambioEl) {
          cambioEl.textContent = formatCOP(ev.cambio);
          cambioEl.className = "num text-income";
        }
        btnCobrar.disabled = false;
      }
    } catch {
      if (labelCambio) labelCambio.textContent = "Faltante";
      if (cambioEl) {
        cambioEl.textContent = formatCOP(total);
        cambioEl.className = "num text-expense";
      }
      if (errEl && !errEl.textContent) {
        // Sin mensaje intrusivo mientras escribe
      }
      btnCobrar.disabled = true;
    }
  }

  // -------------------------------------------------------------------------
  // 4. CLIENTES E HISTORIAL DE VENTAS (Secciones 7, 10, 11 y 13)
  // -------------------------------------------------------------------------
  function renderSelectorClientes(seleccionarId = null) {
    const sel = $("#pos-cliente");
    if (!sel) return;
    const prev = seleccionarId || sel.value || "cli-consumidor";
    sel.innerHTML = clientes
      .map(
        (c) =>
          `<option value="${escapeHtml(c.id)}">${escapeHtml(c.nombre)} · ${escapeHtml(c.documento)}</option>`
      )
      .join("");
    if (clientes.some((c) => c.id === prev)) sel.value = prev;
  }

  function renderHistorialVentas() {
    const tbody = $("#tbody-historial-ventas");
    const countEl = $("#historial-ventas-count");
    if (!tbody) return;

    const filtradas = filtrarHistorialVentas(ventas, {
      busqueda: $("#hist-buscar")?.value || "",
      desde: $("#hist-desde")?.value || "",
      hasta: $("#hist-hasta")?.value || "",
      metodoPago: $("#hist-metodo")?.value || "Todos",
      estado: $("#hist-estado")?.value || "Todos"
    });

    if (countEl) countEl.textContent = `${filtradas.length} ventas`;

    if (filtradas.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:1.5rem" class="text-muted">No hay ventas que coincidan con los filtros seleccionados.</td></tr>`;
      return;
    }

    const puedeAnular = hasPermission("ventas.anular", getCurrentUser());

    tbody.innerHTML = filtradas
      .map((v) => {
        const badgeCls = v.estado === "Completada" ? "badge-success" : "badge-danger";
        return `
          <tr>
            <td><b>${escapeHtml(v.numero)}</b></td>
            <td>${formatDateTime(v.fecha)}</td>
            <td>${escapeHtml(v.cliente?.nombre || "Consumidor Final")}</td>
            <td>${escapeHtml(v.vendedor)}</td>
            <td><span class="badge">${escapeHtml(v.metodoPago)}</span></td>
            <td class="num"><b>${formatCOP(v.total)}</b></td>
            <td><span class="badge ${badgeCls}">${escapeHtml(v.estado)}</span></td>
            <td class="text-right" style="white-space:nowrap">
              <button type="button" class="btn btn-outline" style="padding:.25rem .6rem; font-size:.78rem" data-ver-comprobante="${escapeHtml(v.id)}">Comprobante</button>
              ${
                v.estado === "Completada" && puedeAnular
                  ? `<button type="button" class="btn btn-outline" style="padding:.25rem .6rem; font-size:.78rem; color:var(--danger); border-color:var(--danger)" data-abrir-anular="${escapeHtml(v.id)}">Anular / Devolver</button>`
                  : ""
              }
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function mostrarModalComprobante(venta) {
    const comp = generarDatosComprobante(venta);
    const body = $("#comprobante-body");
    const modal = $("#modal-comprobante");
    if (!body || !modal) return;

    const filasProd = comp.items
      .map(
        (i) => `
          <tr>
            <td>${escapeHtml(i.nombre)} <small class="text-muted">(${escapeHtml(i.codigo)})</small></td>
            <td class="num">${i.cantidad} ${escapeHtml(i.unidad)}</td>
            <td class="num">${formatCOP(i.precioUnitario)}</td>
            <td class="num">${formatCOP(i.subtotal)}</td>
          </tr>
        `
      )
      .join("");

    const filasPagos = comp.pagos
      .map(
        (p) =>
          `<div class="summary-row"><span>Pago (${escapeHtml(p.metodo)}${p.referencia ? ` · Ref: ${escapeHtml(p.referencia)}` : ""})</span><span class="num">${formatCOP(p.importe)}</span></div>`
      )
      .join("");

    body.innerHTML = `
      <div style="border:1px solid var(--border); border-radius:var(--radius-sm); padding:1rem">
        <div style="text-align:center; border-bottom:1px dashed var(--border); padding-bottom:.75rem; margin-bottom:.75rem">
          <h4 style="margin:0">${escapeHtml(comp.establecimiento)}</h4>
          <p class="text-muted" style="margin:.15rem 0; font-size:.82rem">${escapeHtml(comp.tipoDocumento)} · <b>${escapeHtml(comp.numero)}</b></p>
          <span class="badge ${comp.estado === "Completada" ? "badge-success" : "badge-danger"}">${escapeHtml(comp.estado)}</span>
        </div>
        <div class="summary" style="font-size:.84rem">
          <div class="summary-row"><span>Fecha y hora:</span><span>${formatDateTime(comp.fecha)}</span></div>
          <div class="summary-row"><span>Atendido por:</span><span>${escapeHtml(comp.vendedor)}</span></div>
          <div class="summary-row"><span>Cliente:</span><span>${escapeHtml(comp.cliente.nombre)} (${escapeHtml(comp.cliente.documento)})</span></div>
          ${comp.ordenReferencia ? `<div class="summary-row"><span>Referencia pedido:</span><span>${escapeHtml(comp.ordenReferencia)}</span></div>` : ""}
        </div>
        <div class="table-wrap" style="margin:.75rem 0">
          <table class="table" style="font-size:.82rem">
            <thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">Unitario</th><th class="num">Subtotal</th></tr></thead>
            <tbody>${filasProd}</tbody>
          </table>
        </div>
        <div class="summary">
          <div class="summary-row"><span>Subtotal</span><span class="num">${formatCOP(comp.subtotal)}</span></div>
          ${comp.descuento > 0 ? `<div class="summary-row"><span>Descuento</span><span class="num text-expense">− ${formatCOP(comp.descuento)}</span></div>` : ""}
          <div class="summary-row total"><span>Total venta</span><span class="num">${formatCOP(comp.total)}</span></div>
          ${filasPagos}
          <div class="summary-row"><span>Total recibido</span><span class="num">${formatCOP(comp.valorRecibido)}</span></div>
          <div class="summary-row"><span>Cambio entregado</span><b class="num">${formatCOP(comp.cambio)}</b></div>
        </div>
        <p class="text-muted" style="margin:.75rem 0 0; font-size:.74rem; text-align:center">${escapeHtml(comp.leyendaLegal)}</p>
      </div>
    `;
    modal.classList.add("is-open");
  }

  // -------------------------------------------------------------------------
  // 5. EVENTOS DE INTERFAZ Y FORMULARIOS
  // -------------------------------------------------------------------------
  $("#buscar-producto")?.addEventListener("input", renderCatalogo);

  $("#pos-categorias")?.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-categoria]");
    if (!chip) return;
    categoriaActiva = chip.dataset.categoria;
    root.querySelectorAll("#pos-categorias .chip").forEach((c) =>
      c.classList.toggle("active", c.dataset.categoria === categoriaActiva)
    );
    renderCatalogo();
  });

  $("#product-grid")?.addEventListener("click", (e) => {
    const card = e.target.closest("[data-add-prod]");
    if (!card || card.disabled) return;
    agregarProductoAlCarrito(card.dataset.addProd, 1);
  });

  $("#cart-items")?.addEventListener("click", (e) => {
    const inc = e.target.closest("[data-qty-inc]");
    if (inc) {
      const item = cart.find((i) => i.lineId === inc.dataset.qtyInc);
      if (item) actualizarCantidadLinea(item.lineId, roundQty(item.cantidad + 1));
      return;
    }
    const dec = e.target.closest("[data-qty-dec]");
    if (dec) {
      const item = cart.find((i) => i.lineId === dec.dataset.qtyDec);
      if (item) {
        const nueva = roundQty(item.cantidad - 1);
        if (nueva <= 0) eliminarLineaCarrito(item.lineId);
        else actualizarCantidadLinea(item.lineId, nueva);
      }
      return;
    }
    const del = e.target.closest("[data-line-del]");
    if (del) {
      eliminarLineaCarrito(del.dataset.lineDel);
    }
  });

  $("#cart-items")?.addEventListener("change", (e) => {
    const input = e.target.closest("[data-qty-input]");
    if (!input) return;
    actualizarCantidadLinea(input.dataset.qtyInput, Number(input.value));
  });

  $("#btn-vaciar")?.addEventListener("click", () => {
    cart = [];
    renderCarrito();
  });

  ["#cart-descuento-input", "#metodo-pago", "#recibido", "#referencia-pago", "#mixto-efectivo", "#mixto-otro-metodo", "#mixto-otro-importe", "#mixto-referencia"].forEach((sel) => {
    $(sel)?.addEventListener("input", recalcularResumenPago);
    $(sel)?.addEventListener("change", recalcularResumenPago);
  });

  // Abrir modal de calculadora de vidrio a medida
  $("#btn-medida-vidrio")?.addEventListener("click", () => {
    $("#modal-medidas")?.classList.add("is-open");
    actualizarCalculoMedidasModal();
  });

  function actualizarCalculoMedidasModal() {
    const resEl = $("#med-area-resultado");
    const errEl = $("#med-error");
    if (!resEl) return;
    if (errEl) errEl.classList.add("hidden");
    try {
      const area = calcularAreaM2({
        anchoCm: $("#med-ancho")?.value,
        altoCm: $("#med-alto")?.value,
        piezas: $("#med-piezas")?.value
      });
      resEl.textContent = `${area} m²`;
    } catch (e) {
      resEl.textContent = "0 m²";
      if (errEl) {
        errEl.textContent = e.message;
        errEl.classList.remove("hidden");
      }
    }
  }

  ["#med-ancho", "#med-alto", "#med-piezas"].forEach((sel) => {
    $(sel)?.addEventListener("input", actualizarCalculoMedidasModal);
  });

  $("#form-medidas")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const errEl = $("#med-error");
    if (errEl) errEl.classList.add("hidden");
    try {
      const prodId = $("#med-producto")?.value;
      const anchoCm = Number($("#med-ancho")?.value);
      const altoCm = Number($("#med-alto")?.value);
      const piezas = Number($("#med-piezas")?.value);
      const area = calcularAreaM2({ anchoCm, altoCm, piezas });
      agregarProductoAlCarrito(prodId, area, { anchoCm, altoCm, piezas });
      $("#modal-medidas")?.classList.remove("is-open");
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message;
        errEl.classList.remove("hidden");
      }
    }
  });

  // Formulario de Apertura de Caja
  $("#form-apertura-caja")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("#apertura-error");
    if (errEl) errEl.classList.add("hidden");
    try {
      const monto = $("#apertura-monto")?.value;
      const obs = $("#apertura-obs")?.value || "";
      await abrirCaja({ montoInicial: monto, observaciones: obs }, getCurrentUser());
      $("#form-apertura-caja").reset();
      showFeedback("Caja abierta correctamente. Puedes iniciar el registro de ventas.", "info");
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message;
        errEl.classList.remove("hidden");
      }
    }
  });

  // Cobrar venta actual
  $("#btn-cobrar")?.addEventListener("click", async () => {
    if (isProcessingSale) return;
    hideFeedback();
    const errEl = $("#cart-error");
    if (errEl) errEl.classList.add("hidden");

    isProcessingSale = true;
    updateCobrarButtonState();

    try {
      const descuento = Math.max(0, roundCOP($("#cart-descuento-input")?.value || 0));
      const { total } = calcularTotalesVenta(cart, { descuento });
      const pagos = obtenerPagosFormulario(total);
      const idempotencyKey = `sale-${cajaAbierta?.id || "nocaja"}-${Date.now()}`;

      const ventaConfirmada = await registrarVenta(
        {
          cajaId: cajaAbierta?.id,
          items: cart,
          pagos,
          descuento,
          clienteId: $("#pos-cliente")?.value || "cli-consumidor",
          ordenReferencia: $("#pos-orden-ref")?.value || "",
          idempotencyKey
        },
        getCurrentUser()
      );

      // Limpiar carrito solo tras éxito de la transacción
      cart = [];
      if ($("#recibido")) $("#recibido").value = "";
      if ($("#referencia-pago")) $("#referencia-pago").value = "";
      if ($("#pos-orden-ref")) $("#pos-orden-ref").value = "";
      if ($("#cart-descuento-input")) $("#cart-descuento-input").value = "0";
      renderCarrito();

      showFeedback(`La venta ${ventaConfirmada.numero} se registró correctamente.`, "info");
      mostrarModalComprobante(ventaConfirmada);
    } catch (err) {
      // No limpiar el carrito si el cobro falla (Requisito 9 y Prueba 16)
      const msg = err.message || "No se pudo registrar la venta. No se han aplicado cambios.";
      if (errEl) {
        errEl.textContent = msg;
        errEl.classList.remove("hidden");
      }
      showFeedback(msg, "danger");
    } finally {
      isProcessingSale = false;
      updateCobrarButtonState();
    }
  });

  // Crear cliente rápido desde POS
  $("#form-cliente-pos")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("#cli-pos-error");
    if (errEl) errEl.classList.add("hidden");
    try {
      const nuevo = await crearCliente(
        {
          nombre: $("#cli-pos-nombre")?.value,
          documento: $("#cli-pos-doc")?.value,
          telefono: $("#cli-pos-tel")?.value
        },
        getCurrentUser()
      );
      $("#form-cliente-pos").reset();
      $("#modal-cliente-pos")?.classList.remove("is-open");
      renderSelectorClientes(nuevo.id);
      showFeedback(`Cliente "${nuevo.nombre}" registrado y seleccionado.`, "info");
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message;
        errEl.classList.remove("hidden");
      }
    }
  });

  // Movimiento manual de efectivo en caja
  $("#form-mov-caja")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("#mov-caja-error");
    if (errEl) errEl.classList.add("hidden");
    try {
      await registrarMovimientoEfectivoCaja(
        {
          cajaId: cajaAbierta?.id,
          tipo: $("#mov-caja-tipo")?.value,
          monto: $("#mov-caja-monto")?.value,
          concepto: $("#mov-caja-concepto")?.value
        },
        getCurrentUser()
      );
      $("#form-mov-caja").reset();
      $("#modal-mov-caja")?.classList.remove("is-open");
      showFeedback("Movimiento de efectivo registrado en la caja actual.", "info");
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message;
        errEl.classList.remove("hidden");
      }
    }
  });

  // Arqueo y Cierre de Caja
  $("#efectivo-contado")?.addEventListener("input", actualizarDiferenciaCierre);

  $("#form-cierre")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("#cierre-error");
    if (errEl) errEl.classList.add("hidden");
    try {
      const cerrada = await cerrarCaja(
        {
          cajaId: cajaAbierta?.id,
          efectivoContado: $("#efectivo-contado")?.value,
          observaciones: $("#obs-cierre")?.value
        },
        getCurrentUser()
      );
      $("#form-cierre").reset();
      $("#modal-cierre")?.classList.remove("is-open");
      cart = [];
      renderCarrito();
      showFeedback(
        `Caja cerrada correctamente. Efectivo esperado: ${formatCOP(cerrada.efectivoEsperado)} · Contado: ${formatCOP(cerrada.efectivoContado)} · Diferencia: ${formatCOP(cerrada.diferencia)}.`,
        "info"
      );
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message;
        errEl.classList.remove("hidden");
      }
    }
  });

  // Filtros de historial de ventas
  ["#hist-buscar", "#hist-desde", "#hist-hasta", "#hist-metodo", "#hist-estado"].forEach((sel) => {
    $(sel)?.addEventListener("input", renderHistorialVentas);
    $(sel)?.addEventListener("change", renderHistorialVentas);
  });

  // Acciones en la tabla de historial (Ver comprobante / Anular o Devolver)
  $("#tbody-historial-ventas")?.addEventListener("click", (e) => {
    const btnComp = e.target.closest("[data-ver-comprobante]");
    if (btnComp) {
      const v = ventas.find((x) => x.id === btnComp.dataset.verComprobante);
      if (v) mostrarModalComprobante(v);
      return;
    }
    const btnAnular = e.target.closest("[data-abrir-anular]");
    if (btnAnular) {
      const v = ventas.find((x) => x.id === btnAnular.dataset.abrirAnular);
      if (!v) return;
      $("#anular-venta-id").value = v.id;
      $("#anular-venta-resumen").textContent = `${v.numero} · ${v.cliente?.nombre || ""} · ${formatCOP(v.total)}`;
      $("#anular-motivo").value = "";
      $("#anular-error")?.classList.add("hidden");
      $("#modal-anular-venta")?.classList.add("is-open");
    }
  });

  $("#form-anular-venta")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("#anular-error");
    if (errEl) errEl.classList.add("hidden");
    try {
      const ventaId = $("#anular-venta-id")?.value;
      const tipoOp = $("#anular-tipo-operacion")?.value || "Anular";
      const reintegrar = ($("#anular-reintegrar")?.value || "si") === "si";
      const motivo = $("#anular-motivo")?.value;
      const ventaOrig = ventas.find((x) => x.id === ventaId);

      if (tipoOp === "Anular") {
        await anularVenta({ ventaId, motivo, reintegrarInventario: reintegrar }, getCurrentUser());
        showFeedback(`Venta ${ventaOrig?.numero || ""} anulada con registro de auditoría.`, "info");
      } else {
        await registrarDevolucionVenta(
          {
            ventaId,
            itemsDevueltos: (ventaOrig?.items || []).map((i) => ({
              productoId: i.productoId,
              cantidad: i.cantidad,
              aptoInventario: reintegrar
            })),
            motivo,
            reintegrarStock: reintegrar,
            reembolsoEfectivo: true
          },
          getCurrentUser()
        );
        showFeedback(`Devolución registrada sobre la venta ${ventaOrig?.numero || ""}.`, "info");
      }
      $("#modal-anular-venta")?.classList.remove("is-open");
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message;
        errEl.classList.remove("hidden");
      }
    }
  });

  $("#btn-imprimir-comprobante")?.addEventListener("click", () => {
    window.print();
  });

  // -------------------------------------------------------------------------
  // 6. SUSCRIPCIONES EN TIEMPO REAL
  // -------------------------------------------------------------------------
  const unsubProd = watchProductos((lista) => {
    productos = lista;
    renderCatalogo();
    renderCarrito();
  });

  const unsubCli = watchClientes((lista) => {
    clientes = lista;
    renderSelectorClientes();
  });

  const unsubCajas = watchCajas(({ cajaAbierta: abierta }) => {
    cajaAbierta = abierta;
    renderEstadoCaja();
  });

  const unsubVentas = watchVentas((lista) => {
    ventas = lista;
    renderEstadoCaja();
    renderHistorialVentas();
  });

  return () => {
    unsubProd();
    unsubCli();
    unsubCajas();
    unsubVentas();
  };
}
