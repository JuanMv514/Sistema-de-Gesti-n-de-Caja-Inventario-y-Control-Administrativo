import { db } from "../firebase-config.js";
import {
  collection, addDoc, updateDoc, doc, query, orderBy, limit,
  onSnapshot, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const productosCol = collection(db, "productos");
const movimientosCol = collection(db, "movimientos_inventario");

// Catálogo en tiempo real, ordenado por nombre
export function watchProductos(callback) {
  return onSnapshot(query(productosCol, orderBy("nombre")), (snap) =>
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

// Últimos movimientos (entradas y salidas)
export function watchMovimientos(callback, max = 30) {
  return onSnapshot(
    query(movimientosCol, orderBy("fecha", "desc"), limit(max)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

function validarProducto(p) {
  if (!p.nombre?.trim()) throw new Error("El nombre es obligatorio");
  if (!(p.precio >= 0)) throw new Error("Precio inválido");
  if (!(p.stockMinimo >= 0)) throw new Error("Stock mínimo inválido");
}

export async function crearProducto(p, user) {
  validarProducto(p);
  if (!(p.stock >= 0)) throw new Error("Stock inicial inválido");
  const ref = await addDoc(productosCol, {
    nombre: p.nombre.trim(), codigo: (p.codigo || "").trim(),
    precio: p.precio, stock: p.stock, stockMinimo: p.stockMinimo,
    creadoPor: user.email, creadoEn: serverTimestamp()
  });
  if (p.stock > 0) {
    await addDoc(movimientosCol, {
      productoId: ref.id, nombre: p.nombre.trim(), tipo: "entrada",
      cantidad: p.stock, motivo: "Stock inicial", usuario: user.email, fecha: serverTimestamp()
    });
  }
  return ref;
}

// El stock no se edita aquí: solo cambia con movimientos.
export async function actualizarProducto(id, p) {
  validarProducto(p);
  return updateDoc(doc(db, "productos", id), {
    nombre: p.nombre.trim(), codigo: (p.codigo || "").trim(),
    precio: p.precio, stockMinimo: p.stockMinimo
  });
}

// Entrada/salida atómica: actualiza stock y registra el movimiento; nunca deja stock negativo.
export async function registrarMovimiento({ productoId, tipo, cantidad, motivo }, user) {
  if (!["entrada", "salida"].includes(tipo)) throw new Error("Tipo inválido");
  if (!(cantidad > 0)) throw new Error("La cantidad debe ser mayor a 0");
  const ref = doc(db, "productos", productoId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Producto no encontrado");
    const p = snap.data();
    const nuevo = p.stock + (tipo === "entrada" ? cantidad : -cantidad);
    if (nuevo < 0) throw new Error(`Stock insuficiente (disponible: ${p.stock})`);
    tx.update(ref, { stock: nuevo });
    tx.set(doc(movimientosCol), {
      productoId, nombre: p.nombre, tipo, cantidad,
      motivo: (motivo || "").trim(), usuario: user.email, fecha: serverTimestamp()
    });
  });
}

export const stockBajo = (p) => p.stock <= p.stockMinimo;
