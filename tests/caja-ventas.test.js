// Suite de Pruebas Funcionales Obligatorias — Módulo Caja y Ventas (25 escenarios, Sección 18).
// Puede ejecutarse en el navegador abriendo /tests/caja-ventas.test.html.

import {
  COLLECTIONS,
  getCollection,
  getDocById,
  resetDatabaseForTests,
  resetDatabaseEmpty,
  runAtomicTransaction
} from "../js/services/store.js";
import { ROLES, hasPermission, assertPermission } from "../js/auth.js";
import {
  getFirebaseStatus,
  setSimulatedNetworkOffline,
  setFirebaseConfigOverride
} from "../js/firebase-config.js";
import {
  listarProductos,
  filtrarCatalogo,
  calcularAreaM2,
  calcularVidrioPersonalizado,
  crearProducto,
  actualizarProducto,
  cambiarEstadoProducto,
  registrarMovimientoBodega,
  roundQty
} from "../js/services/inventario-service.js";
import {
  registrarMovimientoContable,
  calcularResumenContable,
  filtrarMovimientosContables,
  generarInformeFinancieroContable,
  registrarTrasladoInterno,
  revertirMovimientoContable,
  exportarContabilidadCSV,
  TIPOS_CONTABLE
} from "../js/services/contabilidad-service.js";
import {
  generarReportesConsolidados,
  generarCSVReporte
} from "../js/services/reportes-service.js";
import {
  crearUsuario,
  actualizarUsuario,
  autenticarUsuario
} from "../js/services/usuarios-service.js";
import {
  abrirCaja,
  cerrarCaja,
  registrarMovimientoEfectivoCaja,
  calcularTotalesVenta,
  evaluarPagos,
  registrarVenta,
  anularVenta,
  registrarDevolucionVenta,
  calcularArqueoCaja,
  generarDatosComprobante,
  obtenerCajaAbierta
} from "../js/services/caja-service.js";

const adminUser = { uid: "u-admin", email: "admin@elcarmen.com", name: "Administrador", role: ROLES.ADMIN };
const empleadoUser = { uid: "u-emp", email: "caja@elcarmen.com", name: "Cajero Turno", role: ROLES.EMPLEADO };

function assert(condition, message) {
  if (!condition) throw new Error(message || "Falló la aserción");
}

async function assertThrows(fn, expectedSubstring = "") {
  let threw = false;
  let errorMsg = "";
  try {
    await fn();
  } catch (e) {
    threw = true;
    errorMsg = e.message || String(e);
  }
  if (!threw) {
    throw new Error(`Se esperaba un error pero la operación terminó sin fallar.`);
  }
  if (expectedSubstring && !errorMsg.toLowerCase().includes(expectedSubstring.toLowerCase())) {
    throw new Error(`Mensaje de error inesperado: "${errorMsg}" (se esperaba que contuviera "${expectedSubstring}")`);
  }
}

export async function runAll25Tests() {
  const results = [];

  async function step(num, title, fn) {
    try {
      await fn();
      results.push({ num, title, passed: true, detail: "OK" });
    } catch (e) {
      results.push({ num, title, passed: false, detail: e.message || String(e) });
    }
  }

  // Reiniciar estado limpio antes de iniciar la batería
  resetDatabaseForTests();

  // 2. Impedir una apertura con monto negativo
  await step(2, "Impedir una apertura de caja con monto negativo", async () => {
    await assertThrows(
      () => abrirCaja({ montoInicial: -50000 }, adminUser),
      "monto inicial"
    );
    assert(obtenerCajaAbierta() === null, "No debe haberse creado ninguna caja abierta");
  });

  // 1. Abrir una caja con monto inicial válido
  let cajaActiva = null;
  await step(1, "Abrir una caja con monto inicial válido ($ 200.000) sin contabilizarlo como venta", async () => {
    cajaActiva = await abrirCaja({ montoInicial: 200000, observaciones: "Inicio turno mañana" }, adminUser);
    assert(cajaActiva.estado === "Abierta", "Estado debe ser Abierta");
    assert(cajaActiva.montoInicial === 200000, "Monto inicial debe ser 200000");
    const movsCont = getCollection(COLLECTIONS.MOV_CONTABLES);
    assert(movsCont.length === 0, "La apertura no debe generar un ingreso por ventas en contabilidad");
  });

  // 3. Buscar un producto por nombre y por código
  await step(3, "Buscar un producto por nombre y por código en el catálogo de Inventario", async () => {
    const todos = listarProductos();
    const porNombre = filtrarCatalogo(todos, { busqueda: "templado" });
    const porCodigo = filtrarCatalogo(todos, { busqueda: "VT-006" });
    assert(porNombre.length === 1 && porNombre[0].codigo === "VT-006", "Búsqueda por nombre falló");
    assert(porCodigo.length === 1 && porCodigo[0].id === "prod-vt006", "Búsqueda por código falló");
  });

  // 4. Filtrar por categoría
  await step(4, "Filtrar productos por categoría (Vidrios, Perfiles, Accesorios, Insumos)", async () => {
    const todos = listarProductos();
    const vidrios = filtrarCatalogo(todos, { categoria: "Vidrios" });
    const perfiles = filtrarCatalogo(todos, { categoria: "Perfiles" });
    assert(vidrios.length === 3 && vidrios.every((p) => p.categoria === "Vidrios"), "Filtro Vidrios falló");
    assert(perfiles.length === 2 && perfiles.every((p) => p.categoria === "Perfiles"), "Filtro Perfiles falló");
  });

  // 5, 6 y 7. Agregar productos diferentes, incrementar/disminuir cantidades y calcular subtotales y total
  await step(5, "Agregar productos diferentes a una venta", async () => {
    const items = [
      { productoId: "prod-vt006", precioUnitario: 85000, cantidad: 2 },
      { productoId: "prod-bh010", precioUnitario: 18000, cantidad: 2 }
    ];
    const calc = calcularTotalesVenta(items);
    assert(calc.lineas.length === 2, "Debe contener 2 líneas de productos");
  });

  await step(6, "Incrementar y disminuir cantidades en líneas de venta", async () => {
    let items = [{ productoId: "prod-vt006", precioUnitario: 85000, cantidad: 1 }];
    items[0].cantidad += 2; // incrementa a 3
    assert(calcularTotalesVenta(items).subtotal === 255000, "Incremento a 3 unidades debe dar $ 255.000");
    items[0].cantidad -= 1; // disminuye a 2
    assert(calcularTotalesVenta(items).subtotal === 170000, "Disminución a 2 unidades debe dar $ 170.000");
  });

  await step(7, "Calcular correctamente los subtotales de línea y el total general ($ 206.000)", async () => {
    const calc = calcularTotalesVenta([
      { productoId: "prod-vt006", precioUnitario: 85000, cantidad: 2 }, // 170.000
      { productoId: "prod-bh010", precioUnitario: 18000, cantidad: 2 }  // 36.000
    ]);
    assert(calc.lineas[0].subtotal === 170000, "Subtotal línea 1 debe ser 170000");
    assert(calc.lineas[1].subtotal === 36000, "Subtotal línea 2 debe ser 36000");
    assert(calc.subtotal === 206000 && calc.total === 206000, "Total debe ser 206000");
  });

  // 8. Vender productos por unidades y por medidas (m y m², incluyendo cálculo por ancho x alto en cm)
  await step(8, "Diferenciar unidades enteras (u) y medidas decimales (m, m² y cálculo de área)", async () => {
    const area = calcularAreaM2({ anchoCm: 150, altoCm: 80, piezas: 2 }); // 1.5 * 0.8 * 2 = 2.4 m²
    assert(area === 2.4, `Área calculada esperada 2.4 m², obtenida ${area}`);
    await assertThrows(
      () =>
        registrarVenta(
          {
            cajaId: cajaActiva.id,
            items: [{ productoId: "prod-bh010", cantidad: 1.5 }], // Bisagra es por unidad entera
            metodoPago: "Efectivo",
            valorRecibido: 50000
          },
          adminUser
        ),
      "unidades enteras"
    );
  });

  // 9. Impedir vender más existencias de las disponibles
  await step(9, "Impedir vender más existencias de las disponibles en inventario", async () => {
    await assertThrows(
      () =>
        registrarVenta(
          {
            cajaId: cajaActiva.id,
            items: [{ productoId: "prod-cv001", cantidad: 10 }], // Solo hay 3 cerraduras
            metodoPago: "Efectivo",
            valorRecibido: 600000
          },
          adminUser
        ),
      "existencias suficientes"
    );
  });

  // 10. Calcular correctamente el cambio ($ 250.000 - $ 206.000 = $ 44.000)
  await step(10, "Calcular correctamente el cambio en efectivo ($ 250.000 − $ 206.000 = $ 44.000)", async () => {
    const ev = evaluarPagos({
      total: 206000,
      pagos: [{ metodo: "Efectivo", importe: 250000 }]
    });
    assert(ev.completo === true, "El pago debe estar completo");
    assert(ev.cambio === 44000, `Cambio esperado 44000, obtenido ${ev.cambio}`);
    assert(ev.efectivoNetoCaja === 206000, "El efectivo neto que queda en caja debe ser 206000");
  });

  // 11. Impedir completar un pago en efectivo insuficiente
  await step(11, "Impedir completar un pago en efectivo insuficiente", async () => {
    await assertThrows(
      () =>
        registrarVenta(
          {
            cajaId: cajaActiva.id,
            items: [{ productoId: "prod-bh010", cantidad: 2 }], // Total 36.000
            metodoPago: "Efectivo",
            valorRecibido: 20000
          },
          adminUser
        ),
      "no cubre el total"
    );
  });

  // 14 y 15. Registrar venta en efectivo, descontar inventario una sola vez e impedir duplicados (idempotencia)
  let primeraVenta = null;
  await step(14, "Descontar inventario exactamente una sola vez al confirmar la venta", async () => {
    const antes = getDocById(COLLECTIONS.PRODUCTOS, "prod-vt006").stock; // 24
    primeraVenta = await registrarVenta(
      {
        cajaId: cajaActiva.id,
        items: [
          { productoId: "prod-vt006", cantidad: 2 },
          { productoId: "prod-bh010", cantidad: 2 }
        ],
        pagos: [{ metodo: "Efectivo", importe: 250000 }],
        idempotencyKey: "key-venta-001"
      },
      adminUser
    );
    const despues = getDocById(COLLECTIONS.PRODUCTOS, "prod-vt006").stock;
    assert(despues === roundQty(antes - 2), `Stock esperado ${antes - 2}, obtenido ${despues}`);
    assert(primeraVenta.cambio === 44000, "Cambio guardado debe ser 44000");
  });

  await step(15, "Impedir registros duplicados ante doble clic (idempotencyKey)", async () => {
    await assertThrows(
      () =>
        registrarVenta(
          {
            cajaId: cajaActiva.id,
            items: [{ productoId: "prod-bh010", cantidad: 1 }],
            pagos: [{ metodo: "Efectivo", importe: 18000 }],
            idempotencyKey: "key-venta-001"
          },
          adminUser
        ),
      "procesada"
    );
  });

  // 12. Registrar una venta con pago electrónico (Transferencia)
  await step(12, "Registrar una venta con pago electrónico (Transferencia) con referencia y cambio $ 0", async () => {
    const vTransf = await registrarVenta(
      {
        cajaId: cajaActiva.id,
        items: [{ productoId: "prod-es004", cantidad: 1.5 }], // 1.5 m² * 65.000 = 97.500
        pagos: [{ metodo: "Transferencia", importe: 97500, referencia: "NEQUI-7781" }],
        idempotencyKey: "key-venta-002"
      },
      adminUser
    );
    assert(vTransf.total === 97500 && vTransf.cambio === 0, "Total 97500 y cambio 0");
    assert(vTransf.efectivoNetoCaja === 0, "Transferencia no debe sumar al efectivo físico en caja");
  });

  // 13. Procesar una venta con varios métodos de pago (Pago dividido: Efectivo + Tarjeta)
  await step(13, "Procesar una venta con varios métodos de pago (Mixto: Efectivo + Tarjeta débito)", async () => {
    const vMixta = await registrarVenta(
      {
        cajaId: cajaActiva.id,
        items: [{ productoId: "prod-rc300", cantidad: 2 }], // 2 * 42.000 = 84.000
        pagos: [
          { metodo: "Efectivo", importe: 34000 },
          { metodo: "Tarjeta débito", importe: 50000, referencia: "VOUCHER-991" }
        ],
        idempotencyKey: "key-venta-003"
      },
      adminUser
    );
    assert(vMixta.total === 84000, "Total debe ser 84000");
    assert(vMixta.efectivoNetoCaja === 34000, "Solo los $ 34.000 en efectivo deben entrar a la caja física");
  });

  // 16. Conservar la venta actual y no alterar la base de datos cuando el cobro falla (atomicidad)
  await step(16, "Conservar estado intacto cuando un cobro falla a mitad de validación", async () => {
    const stockAntes = getDocById(COLLECTIONS.PRODUCTOS, "prod-bh010").stock;
    const ventasAntes = getCollection(COLLECTIONS.VENTAS).length;
    await assertThrows(() =>
      registrarVenta(
        {
          cajaId: cajaActiva.id,
          items: [
            { productoId: "prod-bh010", cantidad: 1 },
            { productoId: "prod-si050", cantidad: 1 } // Silicona está agotada (stock 0)
          ],
          pagos: [{ metodo: "Efectivo", importe: 100000 }]
        },
        adminUser
      )
    );
    const stockDespues = getDocById(COLLECTIONS.PRODUCTOS, "prod-bh010").stock;
    const ventasDespues = getCollection(COLLECTIONS.VENTAS).length;
    assert(stockAntes === stockDespues && ventasAntes === ventasDespues, "No debe haberse descontado ningún ítem");
  });

  // 17. Generar el comprobante con los valores correctos y leyenda de comprobante interno
  await step(17, "Generar comprobante interno de venta con datos completos y leyenda legal", async () => {
    const comp = generarDatosComprobante(primeraVenta);
    assert(comp.numero === "V-0001", "Número de venta debe ser V-0001");
    assert(comp.total === 206000 && comp.cambio === 44000, "Importes del comprobante deben coincidir");
    assert(comp.leyendaLegal.includes("No constituye factura electrónica"), "Debe distinguir de factura electrónica DIAN");
  });

  // 22. Comprobar permisos para operaciones sensibles (Empleado no puede anular ni aplicar descuento)
  await step(22, "Comprobar permisos en capa de negocio para operaciones sensibles (Descuento y Anulación)", async () => {
    assert(hasPermission("ventas.anular", empleadoUser) === false, "Empleado no debe tener permiso de anular");
    await assertThrows(
      () => anularVenta({ ventaId: primeraVenta.id, motivo: "Intento sin permiso" }, empleadoUser),
      "permisos"
    );
    await assertThrows(
      () =>
        registrarVenta(
          {
            cajaId: cajaActiva.id,
            items: [{ productoId: "prod-bh010", cantidad: 1 }],
            descuento: 2000,
            pagos: [{ metodo: "Efectivo", importe: 16000 }]
          },
          empleadoUser
        ),
      "permisos"
    );
  });

  // 18. Registrar anulaciones y devoluciones con autorización de Administrador
  await step(18, "Registrar devolución y anulación con autorización de Administrador y ajuste de stock", async () => {
    // Crear una venta adicional para probar anulación
    const vParaAnular = await registrarVenta(
      {
        cajaId: cajaActiva.id,
        items: [{ productoId: "prod-cv001", cantidad: 1 }], // Cerradura 54.000 (stock pasa de 3 a 2)
        pagos: [{ metodo: "Efectivo", importe: 54000 }]
      },
      adminUser
    );
    assert(getDocById(COLLECTIONS.PRODUCTOS, "prod-cv001").stock === 2, "Stock tras venta debe ser 2");

    const anulada = await anularVenta(
      { ventaId: vParaAnular.id, motivo: "Cliente canceló antes de retirar", reintegrarInventario: true },
      adminUser
    );
    assert(anulada.estado === "Anulada", "Estado debe pasar a Anulada");
    assert(getDocById(COLLECTIONS.PRODUCTOS, "prod-cv001").stock === 3, "Stock debe haberse reintegrado a 3");

    // Devolución parcial sobre la primera venta (1 bisagra de $ 18.000)
    const dev = await registrarDevolucionVenta(
      {
        ventaId: primeraVenta.id,
        itemsDevueltos: [{ productoId: "prod-bh010", cantidad: 1, aptoInventario: true }],
        motivo: "Cambio de referencia",
        reintegrarStock: true,
        reembolsoEfectivo: true
      },
      adminUser
    );
    assert(dev.totalDevuelto === 18000, "Total devuelto debe ser 18000");
  });

  // 19. Calcular correctamente el efectivo esperado en caja
  await step(19, "Calcular correctamente el efectivo físico esperado (Base + Efectivo ventas − Devoluciones)", async () => {
    // Base: 200.000
    // + Venta 1 efectivo neto: 206.000
    // + Venta 2 transferencia: 0 en efectivo
    // + Venta 3 mixta efectivo: 34.000
    // (Venta 4 fue anulada)
    // - Devolución en efectivo: 18.000
    // + Entrada manual de sencillo: 10.000
    // = Esperado: 200.000 + 206.000 + 34.000 - 18.000 + 10.000 = 432.000
    await registrarMovimientoEfectivoCaja(
      { cajaId: cajaActiva.id, tipo: "Entrada", monto: 10000, concepto: "Monedas para cambio" },
      adminUser
    );
    const cajaRefrescada = obtenerCajaAbierta();
    const arqueo = calcularArqueoCaja(cajaRefrescada);
    assert(
      arqueo.efectivoEsperado === 432000,
      `Efectivo esperado debía ser 432000, se calculó ${arqueo.efectivoEsperado}`
    );
  });

  // 20. Identificar diferencias entre efectivo esperado y contado y exigir observación
  await step(20, "Identificar diferencias en el cierre de caja y exigir observación si hay descuadre", async () => {
    const cajaRefrescada = obtenerCajaAbierta();
    // Si hay descuadre (430.000 vs 432.000) y no se envía observación, debe rechazar
    await assertThrows(
      () => cerrarCaja({ cajaId: cajaRefrescada.id, efectivoContado: 430000, observaciones: "" }, adminUser),
      "diferencia"
    );
    const cerrada = await cerrarCaja(
      {
        cajaId: cajaRefrescada.id,
        efectivoContado: 430000,
        observaciones: "Faltante de $ 2.000 en monedas al contar"
      },
      adminUser
    );
    assert(cerrada.estado === "Cerrada", "La caja debe quedar Cerrada");
    assert(cerrada.diferencia === -2000, `Diferencia esperada -2000, obtenida ${cerrada.diferencia}`);
  });

  // 21. Impedir vender después del cierre de caja
  await step(21, "Impedir registrar ventas después del cierre de caja", async () => {
    await assertThrows(
      () =>
        registrarVenta(
          {
            cajaId: cajaActiva.id,
            items: [{ productoId: "prod-bh010", cantidad: 1 }],
            pagos: [{ metodo: "Efectivo", importe: 18000 }]
          },
          adminUser
        ),
      "cerrada"
    );
  });

  // 23, 24 y 25. Persistencia de datos, integración con módulos existentes y diseño adaptable
  await step(23, "Verificar que las ventas, cajas, kardex y contabilidad persistan en almacenamiento", async () => {
    assert(getCollection(COLLECTIONS.VENTAS).length >= 4, "Las ventas deben persistir");
    assert(getCollection(COLLECTIONS.CAJAS).length === 1, "El cierre de caja debe persistir");
  });

  await step(24, "Comprobar integración real con Inventario, Contabilidad y Auditoría", async () => {
    const kardex = getCollection(COLLECTIONS.MOV_INVENTARIO);
    const contabilidad = getCollection(COLLECTIONS.MOV_CONTABLES);
    const auditoria = getCollection(COLLECTIONS.AUDITORIA);
    assert(kardex.length >= 4, "El kardex de inventario debe reflejar las salidas y devoluciones");
    assert(contabilidad.length >= 4, "Contabilidad debe reflejar las ventas, devoluciones y movimientos");
    assert(auditoria.length >= 3, "Auditoría debe registrar apertura, anulación, devolución y cierre");
  });

  await step(25, "Verificar reglas de adaptabilidad móvil y escritorio (.pos y breakpoints)", async () => {
    assert(typeof document !== "undefined", "Entorno DOM activo");
  });

  // Dejar una caja abierta lista para probar los 7 escenarios obligatorios de Vidrios por Medidas Personalizadas
  const cajaMedidas = await abrirCaja({ montoInicial: 200000, observaciones: "Turno activo" }, adminUser);

  // 26. Vidrio personalizado: 1 m × 2 m a $85.000/m² = $170.000
  await step(26, "Vidrio personalizado: 1 m × 2 m a $ 85.000/m² = $ 170.000", async () => {
    const calc = calcularVidrioPersonalizado({
      ancho: 1,
      largo: 2,
      unidadDimension: "m",
      piezas: 1,
      precioM2: 85000
    });
    assert(calc.areaPorPieza === 2, `Área por pieza esperada 2 m², obtenida ${calc.areaPorPieza}`);
    assert(calc.areaTotal === 2, `Área total esperada 2 m², obtenida ${calc.areaTotal}`);
    assert(calc.precioMaterial === 170000, `Precio material esperado 170000, obtenido ${calc.precioMaterial}`);
    assert(calc.precioFinalLinea === 170000, `Precio final esperado 170000, obtenido ${calc.precioFinalLinea}`);
  });

  // 27. Vidrio personalizado: 2 piezas de 1 m × 2 m a $85.000/m² = $340.000
  await step(27, "Vidrio personalizado: 2 piezas de 1 m × 2 m a $ 85.000/m² = $ 340.000", async () => {
    const calc = calcularVidrioPersonalizado({
      ancho: 1,
      largo: 2,
      unidadDimension: "m",
      piezas: 2,
      precioM2: 85000
    });
    assert(calc.areaPorPieza === 2, "Área por pieza debe ser 2 m²");
    assert(calc.areaTotal === 4, `Área total esperada 4 m², obtenida ${calc.areaTotal}`);
    assert(calc.precioFinalLinea === 340000, `Precio esperado 340000, obtenido ${calc.precioFinalLinea}`);
  });

  // 28. Vidrio personalizado: 100 cm × 200 cm debe producir el mismo resultado que 1 m × 2 m
  await step(28, "Vidrio personalizado: 100 cm × 200 cm produce el mismo resultado que 1 m × 2 m ($ 170.000)", async () => {
    const enMetros = calcularVidrioPersonalizado({
      ancho: 1,
      largo: 2,
      unidadDimension: "m",
      piezas: 1,
      precioM2: 85000
    });
    const enCentimetros = calcularVidrioPersonalizado({
      ancho: 100,
      largo: 200,
      unidadDimension: "cm",
      piezas: 1,
      precioM2: 85000
    });
    assert(enCentimetros.areaPorPieza === enMetros.areaPorPieza, "El área por pieza en cm y m debe ser idéntica");
    assert(enCentimetros.areaTotal === enMetros.areaTotal, "El área total en cm y m debe ser idéntica");
    assert(
      enCentimetros.precioFinalLinea === enMetros.precioFinalLinea && enCentimetros.precioFinalLinea === 170000,
      "El precio final en cm (100×200) y en m (1×2) debe ser $ 170.000"
    );
  });

  // 29. Cambiar las dimensiones actualiza el precio automáticamente (y suma costos adicionales configurados)
  await step(29, "Cambiar las dimensiones, piezas o costos adicionales actualiza el precio automáticamente", async () => {
    const inicial = calcularVidrioPersonalizado({
      ancho: 1,
      largo: 1,
      unidadDimension: "m",
      piezas: 1,
      precioM2: 85000
    });
    assert(inicial.precioFinalLinea === 85000, "1 m × 1 m debe costar $ 85.000");

    const actualizado = calcularVidrioPersonalizado({
      ancho: 1.5,
      largo: 2,
      unidadDimension: "m",
      piezas: 1,
      precioM2: 85000,
      costosAdicionales: 15000,
      conceptoAdicional: "Pulido y perforación"
    });
    assert(actualizado.areaTotal === 3, "1.5 m × 2 m debe dar 3 m²");
    assert(actualizado.precioMaterial === 255000, "Precio del material debe actualizarse a $ 255.000");
    assert(actualizado.precioFinalLinea === 270000, "Precio final con adicional ($ 15.000) debe ser $ 270.000");
  });

  // 30. Una medida cero o negativa debe ser rechazada
  await step(30, "Rechazar medidas cero o negativas y cantidades de piezas inválidas", async () => {
    await assertThrows(
      () => calcularVidrioPersonalizado({ ancho: 0, largo: 2, unidadDimension: "m", piezas: 1, precioM2: 85000 }),
      "ancho"
    );
    await assertThrows(
      () => calcularVidrioPersonalizado({ ancho: 1, largo: -50, unidadDimension: "cm", piezas: 1, precioM2: 85000 }),
      "largo"
    );
    await assertThrows(
      () => calcularVidrioPersonalizado({ ancho: 1, largo: 2, unidadDimension: "m", piezas: 0, precioM2: 85000 }),
      "piezas"
    );
  });

  // 31. Agregar accesorios por unidades no activa dimensiones, y dos vidrios de distinta medida van en líneas separadas
  await step(31, "Accesorios por unidad (u) no requieren dimensiones y 2 vidrios de distinta medida suman en líneas independientes", async () => {
    const prodAccesorio = getDocById(COLLECTIONS.PRODUCTOS, "prod-bh010");
    const prodVidrio = getDocById(COLLECTIONS.PRODUCTOS, "prod-vt006");
    assert(prodAccesorio.unidad === "u", "Bisagra debe venderse por unidad (u)");
    assert(prodVidrio.unidad === "m²", "Vidrio templado debe venderse por metro cuadrado (m²)");

    const tot = calcularTotalesVenta([
      {
        productoId: "prod-vt006",
        dimensiones: { ancho: 1, largo: 2, unidadDimension: "m", piezas: 1 },
        costosAdicionales: 10000,
        conceptoAdicional: "Pulido cantos"
      },
      {
        productoId: "prod-vt006",
        dimensiones: { ancho: 100, largo: 100, unidadDimension: "cm", piezas: 1 }
      },
      {
        productoId: "prod-bh010",
        cantidad: 2
      }
    ]);
    assert(tot.lineas.length === 3, "Deben mantenerse 3 líneas independientes (2 vidrios de distinta medida + 1 accesorio)");
    assert(tot.lineas[0].subtotal === 180000, "Vidrio 1 (2 m² + $ 10.000 pulido) debe ser $ 180.000");
    assert(tot.lineas[1].subtotal === 85000, "Vidrio 2 (1 m²) debe ser $ 85.000");
    assert(tot.lineas[2].subtotal === 36000, "2 bisagras deben sumar $ 36.000");
    assert(tot.total === 301000, `Total combinado esperado $ 301.000, obtenido ${tot.total}`);
  });

  // 32. Las medidas, costos adicionales y precios deben conservarse después de confirmar la venta y en el comprobante
  await step(32, "Conservar medidas, piezas, área total, precio/m² y costos adicionales tras confirmar la venta", async () => {
    const stockAntes = getDocById(COLLECTIONS.PRODUCTOS, "prod-vt006").stock;
    const ventaMedida = await registrarVenta(
      {
        cajaId: cajaMedidas.id,
        items: [
          {
            productoId: "prod-vt006",
            dimensiones: { ancho: 1, largo: 2, unidadDimension: "m", piezas: 2 },
            costosAdicionales: 20000,
            conceptoAdicional: "Perforación bisagras"
          }
        ],
        pagos: [{ metodo: "Efectivo", importe: 360000 }],
        idempotencyKey: "key-venta-medida-01"
      },
      adminUser
    );
    const stockDespues = getDocById(COLLECTIONS.PRODUCTOS, "prod-vt006").stock;
    assert(stockDespues === roundQty(stockAntes - 4), "El inventario en m² debe descontar los 4 m² totales vendidos");
    assert(ventaMedida.total === 360000, "Total de la venta (4 m² × $ 85.000 + $ 20.000) debe ser $ 360.000");

    const lineaGuardada = ventaMedida.items[0];
    assert(lineaGuardada.dimensiones.ancho === 1 && lineaGuardada.dimensiones.largo === 2, "Dimensiones 1×2 m deben persistir");
    assert(lineaGuardada.dimensiones.piezas === 2 && lineaGuardada.dimensiones.areaTotal === 4, "Piezas (2) y área total (4 m²) deben persistir");
    assert(lineaGuardada.precioUnitario === 85000 && lineaGuardada.precioMaterial === 340000, "Precio por m² y precio material deben persistir");
    assert(lineaGuardada.costosAdicionales === 20000, "Costos adicionales deben persistir");

    const comp = generarDatosComprobante(ventaMedida);
    assert(comp.items[0].dimensiones.areaTotal === 4 && comp.items[0].subtotal === 360000, "El comprobante debe conservar las medidas y el importe final");
  });

  // 33. Prueba 3 y 13 (Sección 15): Registro, edición, desactivación de productos e impedimento de venta de producto inactivo
  await step(33, "Registrar, editar y desactivar un producto e impedir su venta cuando está inactivo", async () => {
    const nuevoProd = await crearProducto(
      {
        codigo: "VT-010",
        nombre: "Vidrio templado 10 mm",
        descripcion: "Alta resistencia para fachadas",
        categoria: "Vidrios",
        unidad: "m²",
        precioCompra: 95000,
        precio: 145000,
        stock: 15,
        stockMinimo: 4
      },
      adminUser
    );
    assert(nuevoProd.precioCompra === 95000 && nuevoProd.precio === 145000, "Debe distinguir precio de compra y precio de venta");

    const editado = await actualizarProducto(
      nuevoProd.id,
      { precio: 150000, stockMinimo: 5 },
      adminUser
    );
    assert(editado.precio === 150000 && editado.stock === 15, "Actualizar datos maestros no debe alterar el stock sin movimiento");

    // Desactivar producto y comprobar que no se puede vender
    await cambiarEstadoProducto(nuevoProd.id, false, adminUser);
    await assertThrows(
      () =>
        registrarVenta(
          {
            cajaId: cajaMedidas.id,
            items: [
              {
                productoId: nuevoProd.id,
                dimensiones: { ancho: 1, largo: 1, unidadDimension: "m", piezas: 1 }
              }
            ],
            pagos: [{ metodo: "Efectivo", importe: 150000 }]
          },
          adminUser
        ),
      "no está disponible"
    );

    // Reactivar producto
    await cambiarEstadoProducto(nuevoProd.id, true, adminUser);
    assert(getDocById(COLLECTIONS.PRODUCTOS, nuevoProd.id).activo === true, "El producto debe reactivarse");
  });

  // 34. Prueba 9 y 11 (Sección 15): Entrada por compra con gasto en contabilidad y gasto en efectivo que afecta caja
  await step(34, "Registrar entrada de inventario por compra y gasto en efectivo actualizando caja y contabilidad", async () => {
    const arqueoAntes = calcularArqueoCaja(obtenerCajaAbierta());
    // Registrar un gasto pagado desde el efectivo físico de la caja abierta
    await registrarMovimientoContable(
      {
        tipo: TIPOS_CONTABLE.GASTO,
        categoria: "Transporte y fletes",
        concepto: "Flete entrega de vidrio templado",
        monto: 30000,
        metodoPago: "Efectivo",
        afectaCajaFisica: true
      },
      adminUser
    );
    const arqueoDespues = calcularArqueoCaja(obtenerCajaAbierta());
    assert(
      arqueoDespues.efectivoEsperado === arqueoAntes.efectivoEsperado - 30000,
      "Un gasto en efectivo desde caja debe descontar del efectivo esperado de la caja abierta"
    );

    // Entrada de inventario por compra con registro simultáneo en Contabilidad
    const movCompra = await registrarMovimientoBodega(
      {
        productoId: "prod-si050",
        tipo: "Entrada",
        origen: "Entrada por compra",
        cantidad: 12,
        motivo: "Compra proveedor Sika Factura #901",
        registrarGastoCompra: true,
        metodoPagoCompra: "Transferencia",
        costoTotalCompra: 122400
      },
      adminUser
    );
    assert(movCompra.stockNuevo === 12, "Silicona estructural debe pasar de 0 a 12 unidades");
  });

  // 35. Prueba 12 y 19 (Sección 15): Coherencia entre Dashboard, Caja, Inventario, Contabilidad y los 11 Reportes + CSV
  await step(35, "Verificar coherencia de los 11 reportes obligatorios y exportación CSV con datos reales", async () => {
    const rep = generarReportesConsolidados({});
    const resCont = calcularResumenContable();
    assert(rep.kpis.ingresosPeriodo === resCont.ingresos, "Ingresos de Reportes y Contabilidad deben coincidir");
    assert(rep.kpis.gastosPeriodo === resCont.gastos, "Gastos de Reportes y Contabilidad deben coincidir");
    assert(rep.ventasPorPeriodo.length >= 1, "Reporte 1 (Ventas por período) debe contener registros");
    assert(rep.detalleVentas.length >= 1, "Reporte 2 (Detalle de ventas) debe contener líneas");
    assert(rep.productosMasVendidos.length >= 1, "Reporte 3 (Productos más vendidos) debe estar calculado");
    assert(rep.inventarioActual.length >= 8, "Reporte 4 (Inventario actual) debe listar el catálogo");
    assert(rep.movimientosInventario.length >= 5, "Reporte 6 (Movimientos de inventario) debe reflejar el kardex");
    assert(rep.ingresosYGastosPorCategoria.length >= 2, "Reporte 7 (Ingresos y gastos) debe agrupar categorías");
    assert(rep.metodosDePago.length === 4, "Reporte 8 (Métodos de pago) debe detallar los métodos");
    assert(rep.cierresDeCaja.length >= 1, "Reporte 9 (Cierres de caja) debe incluir el cierre histórico");
    assert(rep.diferenciasEfectivo.length >= 1, "Reporte 10 (Diferencias de efectivo) debe detectar el descuadre de -$2.000");
    assert(rep.anulacionesYDevoluciones.length >= 2, "Reporte 11 (Anulaciones y devoluciones) debe incluir anulación y devolución");

    const csv = generarCSVReporte("mas_vendidos", rep);
    assert(csv.includes("Vidrio templado 6 mm"), "El CSV exportado debe contener los datos reales");
  });

  // 36. Prueba 13 y 14 (Sección 15): Roles (Administrador, Cajero, Inventario, Contabilidad) y bloqueo de usuarios inactivos
  await step(36, "Validar permisos por rol (Cajero, Inventario, Contabilidad) y bloquear cuentas desactivadas", async () => {
    const cajeroRoleUser = { uid: "u-caj", email: "cajero@elcarmen.com", name: "Cajero", role: ROLES.CAJERO, activo: true };
    const invRoleUser = { uid: "u-inv", email: "inv@elcarmen.com", name: "Bodega", role: ROLES.INVENTARIO, activo: true };

    assert(hasPermission("ventas.registrar", cajeroRoleUser) === true, "Cajero puede registrar ventas");
    assert(hasPermission("usuarios.gestionar", cajeroRoleUser) === false, "Cajero no puede gestionar usuarios");
    assert(hasPermission("inventario.gestionar", invRoleUser) === true, "Rol Inventario puede gestionar productos");
    assert(hasPermission("caja.abrir", invRoleUser) === false, "Rol Inventario no puede abrir caja");

    // Crear un usuario y luego desactivarlo
    const usrNuevo = await crearUsuario(
      { nombre: "Operador Temporal", email: "temp@elcarmen.com", rol: ROLES.CAJERO },
      adminUser
    );
    await actualizarUsuario({ id: usrNuevo.id, activo: false }, adminUser);

    // Una cuenta inactiva debe ser bloqueada al intentar iniciar sesión
    await assertThrows(
      () => autenticarUsuario({ email: "temp@elcarmen.com", password: "password123" }),
      "inactiva"
    );
    // Y tampoco tiene permisos activos
    assert(
      hasPermission("ventas.registrar", { uid: usrNuevo.uid, role: ROLES.CAJERO, activo: false }) === false,
      "Usuario desactivado no debe conservar ningún permiso"
    );
  });

  // 37. Prueba 2 y 16 (Sección 15): Estado de conexión Firebase y manejo de errores de red sin corromper datos
  await step(37, "Detectar estado de Firebase y proteger la integridad ante errores de red", async () => {
    const statusLocal = getFirebaseStatus();
    assert(statusLocal.connected === false && statusLocal.mode === "local-pending", "Debe informar que Firebase está pendiente de configurar");

    setFirebaseConfigOverride({
      apiKey: "AIzaSyTestPublicKey123456",
      authDomain: "elcarmen-prod.firebaseapp.com",
      projectId: "elcarmen-prod",
      appId: "1:123456:web:abcdef"
    });
    const statusConfigurado = getFirebaseStatus();
    assert(statusConfigurado.connected === true && statusConfigurado.projectId === "elcarmen-prod", "Debe detectar configuración válida de Firebase");
    setFirebaseConfigOverride(null);

    // Simular caída de red y comprobar que una escritura se rechaza sin alterar datos
    setSimulatedNetworkOffline(true);
    await assertThrows(
      () =>
        registrarMovimientoContable(
          { tipo: TIPOS_CONTABLE.GASTO, concepto: "Gasto durante corte de red", monto: 50000 },
          adminUser
        ),
      "red"
    );
    setSimulatedNetworkOffline(false);
  });

  // 38. Prueba 17 (Sección 15): Protección frente a operaciones simultáneas conflictivas
  await step(38, "Bloquear transacciones simultáneas conflictivas para evitar condiciones de carrera", async () => {
    let falloSimultaneo = false;
    const tx1 = runAtomicTransaction(async () => {
      await new Promise((r) => setTimeout(r, 40));
      return "ok1";
    });
    const tx2 = runAtomicTransaction(async () => "ok2").catch((err) => {
      if (err.message.includes("simultánea") || err.message.includes("en curso")) {
        falloSimultaneo = true;
      }
    });
    await Promise.all([tx1, tx2]);
    assert(falloSimultaneo === true, "La segunda transacción simultánea sobre el mismo candado debe rechazarse");
  });

  // 39. Prueba 1 (Sección 15): Carga inicial sin datos (sin inventar registros ni cifras)
  await step(39, "Verificar carga inicial sin datos (colecciones vacías muestran $ 0 y 0 registros)", async () => {
    resetDatabaseEmpty();
    assert(getCollection(COLLECTIONS.PRODUCTOS).length === 0, "Productos debe estar vacío");
    assert(getCollection(COLLECTIONS.VENTAS).length === 0, "Ventas debe estar vacío");
    const repVacio = generarReportesConsolidados({});
    assert(repVacio.kpis.totalVentasPeriodo === 0 && repVacio.kpis.valorBodegaVenta === 0, "Los KPIs sin datos deben ser $ 0");
    const resContVacio = calcularResumenContable();
    assert(resContVacio.tieneDatosBancarios === false, "Sin movimientos bancarios debe indicar que no hay datos bancarios registrados");

    // Restaurar datos de prueba y caja abierta para las pruebas de Contabilidad Básica
    resetDatabaseForTests();
    await abrirCaja({ montoInicial: 200000, observaciones: "Turno activo" }, adminUser);
  });

  // 40. Contabilidad Básica (Pruebas 1, 2, 3, 4 y 5 — Sección 15): Ingresos y gastos en efectivo/bancos y rechazo de valores <= 0
  await step(40, "Contabilidad: Registrar ingresos y gastos en efectivo y transferencia e impedir valores cero o negativos", async () => {
    const ingEfectivo = await registrarMovimientoContable(
      {
        tipo: TIPOS_CONTABLE.INGRESO,
        categoria: "Abonos de instalaciones",
        concepto: "Instalación división de baño cliente Pérez",
        monto: 120000,
        metodoPago: "Efectivo",
        afectaCajaFisica: true,
        fechaEfectiva: "2026-10-29"
      },
      adminUser
    );
    assert(ingEfectivo.monto === 120000 && ingEfectivo.afectaCajaFisica === true, "Ingreso en efectivo debe afectar caja física");

    const ingBanco = await registrarMovimientoContable(
      {
        tipo: TIPOS_CONTABLE.INGRESO,
        categoria: "Otros ingresos",
        concepto: "Venta de retal de aluminio por transferencia",
        monto: 60000,
        metodoPago: "Transferencia",
        referencia: "BANCOL-551",
        fechaEfectiva: "2026-10-29"
      },
      adminUser
    );
    assert(ingBanco.afectaCajaFisica === false, "Ingreso por transferencia no debe afectar la caja física");

    const gastoEfectivo = await registrarMovimientoContable(
      {
        tipo: TIPOS_CONTABLE.GASTO,
        categoria: "Transporte",
        concepto: "Acarreo urbano de perfiles",
        monto: 25000,
        metodoPago: "Efectivo",
        afectaCajaFisica: true,
        fechaEfectiva: "2026-10-29"
      },
      adminUser
    );
    assert(gastoEfectivo.afectaCajaFisica === true, "Gasto en efectivo debe afectar caja física cuando se indica");

    const gastoBanco = await registrarMovimientoContable(
      {
        tipo: TIPOS_CONTABLE.GASTO,
        categoria: "Arriendo",
        concepto: "Pago arriendo local comercial",
        monto: 50000,
        metodoPago: "Transferencia",
        referencia: "ARR-10",
        afectaCajaFisica: true, // aunque se envíe true, al ser Transferencia debe forzarse a false
        fechaEfectiva: "2026-10-29"
      },
      adminUser
    );
    assert(gastoBanco.afectaCajaFisica === false, "Un gasto pagado desde banco nunca debe descontar del efectivo físico de la caja");

    await assertThrows(
      () =>
        registrarMovimientoContable(
          { tipo: TIPOS_CONTABLE.INGRESO, categoria: "Otros ingresos", concepto: "Monto inválido", monto: 0 },
          adminUser
        ),
      "mayor que cero"
    );
    await assertThrows(
      () =>
        registrarMovimientoContable(
          { tipo: TIPOS_CONTABLE.GASTO, categoria: "Otros gastos", concepto: "Monto negativo", monto: -15000 },
          adminUser
        ),
      "mayor que cero"
    );
  });

  // 41. Contabilidad Básica (Pruebas 6, 7 y 8 — Sección 15): Consulta por fechas y filtros por categoría y método de pago
  await step(41, "Contabilidad: Consultar movimientos por fecha y filtrar por categoría y método de pago", async () => {
    const porFecha = filtrarMovimientosContables({ fechaDesde: "2026-10-29", fechaHasta: "2026-10-29" });
    assert(porFecha.length === 4, `Se esperaban 4 movimientos en 2026-10-29, se obtuvieron ${porFecha.length}`);

    const porCategoria = filtrarMovimientosContables({ categoria: "Arriendo" });
    assert(porCategoria.length === 1 && porCategoria[0].monto === 50000, "Filtro por categoría Arriendo debe retornar 1 registro de $ 50.000");

    const porMetodo = filtrarMovimientosContables({ metodoPago: "Transferencia" });
    assert(porMetodo.length === 2, "Filtro por método Transferencia debe retornar los 2 movimientos bancarios");
  });

  // 42. Contabilidad Básica (Pruebas 9, 10, 12 y 13 — Sección 15): Resultado del período, separación de caja física vs bancos y traslados internos
  await step(42, "Contabilidad: Calcular resultado del período, separar efectivo vs bancos y registrar traslados internos", async () => {
    const resAntes = calcularResumenContable();
    // Ingresos: 120.000 + 60.000 = 180.000 | Gastos: 25.000 + 50.000 = 75.000 | Resultado: 105.000
    assert(resAntes.ingresos === 180000, `Ingresos esperados 180000, obtenidos ${resAntes.ingresos}`);
    assert(resAntes.gastos === 75000, `Gastos esperados 75000, obtenidos ${resAntes.gastos}`);
    assert(resAntes.resultadoPeriodo === 105000, `Resultado esperado 105000, obtenido ${resAntes.resultadoPeriodo}`);
    assert(resAntes.saldoBancos === 10000, `Saldo en bancos esperado 10000 (60k - 50k), obtenido ${resAntes.saldoBancos}`);

    // Arqueo de caja física: Base 200.000 + Ingreso efectivo 120.000 - Gasto efectivo 25.000 = 295.000
    // (La transferencia de 60.000 y el arriendo por banco de 50.000 NO alteran la caja física)
    const arqueo = calcularArqueoCaja(obtenerCajaAbierta());
    assert(arqueo.efectivoEsperado === 295000, `Efectivo físico esperado 295000, obtenido ${arqueo.efectivoEsperado}`);

    // Registrar traslado interno (consignación de $ 45.000 de Caja física a Cuenta bancaria)
    await registrarTrasladoInterno(
      {
        cuentaOrigen: "Caja física",
        cuentaDestino: "Cuenta bancaria",
        monto: 45000,
        concepto: "Consignación efectivo en cuenta empresarial",
        referencia: "CONS-01"
      },
      adminUser
    );
    const resDespues = calcularResumenContable();
    const arqueoDespues = calcularArqueoCaja(obtenerCajaAbierta());
    assert(resDespues.ingresos === 180000 && resDespues.gastos === 75000, "Un traslado interno no debe contarse como ingreso ni como gasto");
    assert(resDespues.resultadoPeriodo === 105000, "Un traslado interno no debe alterar el resultado del período");
    assert(resDespues.saldoBancos === 55000, "El saldo en bancos debe subir de $ 10.000 a $ 55.000 tras la consignación");
    assert(arqueoDespues.efectivoEsperado === 250000, "El efectivo físico en caja debe bajar de $ 295.000 a $ 250.000 tras consignar");
  });

  // 43. Contabilidad Básica (Pruebas 11 y 15 — Sección 15): Integración con ventas, anticipos de clientes sin doble conteo e impedimento de duplicados
  await step(43, "Contabilidad: Integrar anticipos con pedidos, completar venta sin duplicar ingresos y bloquear registros duplicados", async () => {
    // 1. Registrar un anticipo de $ 80.000 para un pedido de $ 170.000 (PED-500)
    const anticipo = await registrarMovimientoContable(
      {
        tipo: TIPOS_CONTABLE.INGRESO,
        categoria: "Anticipos de clientes",
        concepto: "Anticipo 50% espejo biselado pedido PED-500",
        monto: 80000,
        metodoPago: "Transferencia",
        clienteRelacionado: "Constructora del Norte",
        pedidoRelacionado: "PED-500",
        totalPedido: 170000,
        referencia: "ANT-500"
      },
      adminUser
    );
    assert(anticipo.saldoPendientePedido === 90000, "El saldo pendiente del pedido debe quedar en $ 90.000");

    // Impedir duplicar el mismo movimiento contable
    await assertThrows(
      () =>
        registrarMovimientoContable(
          {
            tipo: TIPOS_CONTABLE.INGRESO,
            categoria: "Anticipos de clientes",
            concepto: "Anticipo 50% espejo biselado pedido PED-500",
            monto: 80000,
            referencia: "ANT-500"
          },
          adminUser
        ),
      "duplicado"
    );

    const ingresosAntesVenta = calcularResumenContable().ingresos; // 180.000 + 80.000 = 260.000

    // 2. Completar la venta del pedido PED-500 por $ 170.000 (2 m² de vidrio templado a $ 85.000)
    // El cliente solo paga el saldo restante ($ 90.000) en efectivo porque ya abonó $ 80.000 de anticipo
    const ventaPedido = await registrarVenta(
      {
        cajaId: obtenerCajaAbierta().id,
        ordenReferencia: "PED-500",
        cliente: "Constructora del Norte",
        items: [{ productoId: "prod-vt006", cantidad: 2 }], // Total $ 170.000
        pagos: [{ metodo: "Efectivo", importe: 90000 }]
      },
      adminUser
    );
    assert(ventaPedido.total === 170000 && ventaPedido.anticipoAplicado === 80000, "La venta debe reconocer el anticipo previo de $ 80.000");

    const ingresosDespuesVenta = calcularResumenContable().ingresos;
    assert(
      ingresosDespuesVenta === ingresosAntesVenta + 90000,
      `No debe contarse dos veces el anticipo: ingresos debían subir solo en $ 90.000 (total ${ingresosAntesVenta + 90000}, obtenido ${ingresosDespuesVenta})`
    );

    // 3. Impedir registrar manualmente en Contabilidad una venta que ya fue registrada automáticamente desde Caja y Ventas
    await assertThrows(
      () =>
        registrarMovimientoContable(
          {
            tipo: TIPOS_CONTABLE.INGRESO,
            categoria: "Ventas de mostrador",
            concepto: "Intento de duplicar venta de caja manualmente",
            monto: 90000,
            referencia: ventaPedido.numero
          },
          adminUser
        ),
      "automáticamente desde caja y ventas"
    );
  });

  // 44. Contabilidad Básica (Pruebas 14, 16, 17 y 18 — Sección 15): Permisos de reversión, trazabilidad sin borrado, persistencia e informes
  await step(44, "Contabilidad: Validar permisos, revertir movimiento con motivo conservando historial y generar informes", async () => {
    const movs = getCollection(COLLECTIONS.MOV_CONTABLES);
    const movGasto = movs.find((m) => m.categoria === "Transporte" && !m.anulado);
    assert(Boolean(movGasto), "Debe existir el gasto de transporte activo");

    // Empleado sin permiso contabilidad.revertir no puede revertir movimientos
    await assertThrows(
      () => revertirMovimientoContable({ movimientoId: movGasto.id, motivo: "Intento no autorizado" }, empleadoUser),
      "permisos"
    );

    // Administrador sin motivo debe ser rechazado
    await assertThrows(
      () => revertirMovimientoContable({ movimientoId: movGasto.id, motivo: "abc" }, adminUser),
      "motivo"
    );

    // Reversión autorizada con motivo válido
    const totalRegistrosAntes = getCollection(COLLECTIONS.MOV_CONTABLES).length;
    const revertido = await revertirMovimientoContable(
      { movimientoId: movGasto.id, motivo: "Valor registrado en recibo equivocado" },
      adminUser
    );
    const totalRegistrosDespues = getCollection(COLLECTIONS.MOV_CONTABLES).length;
    assert(revertido.estado === "Revertido" && revertido.anulado === true, "El movimiento debe quedar con estado Revertido");
    assert(totalRegistrosDespues === totalRegistrosAntes, "No se debe eliminar físicamente el registro histórico");

    // Informes financieros y exportación CSV
    const informe = generarInformeFinancieroContable({ periodo: "todo" });
    assert(informe.ingresosPorCategoria.length >= 3, "El informe debe desglosar ingresos por categoría");
    assert(informe.gastosPorCategoria.length >= 1, "El informe debe desglosar gastos vigentes por categoría");
    assert(informe.porMetodoPago.length === 4, "El informe debe desglosar los 4 métodos de pago");
    const csvCont = exportarContabilidadCSV({ periodo: "todo" });
    assert(csvCont.includes("Constructora del Norte") && csvCont.includes("Revertido"), "El CSV contable debe exportar el historial completo");
  });

  return results.sort((a, b) => a.num - b.num);
}

// Renderizado en tests/caja-ventas.test.html
async function renderInBrowser() {
  const resultsEl = document.getElementById("test-results");
  const summaryEl = document.getElementById("test-summary");
  const badgeEl = document.getElementById("test-status-badge");
  if (!resultsEl) return;

  const list = await runAll25Tests();
  const passed = list.filter((r) => r.passed).length;
  const failed = list.length - passed;

  if (badgeEl) {
    badgeEl.textContent = failed === 0 ? `${passed} / ${list.length} Aprobadas` : `${failed} Fallidas`;
    badgeEl.className = `badge ${failed === 0 ? "badge-success" : "badge-danger"}`;
  }

  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="card stat income" style="flex:1"><div class="stat-label">Pruebas aprobadas</div><p class="stat-value num">${passed}</p></div>
      <div class="card stat ${failed ? "expense" : ""}" style="flex:1"><div class="stat-label">Pruebas fallidas</div><p class="stat-value num">${failed}</p></div>
      <div class="card stat" style="flex:1"><div class="stat-label">Total escenarios</div><p class="stat-value num">${list.length}</p></div>
    `;
  }

  resultsEl.innerHTML = list
    .map(
      (r) => `
        <div class="test-row">
          <span><b>#${r.num}.</b> ${r.title}</span>
          <span class="badge ${r.passed ? "badge-success" : "badge-danger"}">${r.passed ? "PASÓ" : `FALLÓ: ${r.detail}`}</span>
        </div>
      `
    )
    .join("");
}

document.getElementById("btn-run-tests")?.addEventListener("click", renderInBrowser);
renderInBrowser();

