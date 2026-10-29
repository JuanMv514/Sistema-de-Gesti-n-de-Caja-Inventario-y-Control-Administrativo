// Servicio de Caja y Ventas — Vidrios y Aluminios El Carmen.
// Implementa el proceso comercial completo:
// - Apertura de caja (sin contabilizar la base como ingreso por ventas)
// - Cálculo de líneas, subtotales, descuentos autorizados, impuestos y total
// - Pagos simples y divididos (Efectivo, Transferencia, Tarjeta débito, Tarjeta crédito)
// - Registro transaccional atómico (venta + descuento de stock + kardex + contabilidad + caja)
// - Protección de idempotencia contra doble clic / reintentos
// - Anulaciones y devoluciones con autorización de Administrador y auditoría
// - Arqueo y cierre de caja (Efectivo esperado = base + entradas efectivo - salidas efectivo)

import {
  COLLECTIONS,
  getCollection,
  getDocById,
  subscribeCollection,
  runAtomicTransaction
} from "./store.js";
import { getCurrentUser, assertPermission, hasPermission } from "../auth.js";
import {
  roundQty,
  roundCOP,
  validarCantidadPorUnidad
} from "./inventario-service.js";
import { TIPOS_CONTABLE } from "./contabilidad-service.js";

export const METODOS_PAGO = [
  "Efectivo",
  "Transferencia",
  "Tarjeta débito",
  "Tarjeta crédito"
];

export const ESTADOS_CAJA = {
  ABIERTA: "Abierta",
  CERRADA: "Cerrada"
};

export const ESTADOS_VENTA = {
  COMPLETADA: "Completada",
  ANULADA: "Anulada",
  DEVUELTA: "Devuelta"
};

// Conjunto de claves de idempotencia en vuelo o procesadas recientemente
const processedIdempotencyKeys = new Set();

// Obtiene la caja actualmente abierta (solo se permite 1 caja abierta activa en el punto de venta)
export function obtenerCajaAbierta() {
  const cajas = getCollection(COLLECTIONS.CAJAS);
  return cajas.find((c) => c.estado === ESTADOS_CAJA.ABIERTA) || null;
}

export function watchCajas(callback) {
  return subscribeCollection(COLLECTIONS.CAJAS, (cajas) => {
    const abierta = cajas.find((c) => c.estado === ESTADOS_CAJA.ABIERTA) || null;
    const historial = [...cajas].sort((a, b) => (b.fechaApertura || "").localeCompare(a.fechaApertura || ""));
    callback({ cajaAbierta: abierta, historial });
  });
}

export function listarVentas() {
  const ventas = getCollection(COLLECTIONS.VENTAS);
  return [...ventas].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
}

export function obtenerVentaPorId(ventaId) {
  return getDocById(COLLECTIONS.VENTAS, ventaId);
}

export function watchVentas(callback) {
  return subscribeCollection(COLLECTIONS.VENTAS, (ventas) => {
    const sorted = [...ventas].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    callback(sorted);
  });
}

// ---------------------------------------------------------------------------
// 1. APERTURA DE CAJA (Sección 3)
// ---------------------------------------------------------------------------
export async function abrirCaja({ montoInicial, observaciones = "" }, user = getCurrentUser()) {
  assertPermission("caja.abrir", user);

  const montoNum = Number(montoInicial);
  if (!Number.isFinite(montoNum) || montoNum < 0 || String(montoInicial).trim() === "") {
    throw new Error("El monto inicial debe ser un valor numérico igual o mayor que cero.");
  }

  return runAtomicTransaction(async (tx) => {
    const cajas = tx.getAll(COLLECTIONS.CAJAS);
    const yaAbierta = cajas.find((c) => c.estado === ESTADOS_CAJA.ABIERTA);
    if (yaAbierta) {
      throw new Error(`Ya existe una caja abierta por ${yaAbierta.usuarioApertura}. No se permite duplicar la apertura.`);
    }

    const ahora = new Date().toISOString();
    const montoBase = roundCOP(montoNum);

    // Importante: el monto inicial representa el efectivo disponible al comienzo del turno.
    // NO se contabiliza como venta ni como ingreso generado por ventas en movimientos_contables.
    const nuevaCaja = tx.insert(COLLECTIONS.CAJAS, {
      estado: ESTADOS_CAJA.ABIERTA,
      usuarioApertura: user.name || user.email,
      usuarioUid: user.uid || user.email,
      fechaApertura: ahora,
      montoInicial: montoBase,
      observacionesApertura: String(observaciones || "").trim(),
      movimientosEfectivoExtra: [], // Entradas o salidas manuales de efectivo físico en caja
      fechaCierre: null,
      usuarioCierre: null,
      resumenCierre: null
    });

    tx.insert(COLLECTIONS.AUDITORIA, {
      accion: "CAJA_APERTURA",
      cajaId: nuevaCaja.id,
      montoInicial: montoBase,
      usuario: user.name || user.email,
      fecha: ahora
    });

    return nuevaCaja;
  });
}

// Registrar entrada o salida manual de efectivo físico en la caja abierta (p. ej. cambio sencillo, gasto menor de caja)
export async function registrarMovimientoEfectivoCaja(
  { cajaId, tipo, monto, concepto },
  user = getCurrentUser()
) {
  assertPermission("caja.movimiento_efectivo", user);
  if (!["Entrada", "Salida"].includes(tipo)) {
    throw new Error("El tipo de movimiento de caja debe ser Entrada o Salida.");
  }
  const valor = roundCOP(monto);
  if (!(valor > 0)) {
    throw new Error("El monto del movimiento de efectivo debe ser mayor que cero.");
  }
  const conc = String(concepto || "").trim();
  if (!conc) {
    throw new Error("El concepto del movimiento de caja es obligatorio.");
  }

  return runAtomicTransaction(async (tx) => {
    const caja = tx.get(COLLECTIONS.CAJAS, cajaId);
    if (!caja || caja.estado !== ESTADOS_CAJA.ABIERTA) {
      throw new Error("La caja ya está cerrada.");
    }
    const ahora = new Date().toISOString();
    const mov = {
      id: `mc-${Date.now()}`,
      tipo,
      monto: valor,
      concepto: conc,
      usuario: user.name || user.email,
      fecha: ahora
    };
    const lista = Array.isArray(caja.movimientosEfectivoExtra) ? [...caja.movimientosEfectivoExtra, mov] : [mov];
    tx.update(COLLECTIONS.CAJAS, caja.id, { movimientosEfectivoExtra: lista });

    // Reflejar también en contabilidad interna manteniendo trazabilidad con caja
    tx.insert(COLLECTIONS.MOV_CONTABLES, {
      tipo: tipo === "Entrada" ? TIPOS_CONTABLE.INGRESO : TIPOS_CONTABLE.GASTO,
      categoria: tipo === "Entrada" ? "Entrada de efectivo en caja" : "Salida de efectivo en caja",
      concepto: conc,
      monto: valor,
      metodoPago: "Efectivo",
      afectaCajaFisica: true,
      cajaId: caja.id,
      origen: "Movimiento de caja",
      referenciaId: mov.id,
      usuario: user.name || user.email,
      fecha: ahora
    });

    return mov;
  });
}

// ---------------------------------------------------------------------------
// 2. CÁLCULOS DE LÍNEAS, SUBTOTAL, DESCUENTOS, IMPUESTOS Y TOTAL (Secciones 5 y 6)
// ---------------------------------------------------------------------------
export function calcularLineaVenta(item) {
  const precioUnitario = roundCOP(item.precioUnitario ?? item.precio);
  const cantidad = roundQty(item.cantidad);
  if (!(cantidad > 0)) throw new Error("La cantidad de cada línea debe ser mayor que cero.");
  if (!(precioUnitario >= 0)) throw new Error("El precio unitario no puede ser negativo.");
  const subtotal = roundCOP(precioUnitario * cantidad);
  return {
    ...item,
    precioUnitario,
    cantidad,
    subtotal
  };
}

// Fórmula general: Total = subtotal − descuentos + impuestos.
// Si no se especifican descuentos o impuestos, subtotal === total.
export function calcularTotalesVenta(items = [], { descuento = 0, impuesto = 0 } = {}) {
  const lineas = items.map(calcularLineaVenta);
  const subtotal = lineas.reduce((acc, item) => acc + item.subtotal, 0);
  const desc = roundCOP(descuento);
  const imp = roundCOP(impuesto);

  if (desc < 0) throw new Error("El descuento no puede ser negativo.");
  if (desc > subtotal) throw new Error("El descuento no puede superar el subtotal de la venta.");
  if (imp < 0) throw new Error("El impuesto no puede ser negativo.");

  const total = roundCOP(subtotal - desc + imp);
  return {
    lineas,
    subtotal: roundCOP(subtotal),
    descuento: desc,
    impuesto: imp,
    total
  };
}

// Calcula el cambio o faltante para un pago en efectivo o pagos divididos
export function evaluarPagos({ total, pagos = [] }) {
  const totalVenta = roundCOP(total);
  if (!Array.isArray(pagos) || pagos.length === 0) {
    throw new Error("Debe seleccionar al menos un método de pago.");
  }

  let sumaEfectivoRecibido = 0;
  let sumaOtrosMetodos = 0;

  const pagosNormalizados = pagos.map((p) => {
    const metodo = p.metodo;
    if (!METODOS_PAGO.includes(metodo)) {
      throw new Error(`Método de pago no válido: ${metodo}`);
    }
    const importe = roundCOP(p.importe ?? p.recibido ?? 0);
    if (!(importe > 0)) {
      throw new Error(`El importe del pago en ${metodo} debe ser mayor que cero.`);
    }
    if (metodo !== "Efectivo") {
      sumaOtrosMetodos += importe;
    } else {
      sumaEfectivoRecibido += importe;
    }
    return {
      metodo,
      importe,
      referencia: String(p.referencia || "").trim(),
      estadoConfirmacion: p.estadoConfirmacion || "Confirmado"
    };
  });

  if (sumaOtrosMetodos > totalVenta) {
    throw new Error("La suma de pagos electrónicos no puede superar el total de la venta.");
  }

  const totalRecibido = sumaEfectivoRecibido + sumaOtrosMetodos;
  const faltante = Math.max(0, totalVenta - totalRecibido);
  const cambio = totalRecibido > totalVenta ? roundCOP(totalRecibido - totalVenta) : 0;

  // Dinero neto en efectivo que entra y se queda en la caja física
  const efectivoNetoCaja = Math.max(0, roundCOP(sumaEfectivoRecibido - cambio));

  return {
    pagos: pagosNormalizados,
    totalVenta,
    totalRecibido: roundCOP(totalRecibido),
    sumaEfectivoRecibido: roundCOP(sumaEfectivoRecibido),
    sumaOtrosMetodos: roundCOP(sumaOtrosMetodos),
    efectivoNetoCaja,
    cambio,
    faltante,
    completo: faltante === 0
  };
}

// ---------------------------------------------------------------------------
// 3. CONFIRMACIÓN Y REGISTRO ATÓMICO DE LA VENTA (Secciones 8, 9, 10 y 14)
// ---------------------------------------------------------------------------
export async function registrarVenta(
  {
    cajaId,
    items,
    pagos,
    metodoPago,
    valorRecibido,
    referenciaPago = "",
    descuento = 0,
    impuesto = 0,
    clienteId = "cli-consumidor",
    ordenReferencia = "",
    idempotencyKey = null
  },
  user = getCurrentUser()
) {
  assertPermission("ventas.registrar", user);

  // Protección de idempotencia contra doble clic o reintentos de red
  if (idempotencyKey) {
    if (processedIdempotencyKeys.has(idempotencyKey)) {
      throw new Error("Esta venta ya fue procesada (solicitud duplicada bloqueada).");
    }
    processedIdempotencyKeys.add(idempotencyKey);
  }

  try {
    return await runAtomicTransaction(async (tx) => {
      // 1. Validar que la caja exista y siga abierta
      const caja = cajaId
        ? tx.get(COLLECTIONS.CAJAS, cajaId)
        : tx.getAll(COLLECTIONS.CAJAS).find((c) => c.estado === ESTADOS_CAJA.ABIERTA);

      if (!caja) {
        throw new Error("Debes abrir una caja antes de registrar ventas.");
      }
      if (caja.estado !== ESTADOS_CAJA.ABIERTA) {
        throw new Error("La caja ya está cerrada.");
      }

      // Verificar idempotencia también en los registros persistidos
      const ventasExistentes = tx.getAll(COLLECTIONS.VENTAS);
      if (idempotencyKey && ventasExistentes.some((v) => v.idempotencyKey === idempotencyKey)) {
        throw new Error("Esta venta ya fue registrada.");
      }

      if (!Array.isArray(items) || items.length === 0) {
        throw new Error("Agrega al menos un producto a la venta actual.");
      }

      // Validar permiso de descuento si se aplica
      if (Number(descuento) > 0) {
        assertPermission("ventas.descuento", user);
      }

      // 2. Validar cada producto contra el inventario vigente y recalcular importes desde precios oficiales
      const lineasValidadas = [];
      const acumuladoPorProducto = new Map();

      for (const item of items) {
        const prod = tx.get(COLLECTIONS.PRODUCTOS, item.productoId);
        if (!prod || prod.activo === false) {
          throw new Error(`El producto "${item.nombre || item.productoId}" no existe o no está disponible.`);
        }

        const cantidad = validarCantidadPorUnidad(prod, item.cantidad);
        const previa = acumuladoPorProducto.get(prod.id) || 0;
        const totalSolicitado = roundQty(previa + cantidad);

        if (totalSolicitado > roundQty(prod.stock)) {
          throw new Error(
            `No hay existencias suficientes para esta cantidad (${prod.nombre}: disponible ${prod.stock} ${prod.unidad}).`
          );
        }
        acumuladoPorProducto.set(prod.id, totalSolicitado);

        // Si el precio enviado por la vista difiere del precio vigente en base de datos, alertar
        if (item.precioUnitario !== undefined && roundCOP(item.precioUnitario) !== roundCOP(prod.precio)) {
          throw new Error("El producto fue actualizado. Verifica el precio y las existencias.");
        }

        lineasValidadas.push({
          productoId: prod.id,
          codigo: prod.codigo,
          nombre: prod.nombre,
          categoria: prod.categoria,
          unidad: prod.unidad,
          esPersonalizado: Boolean(prod.esPersonalizado || item.dimensiones),
          dimensiones: item.dimensiones || null,
          precioUnitario: roundCOP(prod.precio),
          cantidad,
          subtotal: roundCOP(prod.precio * cantidad)
        });
      }

      // 3. Recalcular subtotal, descuentos, impuestos y total en capa de negocio
      const calculo = calcularTotalesVenta(lineasValidadas, { descuento, impuesto });
      if (!(calculo.total > 0)) {
        throw new Error("El total de la venta debe ser mayor que cero.");
      }

      // 4. Normalizar y validar pagos (pago único o pagos divididos)
      const listaPagos =
        Array.isArray(pagos) && pagos.length > 0
          ? pagos
          : [
              {
                metodo: metodoPago || "Efectivo",
                importe:
                  (metodoPago || "Efectivo") === "Efectivo"
                    ? roundCOP(valorRecibido ?? 0)
                    : calculo.total,
                referencia: referenciaPago
              }
            ];

      const evalPago = evaluarPagos({ total: calculo.total, pagos: listaPagos });
      if (!evalPago.completo) {
        throw new Error(
          `El valor recibido no cubre el total de la venta. Faltan $ ${evalPago.faltante.toLocaleString("es-CO")}.`
        );
      }

      // 5. Resolver cliente asociado (por defecto Consumidor Final)
      const cliente =
        tx.get(COLLECTIONS.CLIENTES, clienteId) || {
          id: "cli-consumidor",
          nombre: "Consumidor Final",
          documento: "222222222222"
        };

      const ahora = new Date().toISOString();
      const consecutivo = ventasExistentes.length + 1;
      const numeroVenta = `V-${String(consecutivo).padStart(4, "0")}`;

      // 6. Descontar inventario una sola vez por producto y registrar kardex
      for (const [prodId, cantTotal] of acumuladoPorProducto.entries()) {
        const prod = tx.get(COLLECTIONS.PRODUCTOS, prodId);
        const stockAnterior = roundQty(prod.stock);
        const stockNuevo = roundQty(stockAnterior - cantTotal);
        tx.update(COLLECTIONS.PRODUCTOS, prodId, {
          stock: stockNuevo,
          actualizadoEn: ahora
        });

        tx.insert(COLLECTIONS.MOV_INVENTARIO, {
          productoId: prod.id,
          codigo: prod.codigo,
          productoNombre: prod.nombre,
          unidad: prod.unidad,
          tipo: "Salida",
          origen: "Venta POS",
          referenciaId: numeroVenta,
          cantidad: cantTotal,
          stockAnterior,
          stockNuevo,
          motivo: `Venta ${numeroVenta}`,
          usuario: user.name || user.email,
          fecha: ahora
        });
      }

      // 7. Insertar documento de venta
      const metodoResumen =
        evalPago.pagos.length === 1
          ? evalPago.pagos[0].metodo
          : `Mixto (${evalPago.pagos.map((p) => p.metodo).join(" + ")})`;

      const ventaDoc = tx.insert(COLLECTIONS.VENTAS, {
        numero: numeroVenta,
        cajaId: caja.id,
        estado: ESTADOS_VENTA.COMPLETADA,
        cliente: {
          id: cliente.id,
          nombre: cliente.nombre,
          documento: cliente.documento
        },
        ordenReferencia: String(ordenReferencia || "").trim(),
        items: calculo.lineas,
        subtotal: calculo.subtotal,
        descuento: calculo.descuento,
        impuesto: calculo.impuesto,
        total: calculo.total,
        metodoPago: metodoResumen,
        pagos: evalPago.pagos,
        valorRecibido: evalPago.totalRecibido,
        efectivoNetoCaja: evalPago.efectivoNetoCaja,
        cambio: evalPago.cambio,
        saldoPendiente: 0,
        vendedor: user.name || user.email,
        vendedorUid: user.uid || user.email,
        fecha: ahora,
        idempotencyKey
      });

      // 8. Registrar el movimiento en Contabilidad Básica (distinguiendo ingreso por ventas)
      tx.insert(COLLECTIONS.MOV_CONTABLES, {
        tipo: TIPOS_CONTABLE.INGRESO,
        categoria: "Ventas mostrador",
        concepto: `Venta ${numeroVenta} · ${cliente.nombre}`,
        monto: calculo.total,
        metodoPago: metodoResumen,
        afectaCajaFisica: evalPago.efectivoNetoCaja > 0,
        cajaId: caja.id,
        origen: "Venta POS",
        referenciaId: ventaDoc.id,
        numeroVenta,
        usuario: user.name || user.email,
        fecha: ahora
      });

      if (calculo.descuento > 0) {
        tx.insert(COLLECTIONS.AUDITORIA, {
          accion: "VENTA_DESCUENTO",
          ventaId: ventaDoc.id,
          numeroVenta,
          descuento: calculo.descuento,
          usuario: user.name || user.email,
          fecha: ahora
        });
      }

      return ventaDoc;
    });
  } catch (err) {
    if (idempotencyKey) processedIdempotencyKeys.delete(idempotencyKey);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 4. ANULACIÓN Y DEVOLUCIONES CON AUTORIZACIÓN Y AUDITORÍA (Sección 11)
// ---------------------------------------------------------------------------
export async function anularVenta(
  { ventaId, motivo, reintegrarInventario = true },
  user = getCurrentUser()
) {
  assertPermission("ventas.anular", user);
  const motivoLimpio = String(motivo || "").trim();
  if (!motivoLimpio) {
    throw new Error("Debe indicar el motivo de la anulación.");
  }

  return runAtomicTransaction(async (tx) => {
    const venta = tx.get(COLLECTIONS.VENTAS, ventaId);
    if (!venta) throw new Error("La venta indicada no existe.");
    if (venta.estado !== ESTADOS_VENTA.COMPLETADA) {
      throw new Error(`La venta ${venta.numero} ya se encuentra en estado ${venta.estado}.`);
    }

    const ahora = new Date().toISOString();
    const cajaOriginal = tx.get(COLLECTIONS.CAJAS, venta.cajaId);
    const cajaAbiertaActual = tx.getAll(COLLECTIONS.CAJAS).find((c) => c.estado === ESTADOS_CAJA.ABIERTA);

    // Si reintegrarInventario está activo, devolver existencias salvo productos cortados a medida no reutilizables
    const ajustesInventario = [];
    if (reintegrarInventario) {
      for (const linea of venta.items) {
        if (linea.dimensiones && linea.noReintegrable) continue;
        const prod = tx.get(COLLECTIONS.PRODUCTOS, linea.productoId);
        if (!prod) continue;
        const stockAnterior = roundQty(prod.stock);
        const stockNuevo = roundQty(stockAnterior + linea.cantidad);
        tx.update(COLLECTIONS.PRODUCTOS, prod.id, { stock: stockNuevo, actualizadoEn: ahora });

        tx.insert(COLLECTIONS.MOV_INVENTARIO, {
          productoId: prod.id,
          codigo: prod.codigo,
          productoNombre: prod.nombre,
          unidad: prod.unidad,
          tipo: "Entrada",
          origen: "Anulación de venta",
          referenciaId: venta.numero,
          cantidad: linea.cantidad,
          stockAnterior,
          stockNuevo,
          motivo: `Anulación ${venta.numero}: ${motivoLimpio}`,
          usuario: user.name || user.email,
          fecha: ahora
        });
        ajustesInventario.push({ productoId: prod.id, nombre: prod.nombre, cantidad: linea.cantidad });
      }
    }

    // Marcar la venta como Anulada (sin borrar el registro histórico ni modificar retroactivamente cajas cerradas)
    const cajaAfectadaId =
      cajaOriginal && cajaOriginal.estado === ESTADOS_CAJA.ABIERTA
        ? cajaOriginal.id
        : cajaAbiertaActual
        ? cajaAbiertaActual.id
        : null;

    const ventaActualizada = tx.update(COLLECTIONS.VENTAS, venta.id, {
      estado: ESTADOS_VENTA.ANULADA,
      anulacion: {
        motivo: motivoLimpio,
        usuario: user.name || user.email,
        fecha: ahora,
        cajaAjusteId: cajaAfectadaId,
        enCajaCerrada: Boolean(cajaOriginal && cajaOriginal.estado === ESTADOS_CAJA.CERRADA),
        ajustesInventario
      }
    });

    // Registrar el ajuste contable inverso
    tx.insert(COLLECTIONS.MOV_CONTABLES, {
      tipo: TIPOS_CONTABLE.GASTO,
      categoria: "Anulación / Devolución de venta",
      concepto: `Anulación ${venta.numero} · ${motivoLimpio}`,
      monto: venta.total,
      metodoPago: venta.metodoPago,
      afectaCajaFisica: venta.efectivoNetoCaja > 0,
      cajaId: cajaAfectadaId,
      origen: "Anulación POS",
      referenciaId: venta.id,
      usuario: user.name || user.email,
      fecha: ahora
    });

    tx.insert(COLLECTIONS.AUDITORIA, {
      accion: "VENTA_ANULADA",
      ventaId: venta.id,
      numeroVenta: venta.numero,
      motivo: motivoLimpio,
      monto: venta.total,
      usuario: user.name || user.email,
      fecha: ahora
    });

    return ventaActualizada;
  });
}

// Flujo independiente de devolución parcial o total referenciando la venta original
export async function registrarDevolucionVenta(
  { ventaId, itemsDevueltos, motivo, reintegrarStock = true, reembolsoEfectivo = true },
  user = getCurrentUser()
) {
  assertPermission("ventas.devolucion", user);
  const motivoLimpio = String(motivo || "").trim();
  if (!motivoLimpio) throw new Error("Debe indicar el motivo de la devolución.");
  if (!Array.isArray(itemsDevueltos) || itemsDevueltos.length === 0) {
    throw new Error("Seleccione al menos un producto a devolver.");
  }

  return runAtomicTransaction(async (tx) => {
    const venta = tx.get(COLLECTIONS.VENTAS, ventaId);
    if (!venta) throw new Error("La venta original no existe.");
    if (venta.estado === ESTADOS_VENTA.ANULADA) {
      throw new Error("No se puede registrar una devolución sobre una venta anulada.");
    }

    const ahora = new Date().toISOString();
    let totalDevuelto = 0;
    const detalleDevolucion = [];

    for (const dev of itemsDevueltos) {
      const lineaOrig = venta.items.find((i) => i.productoId === dev.productoId);
      if (!lineaOrig) throw new Error("El producto no pertenece a la venta original.");
      const cantDev = roundQty(dev.cantidad);
      if (!(cantDev > 0) || cantDev > lineaOrig.cantidad) {
        throw new Error(`Cantidad de devolución inválida para ${lineaOrig.nombre}.`);
      }
      const importeLinea = roundCOP(cantDev * lineaOrig.precioUnitario);
      totalDevuelto += importeLinea;

      // Solo devolver al inventario si no es un corte personalizado dañado y reintegrarStock === true
      const reintegraEsteItem = Boolean(reintegrarStock && dev.aptoInventario !== false);
      if (reintegraEsteItem) {
        const prod = tx.get(COLLECTIONS.PRODUCTOS, lineaOrig.productoId);
        if (prod) {
          const stockAnt = roundQty(prod.stock);
          const stockNvo = roundQty(stockAnt + cantDev);
          tx.update(COLLECTIONS.PRODUCTOS, prod.id, { stock: stockNvo, actualizadoEn: ahora });
          tx.insert(COLLECTIONS.MOV_INVENTARIO, {
            productoId: prod.id,
            codigo: prod.codigo,
            productoNombre: prod.nombre,
            unidad: prod.unidad,
            tipo: "Entrada",
            origen: "Devolución de cliente",
            referenciaId: venta.numero,
            cantidad: cantDev,
            stockAnterior: stockAnt,
            stockNuevo: stockNvo,
            motivo: `Devolución ${venta.numero}: ${motivoLimpio}`,
            usuario: user.name || user.email,
            fecha: ahora
          });
        }
      }

      detalleDevolucion.push({
        productoId: lineaOrig.productoId,
        nombre: lineaOrig.nombre,
        cantidad: cantDev,
        unidad: lineaOrig.unidad,
        importe: importeLinea,
        reintegradoInventario: reintegraEsteItem
      });
    }

    const cajaAbierta = tx.getAll(COLLECTIONS.CAJAS).find((c) => c.estado === ESTADOS_CAJA.ABIERTA);
    const devDoc = tx.insert(COLLECTIONS.DEVOLUCIONES, {
      ventaId: venta.id,
      numeroVenta: venta.numero,
      cajaId: cajaAbierta ? cajaAbierta.id : null,
      items: detalleDevolucion,
      totalDevuelto: roundCOP(totalDevuelto),
      reembolsoEfectivo: Boolean(reembolsoEfectivo),
      motivo: motivoLimpio,
      usuario: user.name || user.email,
      fecha: ahora
    });

    tx.insert(COLLECTIONS.MOV_CONTABLES, {
      tipo: TIPOS_CONTABLE.GASTO,
      categoria: "Devolución de venta",
      concepto: `Devolución sobre ${venta.numero} · ${motivoLimpio}`,
      monto: roundCOP(totalDevuelto),
      metodoPago: reembolsoEfectivo ? "Efectivo" : "Nota / Transferencia",
      afectaCajaFisica: Boolean(reembolsoEfectivo),
      cajaId: cajaAbierta ? cajaAbierta.id : null,
      origen: "Devolución POS",
      referenciaId: devDoc.id,
      usuario: user.name || user.email,
      fecha: ahora
    });

    tx.insert(COLLECTIONS.AUDITORIA, {
      accion: "VENTA_DEVOLUCION",
      ventaId: venta.id,
      devolucionId: devDoc.id,
      totalDevuelto: roundCOP(totalDevuelto),
      motivo: motivoLimpio,
      usuario: user.name || user.email,
      fecha: ahora
    });

    return devDoc;
  });
}

// ---------------------------------------------------------------------------
// 5. ARQUEO Y CIERRE DE CAJA (Sección 12)
// ---------------------------------------------------------------------------
// Efectivo esperado = monto inicial + entradas de efectivo − salidas de efectivo.
// Los pagos por transferencia o tarjeta NO se suman como efectivo físico.
export function calcularArqueoCaja(caja, ventasAll = getCollection(COLLECTIONS.VENTAS), devolucionesAll = getCollection(COLLECTIONS.DEVOLUCIONES)) {
  if (!caja) return null;

  const ventasTurno = ventasAll.filter((v) => v.cajaId === caja.id);
  const ventasActivas = ventasTurno.filter((v) => v.estado === ESTADOS_VENTA.COMPLETADA);
  const ventasAnuladas = ventasTurno.filter((v) => v.estado === ESTADOS_VENTA.ANULADA);

  const porMetodo = {
    Efectivo: 0,
    Transferencia: 0,
    "Tarjeta débito": 0,
    "Tarjeta crédito": 0
  };

  let totalVendido = 0;
  let entradasEfectivoVentas = 0;

  for (const v of ventasActivas) {
    totalVendido += roundCOP(v.total);
    if (Array.isArray(v.pagos)) {
      for (const p of v.pagos) {
        if (p.metodo === "Efectivo") {
          const neto = roundCOP(v.efectivoNetoCaja ?? p.importe);
          porMetodo.Efectivo += neto;
        } else {
          porMetodo[p.metodo] = (porMetodo[p.metodo] || 0) + roundCOP(p.importe);
        }
      }
    }
    entradasEfectivoVentas += roundCOP(v.efectivoNetoCaja || 0);
  }

  // Entradas y salidas manuales de efectivo físico en esa caja
  const movsExtra = Array.isArray(caja.movimientosEfectivoExtra) ? caja.movimientosEfectivoExtra : [];
  let entradasEfectivoManual = 0;
  let salidasEfectivoManual = 0;
  for (const m of movsExtra) {
    if (m.tipo === "Entrada") entradasEfectivoManual += roundCOP(m.monto);
    if (m.tipo === "Salida") salidasEfectivoManual += roundCOP(m.monto);
  }

  // Devoluciones en efectivo aplicadas durante el turno
  const devsTurno = devolucionesAll.filter((d) => d.cajaId === caja.id && d.reembolsoEfectivo);
  const salidasPorDevoluciones = devsTurno.reduce((acc, d) => acc + roundCOP(d.totalDevuelto), 0);

  // Anulaciones de ventas en efectivo de otra caja aplicadas sobre esta caja abierta
  const anulacionesExternasEnEstaCaja = ventasAll.filter(
    (v) =>
      v.estado === ESTADOS_VENTA.ANULADA &&
      v.cajaId !== caja.id &&
      v.anulacion?.cajaAjusteId === caja.id
  );
  const salidasPorAnulaciones = anulacionesExternasEnEstaCaja.reduce(
    (acc, v) => acc + roundCOP(v.efectivoNetoCaja || 0),
    0
  );

  const montoInicial = roundCOP(caja.montoInicial);
  const totalEntradasEfectivo = roundCOP(entradasEfectivoVentas + entradasEfectivoManual);
  const totalSalidasEfectivo = roundCOP(salidasEfectivoManual + salidasPorDevoluciones + salidasPorAnulaciones);
  const efectivoEsperado = roundCOP(montoInicial + totalEntradasEfectivo - totalSalidasEfectivo);

  return {
    cajaId: caja.id,
    usuarioApertura: caja.usuarioApertura,
    fechaApertura: caja.fechaApertura,
    montoInicial,
    numeroVentas: ventasActivas.length,
    numeroAnuladas: ventasAnuladas.length,
    numeroDevoluciones: devsTurno.length,
    totalVendido: roundCOP(totalVendido),
    pagosPorMetodo: porMetodo,
    entradasEfectivoVentas: roundCOP(entradasEfectivoVentas),
    entradasEfectivoManual: roundCOP(entradasEfectivoManual),
    salidasEfectivoManual: roundCOP(salidasEfectivoManual),
    salidasPorDevoluciones: roundCOP(salidasPorDevoluciones + salidasPorAnulaciones),
    totalEntradasEfectivo,
    totalSalidasEfectivo,
    efectivoEsperado
  };
}

export async function cerrarCaja(
  { cajaId, efectivoContado, observaciones = "" },
  user = getCurrentUser()
) {
  assertPermission("caja.cerrar", user);

  const contadoNum = Number(efectivoContado);
  if (!Number.isFinite(contadoNum) || contadoNum < 0 || String(efectivoContado).trim() === "") {
    throw new Error("Debe ingresar el efectivo contado (valor numérico igual o mayor que cero).");
  }

  return runAtomicTransaction(async (tx) => {
    const caja = tx.get(COLLECTIONS.CAJAS, cajaId);
    if (!caja) throw new Error("Caja no encontrada.");
    if (caja.estado !== ESTADOS_CAJA.ABIERTA) {
      throw new Error("La caja ya está cerrada.");
    }

    const ventasAll = tx.getAll(COLLECTIONS.VENTAS);
    const devsAll = tx.getAll(COLLECTIONS.DEVOLUCIONES);
    const arqueo = calcularArqueoCaja(caja, ventasAll, devsAll);

    const contado = roundCOP(contadoNum);
    const diferencia = roundCOP(contado - arqueo.efectivoEsperado);
    const obsLimpia = String(observaciones || "").trim();

    if (diferencia !== 0 && !obsLimpia) {
      throw new Error(
        `Existe una diferencia de caja de $ ${diferencia.toLocaleString("es-CO")}. Debe registrar una observación explicando la diferencia.`
      );
    }

    const ahora = new Date().toISOString();
    const resumenCierre = {
      ...arqueo,
      efectivoContado: contado,
      diferencia,
      observaciones: obsLimpia,
      usuarioCierre: user.name || user.email,
      fechaCierre: ahora
    };

    const cajaCerrada = tx.update(COLLECTIONS.CAJAS, caja.id, {
      estado: ESTADOS_CAJA.CERRADA,
      fechaCierre: ahora,
      usuarioCierre: user.name || user.email,
      efectivoEsperado: arqueo.efectivoEsperado,
      efectivoContado: contado,
      diferencia,
      observacionesCierre: obsLimpia,
      resumenCierre
    });

    tx.insert(COLLECTIONS.AUDITORIA, {
      accion: "CAJA_CIERRE",
      cajaId: caja.id,
      efectivoEsperado: arqueo.efectivoEsperado,
      efectivoContado: contado,
      diferencia,
      usuario: user.name || user.email,
      fecha: ahora
    });

    return cajaCerrada;
  });
}

// ---------------------------------------------------------------------------
// 6. FILTRO E HISTORIAL DE VENTAS (Sección 13)
// ---------------------------------------------------------------------------
export function filtrarHistorialVentas(
  ventas = listarVentas(),
  { busqueda = "", desde = "", hasta = "", metodoPago = "Todos", estado = "Todos" } = {}
) {
  const q = String(busqueda || "").trim().toLowerCase();
  const desdeTs = desde ? new Date(`${desde}T00:00:00`).getTime() : null;
  const hastaTs = hasta ? new Date(`${hasta}T23:59:59.999`).getTime() : null;

  return ventas.filter((v) => {
    const fechaTs = v.fecha ? new Date(v.fecha).getTime() : 0;
    if (desdeTs && fechaTs < desdeTs) return false;
    if (hastaTs && fechaTs > hastaTs) return false;
    if (metodoPago && metodoPago !== "Todos" && !String(v.metodoPago || "").includes(metodoPago)) {
      return false;
    }
    if (estado && estado !== "Todos" && v.estado !== estado) {
      return false;
    }
    if (q) {
      const matchNum = String(v.numero || "").toLowerCase().includes(q);
      const matchCli = String(v.cliente?.nombre || "").toLowerCase().includes(q) || String(v.cliente?.documento || "").toLowerCase().includes(q);
      const matchUsr = String(v.vendedor || "").toLowerCase().includes(q);
      if (!matchNum && !matchCli && !matchUsr) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// 7. GENERACIÓN DE COMPROBANTE INTERNO DE VENTA (Sección 10)
// ---------------------------------------------------------------------------
export function generarDatosComprobante(venta) {
  if (!venta) throw new Error("Venta no encontrada para generar comprobante.");
  return {
    establecimiento: "Vidrios y Aluminios El Carmen",
    tipoDocumento: "Comprobante interno de venta",
    leyendaLegal: "Documento equivalente de control interno. No constituye factura electrónica de venta validada ante la DIAN.",
    numero: venta.numero,
    fecha: venta.fecha,
    estado: venta.estado,
    vendedor: venta.vendedor,
    cliente: venta.cliente || { nombre: "Consumidor Final", documento: "222222222222" },
    ordenReferencia: venta.ordenReferencia || "",
    items: venta.items,
    subtotal: venta.subtotal,
    descuento: venta.descuento || 0,
    impuesto: venta.impuesto || 0,
    total: venta.total,
    pagos: venta.pagos || [{ metodo: venta.metodoPago, importe: venta.valorRecibido }],
    valorRecibido: venta.valorRecibido,
    cambio: venta.cambio || 0,
    saldoPendiente: venta.saldoPendiente || 0
  };
}
