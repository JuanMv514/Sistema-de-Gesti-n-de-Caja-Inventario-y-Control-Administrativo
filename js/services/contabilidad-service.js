// Servicio de Contabilidad Básica: ingresos, gastos y trazabilidad con Caja y Ventas.
// Importante: el monto inicial de apertura de caja NO se registra como ingreso por ventas.

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
  let countIngresos = 0;
  let countGastos = 0;

  for (const m of movimientos) {
    if (m.anulado) continue;
    const monto = roundCOP(m.monto);
    if (m.tipo === TIPOS_CONTABLE.INGRESO) {
      ingresos += monto;
      countIngresos++;
    } else if (m.tipo === TIPOS_CONTABLE.GASTO) {
      gastos += monto;
      countGastos++;
    }
  }

  return {
    ingresos: roundCOP(ingresos),
    gastos: roundCOP(gastos),
    balance: roundCOP(ingresos - gastos),
    countIngresos,
    countGastos
  };
}

export async function registrarMovimientoContable(
  { tipo, categoria, concepto, monto, fecha, nota = "", metodoPago = "Efectivo", afectaCajaFisica = false, cajaId = null },
  user = getCurrentUser()
) {
  assertPermission("contabilidad.gestionar", user);
  if (![TIPOS_CONTABLE.INGRESO, TIPOS_CONTABLE.GASTO].includes(tipo)) {
    throw new Error("Tipo contable inválido.");
  }
  const valor = roundCOP(monto);
  if (!(valor > 0)) {
    throw new Error("El monto debe ser mayor que cero.");
  }
  const conc = String(concepto || "").trim();
  if (!conc) {
    throw new Error("El concepto del movimiento es obligatorio.");
  }

  return runAtomicTransaction(async (tx) => {
    const ahora = fecha ? new Date(fecha).toISOString() : new Date().toISOString();
    return tx.insert(COLLECTIONS.MOV_CONTABLES, {
      tipo,
      categoria: categoria || (tipo === TIPOS_CONTABLE.INGRESO ? "Otros ingresos" : "Otros gastos"),
      concepto: conc,
      monto: valor,
      metodoPago,
      afectaCajaFisica: Boolean(afectaCajaFisica && metodoPago === "Efectivo"),
      cajaId,
      origen: "Manual",
      referenciaId: null,
      nota: String(nota || "").trim(),
      usuario: user.name || user.email,
      fecha: ahora
    });
  });
}
