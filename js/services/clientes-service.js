// Servicio de Clientes: gestión de clientes y venta por defecto a Consumidor Final.

import {
  COLLECTIONS,
  getCollection,
  subscribeCollection,
  runAtomicTransaction
} from "./store.js";
import { getCurrentUser, assertPermission } from "../auth.js";

export function listarClientes() {
  return getCollection(COLLECTIONS.CLIENTES);
}

export function watchClientes(callback) {
  return subscribeCollection(COLLECTIONS.CLIENTES, callback);
}

export function buscarClientes(termino = "") {
  const q = String(termino || "").trim().toLowerCase();
  const todos = listarClientes();
  if (!q) return todos;
  return todos.filter(
    (c) =>
      String(c.nombre || "").toLowerCase().includes(q) ||
      String(c.documento || "").toLowerCase().includes(q)
  );
}

export async function crearCliente({ nombre, documento, telefono = "" }, user = getCurrentUser()) {
  assertPermission("clientes.crear", user);
  const nom = String(nombre || "").trim();
  const docId = String(documento || "").trim();
  if (!nom || !docId) {
    throw new Error("El nombre y el documento del cliente son obligatorios.");
  }

  return runAtomicTransaction(async (tx) => {
    const actuales = tx.getAll(COLLECTIONS.CLIENTES);
    if (actuales.some((c) => c.documento === docId)) {
      throw new Error(`Ya existe un cliente registrado con el documento ${docId}.`);
    }
    return tx.insert(COLLECTIONS.CLIENTES, {
      nombre: nom,
      documento: docId,
      telefono: String(telefono || "").trim(),
      esConsumidorFinal: false,
      creadoPor: user.name || user.email,
      creadoEn: new Date().toISOString()
    });
  });
}
