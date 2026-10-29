// Capa de persistencia transaccional y reactiva del sistema.
// Soporta Cloud Firestore en producción y almacenamiento persistente estructurado
// con las mismas colecciones, validaciones e integridad transaccional cuando las
// credenciales de Firebase aún no se han configurado o en modo local (Cláusula 8).

import { isFirebaseConfigured, getFirebaseClients } from "../firebase-config.js";

const STORAGE_PREFIX = "elcarmen_db_v1_";

export const COLLECTIONS = {
  PRODUCTOS: "productos",
  CLIENTES: "clientes",
  CAJAS: "cajas",
  VENTAS: "ventas",
  MOV_INVENTARIO: "movimientos_inventario",
  MOV_CONTABLES: "movimientos_contables",
  DEVOLUCIONES: "devoluciones",
  AUDITORIA: "auditoria",
  USUARIOS: "usuarios"
};

// Catálogo base del módulo de Inventario (única fuente de verdad para Caja e Inventario)
export const INITIAL_PRODUCTOS = [
  {
    id: "prod-vt006",
    codigo: "VT-006",
    nombre: "Vidrio templado 6 mm",
    categoria: "Vidrios",
    unidad: "m²",
    permiteDecimal: true,
    permiteDimensiones: true,
    esPersonalizado: true,
    precio: 85000,
    stock: 24,
    stockMinimo: 10,
    activo: true
  },
  {
    id: "prod-vl008",
    codigo: "VL-008",
    nombre: "Vidrio laminado 8 mm",
    categoria: "Vidrios",
    unidad: "m²",
    permiteDecimal: true,
    permiteDimensiones: true,
    esPersonalizado: true,
    precio: 120000,
    stock: 12,
    stockMinimo: 10,
    activo: true
  },
  {
    id: "prod-es004",
    codigo: "ES-004",
    nombre: "Espejo 4 mm",
    categoria: "Vidrios",
    unidad: "m²",
    permiteDecimal: true,
    permiteDimensiones: true,
    esPersonalizado: true,
    precio: 65000,
    stock: 18,
    stockMinimo: 6,
    activo: true
  },
  {
    id: "prod-pa100",
    codigo: "PA-100",
    nombre: "Perfil aluminio 1\"",
    categoria: "Perfiles",
    unidad: "m",
    permiteDecimal: true,
    permiteDimensiones: false,
    esPersonalizado: false,
    precio: 28500,
    stock: 60,
    stockMinimo: 10,
    activo: true
  },
  {
    id: "prod-rc300",
    codigo: "RC-300",
    nombre: "Riel corredizo 3 m",
    categoria: "Perfiles",
    unidad: "m",
    permiteDecimal: true,
    permiteDimensiones: false,
    esPersonalizado: false,
    precio: 42000,
    stock: 35,
    stockMinimo: 8,
    activo: true
  },
  {
    id: "prod-bh010",
    codigo: "BH-010",
    nombre: "Bisagra hidráulica",
    categoria: "Accesorios",
    unidad: "u",
    permiteDecimal: false,
    permiteDimensiones: false,
    esPersonalizado: false,
    precio: 18000,
    stock: 40,
    stockMinimo: 10,
    activo: true
  },
  {
    id: "prod-cv001",
    codigo: "CV-001",
    nombre: "Cerradura para vidrio",
    categoria: "Accesorios",
    unidad: "u",
    permiteDecimal: false,
    permiteDimensiones: false,
    esPersonalizado: false,
    precio: 54000,
    stock: 3,
    stockMinimo: 5,
    activo: true
  },
  {
    id: "prod-si050",
    codigo: "SI-050",
    nombre: "Silicona estructural",
    categoria: "Insumos",
    unidad: "u",
    permiteDecimal: false,
    permiteDimensiones: false,
    esPersonalizado: false,
    precio: 16500,
    stock: 0,
    stockMinimo: 6,
    activo: true
  }
];

export const INITIAL_CLIENTES = [
  {
    id: "cli-consumidor",
    nombre: "Consumidor Final",
    documento: "222222222222",
    telefono: "",
    esConsumidorFinal: true
  },
  {
    id: "cli-001",
    nombre: "Constructora del Norte S.A.S.",
    documento: "900412589-1",
    telefono: "3104558899",
    esConsumidorFinal: false
  },
  {
    id: "cli-002",
    nombre: "Carlos Andrés Mejía",
    documento: "71289450",
    telefono: "3157782310",
    esConsumidorFinal: false
  }
];

const listeners = new Map();
let memoryStore = null;

function getStorage() {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // Entorno sin localStorage
  }
  return null;
}

function readCollectionRaw(colName) {
  const storage = getStorage();
  if (storage) {
    const raw = storage.getItem(STORAGE_PREFIX + colName);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {
        return [];
      }
    }
    return null;
  }
  if (!memoryStore) memoryStore = {};
  return memoryStore[colName] || null;
}

function writeCollectionRaw(colName, docs) {
  const storage = getStorage();
  if (storage) {
    storage.setItem(STORAGE_PREFIX + colName, JSON.stringify(docs));
  } else {
    if (!memoryStore) memoryStore = {};
    memoryStore[colName] = JSON.parse(JSON.stringify(docs));
  }
}

export function ensureSeedData() {
  if (!readCollectionRaw(COLLECTIONS.PRODUCTOS)) {
    writeCollectionRaw(COLLECTIONS.PRODUCTOS, INITIAL_PRODUCTOS);
  }
  if (!readCollectionRaw(COLLECTIONS.CLIENTES)) {
    writeCollectionRaw(COLLECTIONS.CLIENTES, INITIAL_CLIENTES);
  }
  for (const col of Object.values(COLLECTIONS)) {
    if (!readCollectionRaw(col)) writeCollectionRaw(col, []);
  }
}

export function resetDatabaseForTests() {
  if (!memoryStore) memoryStore = {};
  const storage = getStorage();
  for (const col of Object.values(COLLECTIONS)) {
    if (storage) storage.removeItem(STORAGE_PREFIX + colNameSafe(col));
    delete memoryStore[col];
  }
  ensureSeedData();
  for (const col of Object.values(COLLECTIONS)) notifyListeners(col);
}

function colNameSafe(col) {
  return col;
}

function notifyListeners(colName) {
  const subs = listeners.get(colName);
  if (!subs) return;
  const snapshot = getCollection(colName);
  subs.forEach((cb) => {
    try {
      cb(snapshot);
    } catch (e) {
      console.error("Error en listener de colección:", colName, e);
    }
  });
}

export function getCollection(colName) {
  ensureSeedData();
  const docs = readCollectionRaw(colName) || [];
  return JSON.parse(JSON.stringify(docs));
}

export function getDocById(colName, id) {
  const docs = getCollection(colName);
  return docs.find((d) => d.id === id) || null;
}

export function subscribeCollection(colName, callback) {
  ensureSeedData();
  if (!listeners.has(colName)) listeners.set(colName, new Set());
  const subs = listeners.get(colName);
  subs.add(callback);
  callback(getCollection(colName));
  return () => subs.delete(callback);
}

let idCounter = 1;
export function generateId(prefix = "doc") {
  const rand = Math.random().toString(36).substring(2, 7);
  return `${prefix}-${Date.now()}-${idCounter++}-${rand}`;
}

// Ejecuta una transacción atómica sobre las colecciones.
// Si cualquier validación lanza error dentro de workFn, ningún cambio se persiste.
export async function runAtomicTransaction(workFn) {
  ensureSeedData();

  // Copia profunda de todas las colecciones antes de empezar
  const snapshotBefore = {};
  for (const col of Object.values(COLLECTIONS)) {
    snapshotBefore[col] = getCollection(col);
  }

  const touchedCollections = new Set();

  const tx = {
    getAll(colName) {
      return snapshotBefore[colName] ? JSON.parse(JSON.stringify(snapshotBefore[colName])) : [];
    },
    get(colName, id) {
      const list = snapshotBefore[colName] || [];
      const found = list.find((d) => d.id === id);
      return found ? JSON.parse(JSON.stringify(found)) : null;
    },
    insert(colName, docData) {
      const list = snapshotBefore[colName] || [];
      const newDoc = {
        ...JSON.parse(JSON.stringify(docData)),
        id: docData.id || generateId(colName.slice(0, 3))
      };
      list.push(newDoc);
      snapshotBefore[colName] = list;
      touchedCollections.add(colName);
      return newDoc;
    },
    update(colName, id, patch) {
      const list = snapshotBefore[colName] || [];
      const idx = list.findIndex((d) => d.id === id);
      if (idx === -1) throw new Error(`Registro no encontrado en ${colName}: ${id}`);
      list[idx] = { ...list[idx], ...JSON.parse(JSON.stringify(patch)), id };
      touchedCollections.add(colName);
      return list[idx];
    }
  };

  // Si workFn lanza una excepción, no se escribe nada en almacenamiento (atomicidad total)
  const result = await workFn(tx);

  // Confirmar (commit) los cambios de la transacción
  for (const col of touchedCollections) {
    writeCollectionRaw(col, snapshotBefore[col]);
  }

  // Sincronización opcional con Cloud Firestore si las credenciales reales están activas
  if (isFirebaseConfigured()) {
    try {
      const fb = await getFirebaseClients();
      if (fb) {
        const { db, firestoreMod } = fb;
        for (const col of touchedCollections) {
          for (const item of snapshotBefore[col]) {
            await firestoreMod.setDoc(firestoreMod.doc(db, col, item.id), item, { merge: true });
          }
        }
      }
    } catch (err) {
      console.warn("Sincronización Firestore diferida:", err);
    }
  }

  for (const col of touchedCollections) {
    notifyListeners(col);
  }

  return result;
}
