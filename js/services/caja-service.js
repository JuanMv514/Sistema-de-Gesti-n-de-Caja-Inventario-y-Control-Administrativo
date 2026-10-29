import { db } from "../firebase-config.js";
import {
  collection, addDoc, updateDoc, doc, query, where, orderBy, limit,
  onSnapshot, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const METODOS_PAGO = ["efectivo", "transferencia", "tarjeta"];

const cajasCol = collection(db, "cajas");
const ventasCol = collection(db, "ventas");

// Escucha en tiempo real la caja abierta (solo puede haber una). Devuelve unsubscribe.
export function watchCajaAbierta(callback) {
  const q = query(cajasCol, where("estado", "==", "abierta"), limit(1));
  return onSnapshot(q, (snap) => {
    const d = snap.docs[0];
    callback(d ? { id: d.id, ...d.data() } : null);
  });
}

export async function abrirCaja(montoInicial, user) {
  if (!(montoInicial >= 0)) throw new Error("Monto inicial inválido");
  return addDoc(cajasCol, {
    estado: "abierta",
    montoInicial,
    abiertaPor: user.email,
    abiertaEn: serverTimestamp()
  });
}

export async function registrarVenta({ cajaId, items, metodoPago, recibido, user }) {
  if (!items.length) throw new Error("La venta no tiene productos");
  if (!METODOS_PAGO.includes(metodoPago)) throw new Error("Método de pago inválido");
  const total = calcularTotal(items);
  if (metodoPago === "efectivo" && recibido < total) throw new Error("El valor recibido es menor al total");
  const recibidoFinal = metodoPago === "efectivo" ? recibido : total;
  return addDoc(ventasCol, {
    cajaId,
    items,
    total,
    metodoPago,
    recibido: recibidoFinal,
    cambio: recibidoFinal - total,
    vendedor: user.email,
    fecha: serverTimestamp()
  });
}

export const calcularTotal = (items) =>
  items.reduce((s, i) => s + i.cantidad * i.precio, 0);

// Ventas de una caja en tiempo real (más recientes primero)
export function watchVentasCaja(cajaId, callback) {
  const q = query(ventasCol, where("cajaId", "==", cajaId), orderBy("fecha", "desc"));
  return onSnapshot(q, (snap) =>
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

// Totales por método de pago a partir de una lista de ventas
export function totalesPorMetodo(ventas) {
  const t = Object.fromEntries(METODOS_PAGO.map((m) => [m, 0]));
  ventas.forEach((v) => { t[v.metodoPago] += v.total; });
  return t;
}

export async function cerrarCaja(caja, montoContado, user) {
  if (!(montoContado >= 0)) throw new Error("Monto contado inválido");
  const snap = await getDocs(query(ventasCol, where("cajaId", "==", caja.id)));
  const totales = totalesPorMetodo(snap.docs.map((d) => d.data()));
  const montoEsperado = caja.montoInicial + totales.efectivo;
  await updateDoc(doc(db, "cajas", caja.id), {
    estado: "cerrada",
    cerradaPor: user.email,
    cerradaEn: serverTimestamp(),
    totales,
    montoEsperado,
    montoContado,
    diferencia: montoContado - montoEsperado
  });
  return { totales, montoEsperado, diferencia: montoContado - montoEsperado };
}
