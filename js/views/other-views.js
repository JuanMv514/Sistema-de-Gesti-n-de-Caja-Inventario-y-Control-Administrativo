// Controladores en tiempo real para Inventario, Contabilidad, Dashboard y Reportes.
// Sincroniza todas las pantallas con las colecciones reales (productos, ventas, cajas,
// movimientos_inventario y movimientos_contables), sin depender de datos estáticos.

import { getCurrentUser } from "../auth.js";
import {
  watchProductos,
  watchMovimientosInventario,
  getEstadoStock,
  formatCOP,
  roundCOP,
  crearProducto,
  registrarMovimientoBodega
} from "../services/inventario-service.js";
import {
  watchMovimientosContables,
  calcularResumenContable,
  registrarMovimientoContable,
  TIPOS_CONTABLE
} from "../services/contabilidad-service.js";
import {
  watchCajas,
  watchVentas,
  calcularArqueoCaja
} from "../services/caja-service.js";

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

// ---------------------------------------------------------------------------
// 1. VISTA DE INVENTARIO
// ---------------------------------------------------------------------------
export function mountInventarioView(root) {
  const $ = (sel) => root.querySelector(sel);
  let productos = [];

  function renderTablaInventario() {
    const tbody = root.querySelector("#tabla-productos tbody");
    if (!tbody) return;
    const q = ($("#buscar-inventario")?.value || "").trim().toLowerCase();
    const soloBajo = Boolean($("#solo-bajo")?.checked);

    const filtrados = productos.filter((p) => {
      const matchQ =
        !q ||
        p.nombre.toLowerCase().includes(q) ||
        p.codigo.toLowerCase().includes(q) ||
        p.categoria.toLowerCase().includes(q);
      const est = getEstadoStock(p);
      const matchBajo = !soloBajo || est.codigo !== "disponible";
      return matchQ && matchBajo;
    });

    tbody.innerHTML = filtrados.length
      ? filtrados
          .map((p) => {
            const est = getEstadoStock(p);
            return `
              <tr class="${est.claseFila}">
                <td><b>${escapeHtml(p.codigo)}</b></td>
                <td>${escapeHtml(p.nombre)}</td>
                <td>${escapeHtml(p.categoria)}</td>
                <td class="num">${formatCOP(p.precio)} / ${escapeHtml(p.unidad)}</td>
                <td class="num"><b>${p.stock} ${escapeHtml(p.unidad)}</b></td>
                <td class="num">${p.stockMinimo} ${escapeHtml(p.unidad)}</td>
                <td><span class="badge ${est.claseBadge}">${est.etiqueta}</span></td>
              </tr>
            `;
          })
          .join("")
      : `<tr><td colspan="7" style="text-align:center; padding:1.5rem" class="text-muted">Sin productos que coincidan con el filtro.</td></tr>`;

    // Poblar selects de entrada y salida de mercancía
    const opts = productos
      .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.nombre)} (Disp: ${p.stock} ${escapeHtml(p.unidad)})</option>`)
      .join("");
    if ($("#ent-producto")) $("#ent-producto").innerHTML = opts;
    if ($("#sal-producto")) $("#sal-producto").innerHTML = opts;
  }

  $("#buscar-inventario")?.addEventListener("input", renderTablaInventario);
  $("#solo-bajo")?.addEventListener("change", renderTablaInventario);

  $("#form-producto")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await crearProducto(
        {
          nombre: $("#prod-nombre")?.value,
          codigo: $("#prod-codigo")?.value,
          categoria: $("#prod-categoria")?.value,
          precio: $("#prod-precio")?.value,
          stock: $("#prod-stock")?.value,
          stockMinimo: $("#prod-minimo")?.value
        },
        getCurrentUser()
      );
      $("#form-producto").reset();
      $("#modal-producto")?.classList.remove("is-open");
    } catch (err) {
      alert(err.message);
    }
  });

  $("#form-entrada")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await registrarMovimientoBodega(
        {
          productoId: $("#ent-producto")?.value,
          tipo: "Entrada",
          cantidad: $("#ent-cantidad")?.value,
          motivo: $("#ent-motivo")?.value
        },
        getCurrentUser()
      );
      $("#ent-cantidad").value = "";
      $("#ent-motivo").value = "";
    } catch (err) {
      alert(err.message);
    }
  });

  $("#form-salida")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await registrarMovimientoBodega(
        {
          productoId: $("#sal-producto")?.value,
          tipo: "Salida",
          cantidad: $("#sal-cantidad")?.value,
          motivo: $("#sal-motivo")?.value
        },
        getCurrentUser()
      );
      $("#sal-cantidad").value = "";
      $("#sal-motivo").value = "";
    } catch (err) {
      alert(err.message);
    }
  });

  const unsub = watchProductos((lista) => {
    productos = lista;
    renderTablaInventario();
  });

  return () => unsub();
}

// ---------------------------------------------------------------------------
// 2. VISTA DE CONTABILIDAD BÁSICA
// ---------------------------------------------------------------------------
export function mountContabilidadView(root) {
  const $ = (sel) => root.querySelector(sel);
  let movimientos = [];
  let filtroTipo = "Todos";

  const hoyIso = new Date().toISOString().slice(0, 10);
  if ($("#ing-fecha") && !$("#ing-fecha").value) $("#ing-fecha").value = hoyIso;
  if ($("#gas-fecha") && !$("#gas-fecha").value) $("#gas-fecha").value = hoyIso;

  function renderContabilidad() {
    const res = calcularResumenContable(movimientos);
    const stats = root.querySelectorAll(".stat");
    if (stats[0]) {
      stats[0].querySelector(".stat-value").textContent = formatCOP(res.ingresos);
      stats[0].querySelector(".stat-note").textContent = `${res.countIngresos} movimientos`;
    }
    if (stats[1]) {
      stats[1].querySelector(".stat-value").textContent = formatCOP(res.gastos);
      stats[1].querySelector(".stat-note").textContent = `${res.countGastos} movimientos`;
    }
    if (stats[2]) {
      stats[2].querySelector(".stat-value").textContent = formatCOP(res.balance);
    }

    const tbody = root.querySelector("#tabla-movimientos tbody");
    if (!tbody) return;

    const filtrados = movimientos.filter((m) => {
      if (filtroTipo === "Ingresos") return m.tipo === TIPOS_CONTABLE.INGRESO;
      if (filtroTipo === "Gastos") return m.tipo === TIPOS_CONTABLE.GASTO;
      return true;
    });

    tbody.innerHTML = filtrados.length
      ? filtrados
          .map((m) => {
            const esIng = m.tipo === TIPOS_CONTABLE.INGRESO;
            return `
              <tr>
                <td>${formatShortDate(m.fecha)}</td>
                <td><span class="badge ${esIng ? "badge-success" : "badge-danger"}">${escapeHtml(m.tipo)}</span></td>
                <td>${escapeHtml(m.categoria)}</td>
                <td>${escapeHtml(m.concepto)}</td>
                <td class="num ${esIng ? "text-income" : "text-expense"}">${esIng ? "+ " : "− "}${formatCOP(m.monto)}</td>
                <td>${escapeHtml(m.usuario)}</td>
              </tr>
            `;
          })
          .join("")
      : `<tr><td colspan="6" style="text-align:center; padding:1.5rem" class="text-muted">Aún no hay movimientos registrados.</td></tr>`;
  }

  const selectFiltro = root.querySelector(".card-header select");
  selectFiltro?.addEventListener("change", (e) => {
    filtroTipo = e.target.value;
    renderContabilidad();
  });

  $("#panel-ingreso")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await registrarMovimientoContable(
        {
          tipo: TIPOS_CONTABLE.INGRESO,
          concepto: $("#ing-concepto")?.value,
          categoria: $("#ing-categoria")?.value,
          monto: $("#ing-monto")?.value,
          fecha: $("#ing-fecha")?.value,
          nota: $("#ing-nota")?.value
        },
        getCurrentUser()
      );
      $("#panel-ingreso").reset();
      if ($("#ing-fecha")) $("#ing-fecha").value = hoyIso;
    } catch (err) {
      alert(err.message);
    }
  });

  $("#panel-gasto")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await registrarMovimientoContable(
        {
          tipo: TIPOS_CONTABLE.GASTO,
          concepto: $("#gas-concepto")?.value,
          categoria: $("#gas-categoria")?.value,
          monto: $("#gas-monto")?.value,
          fecha: $("#gas-fecha")?.value,
          nota: $("#gas-nota")?.value
        },
        getCurrentUser()
      );
      $("#panel-gasto").reset();
      if ($("#gas-fecha")) $("#gas-fecha").value = hoyIso;
    } catch (err) {
      alert(err.message);
    }
  });

  const unsub = watchMovimientosContables((lista) => {
    movimientos = lista;
    renderContabilidad();
  });

  return () => unsub();
}

// ---------------------------------------------------------------------------
// 3. VISTA DE DASHBOARD OPERATIVO EN TIEMPO REAL
// ---------------------------------------------------------------------------
export function mountDashboardView(root) {
  const $ = (sel) => root.querySelector(sel);
  let productos = [];
  let ventas = [];
  let cajaAbierta = null;
  let movsContables = [];
  let movsInventario = [];

  function renderDashboard() {
    // 1. Pilar Caja y Ventas
    const arqueo = cajaAbierta ? calcularArqueoCaja(cajaAbierta, ventas) : null;
    const ventasTurnoEl = $("#dash-ventas-turno");
    if (ventasTurnoEl && arqueo) {
      ventasTurnoEl.textContent = formatCOP(arqueo.totalVendido);
    } else if (ventasTurnoEl) {
      const totalHoy = ventas
        .filter((v) => v.estado === "Completada")
        .reduce((s, v) => s + roundCOP(v.total), 0);
      ventasTurnoEl.textContent = formatCOP(totalHoy);
    }

    // 2. Pilar Inventario (alertas reales)
    const criticos = productos.filter((p) => getEstadoStock(p).codigo !== "disponible");
    const alertasEl = $("#dash-alertas-stock");
    if (alertasEl) alertasEl.textContent = `${criticos.length} críticos`;

    const listaAlertas = $("#dash-lista-alertas");
    if (listaAlertas) {
      listaAlertas.innerHTML = criticos.length
        ? criticos
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
            .join("")
        : `<li><span class="text-muted">Todo el catálogo tiene stock suficiente.</span></li>`;
    }

    // 3. Pilar Contabilidad
    const resCont = calcularResumenContable(movsContables);
    const balHoyEl = $("#dash-balance-hoy");
    if (balHoyEl) {
      balHoyEl.textContent = `${resCont.balance >= 0 ? "+ " : ""}${formatCOP(resCont.balance)}`;
      balHoyEl.className = `big ${resCont.balance >= 0 ? "text-income" : "text-expense"}`;
    }

    // 4. Tabla de últimas ventas reales
    const tbodyVentas = $("#dash-ultimas-ventas");
    if (tbodyVentas && ventas.length > 0) {
      tbodyVentas.innerHTML = ventas
        .slice(0, 5)
        .map(
          (v) => `
            <tr>
              <td>${formatShortTime(v.fecha)}</td>
              <td>${escapeHtml(v.items.map((i) => `${i.nombre} (${i.cantidad})`).join(", "))}</td>
              <td><span class="badge">${escapeHtml(v.metodoPago)}</span></td>
              <td class="num">${formatCOP(v.total)}</td>
            </tr>
          `
        )
        .join("");
    }

    // 5. Tabla de actividad reciente combinada
    const tbodyAct = $("#dash-actividad-reciente");
    if (tbodyAct && (movsContables.length > 0 || movsInventario.length > 0)) {
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

      tbodyAct.innerHTML = combinados
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
        .join("");
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
// 4. VISTA DE CONSULTAS Y REPORTES BASADOS EN DATOS REALES (Sección 14)
// ---------------------------------------------------------------------------
export function mountReportesView(root) {
  const $ = (sel) => root.querySelector(sel);
  let productos = [];
  let ventas = [];
  let cajas = [];
  let movsContables = [];

  function renderReportes() {
    const desde = $("#rep-desde")?.value || "";
    const hasta = $("#rep-hasta")?.value || "";
    const desdeTs = desde ? new Date(`${desde}T00:00:00`).getTime() : null;
    const hastaTs = hasta ? new Date(`${hasta}T23:59:59.999`).getTime() : null;

    const inRange = (iso) => {
      if (!iso) return true;
      const t = new Date(iso).getTime();
      if (desdeTs && t < desdeTs) return false;
      if (hastaTs && t > hastaTs) return false;
      return true;
    };

    const ventasPeriodo = ventas.filter((v) => v.estado === "Completada" && inRange(v.fecha));
    const totalVentas = ventasPeriodo.reduce((s, v) => s + roundCOP(v.total), 0);

    const movsPeriodo = movsContables.filter((m) => inRange(m.fecha));
    const resCont = calcularResumenContable(movsPeriodo);

    const valorBodega = productos.reduce((s, p) => s + roundCOP(p.precio * p.stock), 0);

    if ($("#rep-total-ventas")) $("#rep-total-ventas").textContent = formatCOP(totalVentas);
    if ($("#rep-total-ingresos")) $("#rep-total-ingresos").textContent = formatCOP(resCont.ingresos);
    if ($("#rep-total-gastos")) $("#rep-total-gastos").textContent = formatCOP(resCont.gastos);
    if ($("#rep-valor-bodega")) $("#rep-valor-bodega").textContent = formatCOP(valorBodega);

    // Historial de cierres de caja reales
    const cierres = cajas.filter((c) => c.estado === "Cerrada" && inRange(c.fechaCierre));
    const tbodyCierres = $("#rep-tabla-cierres");
    if (tbodyCierres && cierres.length > 0) {
      tbodyCierres.innerHTML = cierres
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
        .join("");
    }

    // Agrupación real por categoría contable
    const tbodyCat = $("#rep-tabla-categorias");
    if (tbodyCat && movsPeriodo.length > 0) {
      const grupos = new Map();
      for (const m of movsPeriodo) {
        const k = `${m.tipo}|${m.categoria}`;
        const prev = grupos.get(k) || { tipo: m.tipo, categoria: m.categoria, count: 0, total: 0 };
        prev.count += 1;
        prev.total += roundCOP(m.monto);
        grupos.set(k, prev);
      }
      tbodyCat.innerHTML = [...grupos.values()]
        .map(
          (g) => `
            <tr>
              <td>${escapeHtml(g.categoria)}</td>
              <td><span class="badge ${g.tipo === "Ingreso" ? "badge-success" : "badge-danger"}">${escapeHtml(g.tipo)}</span></td>
              <td class="num">${g.count}</td>
              <td class="num ${g.tipo === "Ingreso" ? "text-income" : "text-expense"}">${g.tipo === "Ingreso" ? "+ " : "− "}${formatCOP(g.total)}</td>
            </tr>
          `
        )
        .join("");
    }
  }

  $("#form-filtro-reportes")?.addEventListener("submit", (e) => {
    e.preventDefault();
    renderReportes();
  });

  const u1 = watchProductos((l) => { productos = l; renderReportes(); });
  const u2 = watchVentas((l) => { ventas = l; renderReportes(); });
  const u3 = watchCajas(({ historial }) => { cajas = historial; renderReportes(); });
  const u4 = watchMovimientosContables((l) => { movsContables = l; renderReportes(); });

  return () => { u1(); u2(); u3(); u4(); };
}
