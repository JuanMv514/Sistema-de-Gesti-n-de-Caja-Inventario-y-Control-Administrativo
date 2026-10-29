// Servicio de Contabilidad (Sección 8 y Sección 13):
// - Gestiona ingresos, gastos, distinción entre efectivo físico y bancos/electrónicos,
//   impacto automático en la caja abierta cuando un movimiento afecta efectivo en caja,
//   y cálculo del resultado financiero del período sin inventar cuentas ni duplicar ventas.

import {
  COLLECTIONS,
  getCollection,
  subscribeCollection,
  runAtomicTransaction
} from "./store.js";
import { getCurrentUser, assertPermission } from "../auth.js";
import { roundCOP } from "./inventario-service.js";

export const TIPOS_CONTABLE = {
  INGRESO: "Ingreso",
  GASTO: "Gasto"
};

export function listarMovimientosContables() {
  const list = getCollection(COLLECTIONS.MOV_CONTABLES);
  return [...list].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
}

export function watchMovimientosContables(callback) {
  return subscribeCollection(COLLECTIONS.MOV_CONTABLES, (items) => {
    const sorted = [...items].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    callback(sorted);
  });
}

export function calcularResumenContable(movimientos = listarMovimientosContables()) {
  let ingresos = 0;
  let gastos = 0;
  let ingresosEfectivo = 0;
  let ingresosBancos = 0;
  let gastosEfectivo = 0;
  let gastosBancos = 0;
  let countIngresos = 0;
  let countGastos = 0;
  let ultimoIngreso = null;
  let ultimoGasto = null;

  const ordenados = [...movimientos].sort((a, b) =>
    (b.fecha || "").localeCompare(a.fecha || "")
  );

  for (const m of ordenados) {
    if (m.anulado) continue;
    const monto = roundCOP(m.monto);
    const esEfectivo = (m.metodoPago || "Efectivo") === "Efectivo";

    if (m.tipo === TIPOS_CONTABLE.INGRESO) {
      ingresos += monto;
      if (esEfectivo) ingresosEfectivo += monto;
      else ingresosBancos += monto;
      countIngresos++;
      if (!ultimoIngreso) ultimoIngreso = m;
    } else if (m.tipo === TIPOS_CONTABLE.GASTO) {
      gastos += monto;
      if (esEfectivo) gastosEfectivo += monto;
      else gastosBancos += monto;
      countGastos++;
      if (!ultimoGasto) ultimoGasto = m;
    }
  }

  return {
    ingresos: roundCOP(ingresos),
    gastos: roundCOP(gastos),
    balance: roundCOP(ingresos - gastos),
    ingresosEfectivo: roundCOP(ingresosEfectivo),
    ingresosBancos: roundCOP(ingresosBancos),
    gastosEfectivo: roundCOP(gastosEfectivo),
    gastosBancos: roundCOP(gastosBancos),
    countIngresos,
    countGastos,
    totalMovimientos: countIngresos + countGastos,
    ultimoIngreso,
    ultimoGasto
  };
}

export async function registrarMovimientoContable(
  {
    tipo,
    categoria,
    concepto,
    monto,
    fecha,
    nota = "",
    soporteReferencia = "",
    metodoPago = "Efectivo",
    afectaCajaFisica = false,
    cajaId = null
  },
  user = getCurrentUser()
) {
  assertPermission("contabilidad.gestionar", user);
  if (![TIPOS_CONTABLE.INGRESO, TIPOS_CONTABLE.GASTO].includes(tipo)) {
    throw new Error("El tipo de movimiento contable debe ser Ingreso o Gasto.");
  }
  const valor = roundCOP(monto);
  if (!(valor > 0)) {
    throw new Error("El valor del movimiento debe ser mayor que cero.");
  }
  const conc = String(concepto || "").trim();
  if (!conc) {
    throw new Error("El concepto del movimiento es obligatorio.");
  }

  return runAtomicTransaction(async (tx) => {
    const ahora = new Date().toISOString();
    let fechaRegistro = ahora;
    if (fecha) {
      const fStr = String(fecha).trim();
      fechaRegistro = fStr.length === 10 ? `${fStr}T${ahora.slice(11)}` : new Date(fStr).toISOString();
    }

    const esEfectivo = metodoPago === "Efectivo";
    let cajaAsociadaId = cajaId;

    // Si el movimiento es en efectivo y afecta la caja abierta (Sección 8.3 y 13),
    // registrar la entrada o salida en la caja abierta para mantener el efectivo esperado exacto.
    if (afectaCajaFisica && esEfectivo) {
      const cajas = tx.getAll(COLLECTIONS.CAJAS);
      const abierta = cajaAsociadaId
        ? cajas.find((c) => c.id === cajaAsociadaId && c.estado === "Abierta")
        : cajas.find((c) => c.estado === "Abierta");

      if (!abierta) {
        throw new Error(
          "Marcaste que este movimiento afecta el efectivo de la caja, pero actualmente no hay una caja abierta."
        );
      }

      cajaAsociadaId = abierta.id;
      const movCaja = {
        id: `mc-${Date.now()}`,
        tipo: tipo === TIPOS_CONTABLE.INGRESO ? "Entrada" : "Salida",
        monto: valor,
        concepto: `${categoria || tipo}: ${conc}`,
        usuario: user.name || user.email,
        fecha: fechaRegistro
      };
      const lista = Array.isArray(abierta.movimientosEfectivoExtra)
        ? [...abierta.movimientosEfectivoExtra, movCaja]
        : [movCaja];
      tx.update(COLLECTIONS.CAJAS, abierta.id, { movimientosEfectivoExtra: lista });
    }

    const nuevo = tx.insert(COLLECTIONS.MOV_CONTABLES, {
      tipo,
      categoria:
        categoria ||
        (tipo === TIPOS_CONTABLE.INGRESO ? "Otros ingresos" : "Otros gastos"),
      concepto: conc,
      monto: valor,
      metodoPago,
      afectaCajaFisica: Boolean(afectaCajaFisica && esEfectivo && cajaAsociadaId),
      cajaId: cajaAsociadaId,
      origen: "Manual",
      referenciaId: null,
      soporteReferencia: String(soporteReferencia || "").trim(),
      nota: String(nota || "").trim(),
      usuario: user.name || user.email,
      fecha: fechaRegistro
    });

    tx.insert(COLLECTIONS.AUDITORIA, {
      accion: `CONTABLE_${tipo.toUpperCase()}`,
      movimientoId: nuevo.id,
      categoria: nuevo.categoria,
      concepto: nuevo.concepto,
      monto: nuevo.monto,
      metodoPago: nuevo.metodoPago,
      afectaCajaFisica: nuevo.afectaCajaFisica,
      usuario: user.name || user.email,
      fecha: ahora
    });

    return nuevo;
  });
}
