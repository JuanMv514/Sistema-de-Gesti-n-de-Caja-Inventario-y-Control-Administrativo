// Servicio de Inventario: única fuente de verdad para productos, precios,
// unidades de medida, existencias y movimientos de bodega.

import {
  COLLECTIONS,
  getCollection,
  getDocById,
  subscribeCollection,
  runAtomicTransaction
} from "./store.js";
import { getCurrentUser, assertPermission } from "../auth.js";

export const UNIDADES_MEDIDA = {
  UNIDAD: "u",
  METRO_LINEAL: "m",
  METRO_CUADRADO: "m²"
};

export const CATEGORIAS_PRODUCTO = [
  "Todos",
  "Vidrios",
  "Perfiles",
  "Accesorios",
  "Insumos"
];

// Redondea cantidades decimales (m, m²) a 4 decimales para evitar errores de punto flotante
export function roundQty(num) {
  return Math.round((Number(num) + Number.EPSILON) * 10000) / 10000;
}

// Redondea valores monetarios en COP a pesos enteros
export function roundCOP(num) {
  return Math.round(Number(num) || 0);
}

// Formatea número como pesos colombianos: "$ 206.000"
export function formatCOP(value) {
  const n = roundCOP(value);
  const sign = n < 0 ? "− " : "";
  return `${sign}$ ${Math.abs(n).toLocaleString("es-CO")}`;
}

// Calcula área en m² a partir de dimensiones en centímetros y cantidad de piezas:
// Área en m² = (ancho_cm / 100) * (alto_cm / 100) * piezas
export function calcularAreaM2({ anchoCm, altoCm, piezas = 1 }) {
  const ancho = Number(anchoCm);
  const alto = Number(altoCm);
  const cantPiezas = Number(piezas);
  if (!(ancho > 0) || !(alto > 0) || !Number.isInteger(cantPiezas) || cantPiezas <= 0) {
    throw new Error("Dimensiones inválidas: ingrese ancho (cm), alto (cm) y número entero de piezas mayores a cero.");
  }
  const area = (ancho / 100) * (alto / 100) * cantPiezas;
  return roundQty(area);
}

export function getEstadoStock(producto) {
  const stock = Number(producto.stock) || 0;
  const min = Number(producto.stockMinimo) || 0;
  if (stock <= 0) return { codigo: "agotado", etiqueta: "Agotado", claseBadge: "stock-out", claseFila: "row-out" };
  if (stock <= min) return { codigo: "bajo", etiqueta: "Stock bajo", claseBadge: "stock-low", claseFila: "row-low" };
  return { codigo: "disponible", etiqueta: "Disponible", claseBadge: "stock-ok", claseFila: "" };
}

export function listarProductos() {
  return getCollection(COLLECTIONS.PRODUCTOS).filter((p) => p.activo !== false);
}

export function obtenerProducto(id) {
  return getDocById(COLLECTIONS.PRODUCTOS, id);
}

export function watchProductos(callback) {
  return subscribeCollection(COLLECTIONS.PRODUCTOS, (items) => {
    callback(items.filter((p) => p.activo !== false));
  });
}

export function watchMovimientosInventario(callback) {
  return subscribeCollection(COLLECTIONS.MOV_INVENTARIO, (items) => {
    const sorted = [...items].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    callback(sorted);
  });
}

// Filtra productos por categoría y término de búsqueda (nombre o código)
export function filtrarCatalogo(productos, { categoria = "Todos", busqueda = "" } = {}) {
  const q = String(busqueda || "").trim().toLowerCase();
  return productos.filter((p) => {
    const matchCat = !categoria || categoria === "Todos" || p.categoria === categoria;
    const matchText =
      !q ||
      String(p.nombre || "").toLowerCase().includes(q) ||
      String(p.codigo || "").toLowerCase().includes(q);
    return matchCat && matchText;
  });
}

// Valida que la cantidad sea coherente con la unidad de medida del producto
export function validarCantidadPorUnidad(producto, cantidad) {
  const cant = Number(cantidad);
  if (!Number.isFinite(cant) || cant <= 0) {
    throw new Error("La cantidad debe ser un número mayor que cero.");
  }
  const permiteDecimal = Boolean(producto.permiteDecimal || producto.unidad === "m" || producto.unidad === "m²");
  if (!permiteDecimal && !Number.isInteger(cant)) {
    throw new Error(`El producto "${producto.nombre}" se vende por unidades enteras (${producto.unidad}).`);
  }
  return roundQty(cant);
}

export async function crearProducto(datos, user = getCurrentUser()) {
  assertPermission("inventario.gestionar", user);
  const nombre = String(datos.nombre || "").trim();
  const codigo = String(datos.codigo || "").trim().toUpperCase();
  const categoria = datos.categoria || "Vidrios";
  const unidad = datos.unidad || (categoria === "Vidrios" ? "m²" : categoria === "Perfiles" ? "m" : "u");
  const precio = roundCOP(datos.precio);
  const stock = roundQty(datos.stock ?? 0);
  const stockMinimo = roundQty(datos.stockMinimo ?? 0);

  if (!nombre) throw new Error("El nombre del producto es obligatorio.");
  if (!(precio >= 0)) throw new Error("El precio debe ser un valor numérico no negativo.");
  if (!(stock >= 0) || !(stockMinimo >= 0)) throw new Error("Las existencias no pueden ser negativas.");

  return runAtomicTransaction(async (tx) => {
    const existentes = tx.getAll(COLLECTIONS.PRODUCTOS);
    if (codigo && existentes.some((p) => p.codigo.toUpperCase() === codigo)) {
      throw new Error(`Ya existe un producto con el código ${codigo}.`);
    }
    const ahora = new Date().toISOString();
    const nuevo = tx.insert(COLLECTIONS.PRODUCTOS, {
      codigo: codigo || `PR-${Date.now().toString().slice(-4)}`,
      nombre,
      categoria,
      unidad,
      permiteDecimal: unidad === "m" || unidad === "m²",
      permiteDimensiones: unidad === "m²",
      esPersonalizado: unidad === "m²",
      precio,
      stock,
      stockMinimo,
      activo: true,
      creadoPor: user.name || user.email,
      creadoEn: ahora
    });

    if (stock > 0) {
      tx.insert(COLLECTIONS.MOV_INVENTARIO, {
        productoId: nuevo.id,
        codigo: nuevo.codigo,
        productoNombre: nuevo.nombre,
        unidad: nuevo.unidad,
        tipo: "Entrada",
        origen: "Stock inicial",
        cantidad: stock,
        stockAnterior: 0,
        stockNuevo: stock,
        motivo: "Inventario inicial al crear producto",
        usuario: user.name || user.email,
        fecha: ahora
      });
    }
    return nuevo;
  });
}

export async function registrarMovimientoBodega({ productoId, tipo, cantidad, motivo }, user = getCurrentUser()) {
  assertPermission("inventario.gestionar", user);
  if (!["Entrada", "Salida"].includes(tipo)) {
    throw new Error("Tipo de movimiento inválido.");
  }

  return runAtomicTransaction(async (tx) => {
    const prod = tx.get(COLLECTIONS.PRODUCTOS, productoId);
    if (!prod) throw new Error("Producto no encontrado en inventario.");

    const cantValida = validarCantidadPorUnidad(prod, cantidad);
    const stockActual = roundQty(prod.stock);
    const stockNuevo = roundQty(tipo === "Entrada" ? stockActual + cantValida : stockActual - cantValida);

    if (stockNuevo < 0) {
      throw new Error(`No hay existencias suficientes para esta cantidad. Disponible: ${stockActual} ${prod.unidad}.`);
    }

    const ahora = new Date().toISOString();
    tx.update(COLLECTIONS.PRODUCTOS, productoId, { stock: stockNuevo, actualizadoEn: ahora });

    return tx.insert(COLLECTIONS.MOV_INVENTARIO, {
      productoId: prod.id,
      codigo: prod.codigo,
      productoNombre: prod.nombre,
      unidad: prod.unidad,
      tipo,
      origen: "Ajuste manual bodega",
      cantidad: cantValida,
      stockAnterior: stockActual,
      stockNuevo,
      motivo: String(motivo || (tipo === "Entrada" ? "Compra a proveedor" : "Salida de bodega")).trim(),
      usuario: user.name || user.email,
      fecha: ahora
    });
  });
}
