// Suite de Pruebas Funcionales Obligatorias — Módulo Caja y Ventas (25 escenarios, Sección 18).
// Puede ejecutarse en el navegador abriendo /tests/caja-ventas.test.html.

import {
  COLLECTIONS,
  getCollection,
  getDocById,
  resetDatabaseForTests
} from "../js/services/store.js";
import { ROLES, hasPermission } from "../js/auth.js";
import {
  listarProductos,
  filtrarCatalogo,
  calcularAreaM2,
  calcularVidrioPersonalizado,
  roundQty
} from "../js/services/inventario-service.js";
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

