# Guía de Preparación, Seguridad y Conexión de Firebase — Vidrios y Aluminios El Carmen

## 1. Diagnóstico de la Arquitectura Actual (Etapa 3)

- **Tecnologías utilizadas:** HTML5, CSS3 modular (`css/base.css`, `css/layout.css`, `css/components.css`, `css/modules.css`, `css/print.css`, `css/login.css`) y JavaScript nativo con ES Modules (`js/`). No existen dependencias de frameworks externos (React/Angular/Vue) ni de Java.
- **Navegación SPA e híbrida:** `index.html` funciona como contenedor SPA con plantillas `<template id="tpl-...">` y enrutador en `js/router.js`, sincronizado con las vistas individuales en `html/dashboard.html`, `html/caja.html`, `html/inventario.html`, `html/contabilidad.html`, `html/reportes.html` y `html/usuarios.html`.
- **Almacenamiento e integración entre los 6 módulos:**
  - `js/firebase-config.js`: Inicialización centralizada (Singleton) del SDK oficial de Firebase v10.12.2 (`firebase-app.js`, `firebase-auth.js`, `firebase-firestore.js`) y soporte para Firebase Emulator Suite.
  - `js/services/firebase-service.js`: Servicios separados de lectura (`consultarColeccionFirestore`, `consultarDocumentoFirestore`, `suscribirColeccionFirestore`), escritura atómica (`guardarDocumentoFirestore`, `escribirLoteFirestore`), traducción centralizada de errores (`traducirErrorFirebase`), verificación real de conexión (`verificarConexionRealFirebase`) y auditoría/migración controlada de `localStorage`.
  - `js/services/store.js`: Capa transaccional que conecta a los 6 módulos (**Dashboard**, **Caja y Ventas**, **Inventario**, **Contabilidad**, **Reportes** y **Usuarios**) sobre las mismas colecciones.

---

## 2. Estructura de Colecciones en Cloud Firestore (Etapa 7)

Se utilizan **9 colecciones principales** diseñadas para minimizar lecturas duplicadas y mantener atomicidad en las operaciones de una vidriería:

1. **`usuarios`**: `{ id, uid, nombre, email, rol, activo, creadoPor, creadoEn, actualizadoEn }`. Nunca almacena contraseñas. Controla permisos en `firestore.rules` y en `js/auth.js`.
2. **`productos`**: `{ id, codigo, nombre, descripcion, categoria, unidad ('m²'|'m'|'u'), permiteDecimal, permiteDimensiones, precioCompra, precio, stock, stockMinimo, activo }`.
3. **`clientes`**: `{ id, nombre, documento, telefono, esConsumidorFinal }`.
4. **`cajas`**: `{ id, usuarioApertura, fechaApertura, montoInicial, estado ('Abierta'|'Cerrada'), movimientosEfectivoExtra[], efectivoEsperado, efectivoContado, diferencia, fechaCierre, observacionesCierre }`.
   - *Justificación:* Embeber `movimientosEfectivoExtra` dentro del turno de caja evita lecturas adicionales al calcular el arqueo en tiempo real.
5. **`ventas`**: `{ id, numero, cajaId, fecha, clienteId, cliente, vendedor, ordenReferencia, items[], pagos[], subtotal, descuento, total, anticipoAplicado, saldoPendiente, efectivoNetoCaja, cambio, estado ('Completada'|'Anulada'|'Devuelta'), idempotencyKey }`.
   - *Justificación:* Mantener `items[]` (con dimensiones personalizadas de vidrio en `m²`, ancho, largo, piezas y costos adicionales) y `pagos[]` (pagos divididos por método) dentro del documento de la venta garantiza que el comprobante y el historial se consulten en una sola lectura atómica.
6. **`movimientos_inventario`**: `{ id, productoId, codigo, productoNombre, unidad, tipo ('Entrada'|'Salida'), origen, cantidad, stockAnterior, stockNuevo, costoUnitario, costoTotal, motivo, referenciaId, usuario, fecha }`.
7. **`movimientos_contables`**: `{ id, tipo ('Ingreso'|'Gasto'|'Traslado interno'|'Reversión'), categoria, concepto, monto, valor, fechaEfectiva, fechaRegistro, fecha, metodoPago, cuentaOrigen, cuentaDestino, afectaCajaFisica, cajaId, clienteRelacionado, pedidoRelacionado, totalPedido, saldoPendientePedido, proveedor, referencia, origen, numeroVenta, responsable, estado ('Confirmado'|'Revertido'), anulado }`.
   - *Justificación:* Unifica en un libro mayor auditable los ingresos de ventas, anticipos, gastos operativos, compras de inventario y traslados entre caja y banco, permitiendo filtrar por período y método de pago sin unir múltiples colecciones.
8. **`devoluciones`**: `{ id, ventaId, numeroVenta, fecha, motivo, itemsDevueltos[], totalDevuelto, reintegrarStock, reembolsoEfectivo, usuario }`.
9. **`auditoria`**: `{ id, accion, usuario, fecha, ...detalles }`. Bitácora inmutable de eventos sensibles.

---

## 3. Pasos Manuales para Conectar tu Proyecto en Firebase Console (Etapa 5)

Sigue exactamente estos pasos para obtener las credenciales reales de tu proyecto:

### Paso 1: Crear o abrir el proyecto en Firebase Console
1. Ingresa a **[https://console.firebase.google.com/](https://console.firebase.google.com/)** con tu cuenta de Google.
2. Haz clic en el botón **"Crear un proyecto"** (o selecciona tu proyecto si ya lo creaste).
3. Escribe el nombre: `vidrios-aluminios-el-carmen` y haz clic en **Continuar**.
4. Puedes desactivar Google Analytics (no es necesario para el sistema administrativo) y hacer clic en **"Crear proyecto"**.

### Paso 2: Registrar la aplicación Web
1. En la página principal del proyecto (*Descripción general del proyecto*), haz clic en el ícono Web **`</>`** (*Agregar app -> Web*).
2. En **"Sobrenombre de la app"**, escribe: `Sistema Web El Carmen`.
3. No marques Firebase Hosting (ya que usarás Netlify más adelante) y haz clic en **"Registrar app"**.
4. Firebase mostrará un bloque `const firebaseConfig = { ... }`. Copia los 6 valores (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`) y pégalos en [`js/firebase-config.js`](file:///c:/Users/Admin/Downloads/Sistema-de-Gesti-n-de-Caja-Inventario-y-Control-Administrativo-1/js/firebase-config.js).

### Paso 3: Habilitar Cloud Firestore
1. En el menú izquierdo de Firebase Console, entra en **Compilación -> Firestore Database**.
2. Haz clic en **"Crear base de datos"**.
3. Selecciona la ubicación más cercana (por ejemplo, `us-east1` o `southamerica-east1`) y haz clic en **Siguiente**.
4. Elige **"Comenzar en modo de producción"** y haz clic en **"Crear"**.
5. Ve a la pestaña **"Reglas"** dentro de Firestore Database, pega el contenido íntegro del archivo [`firestore.rules`](file:///c:/Users/Admin/Downloads/Sistema-de-Gesti-n-de-Caja-Inventario-y-Control-Administrativo-1/firestore.rules) de este repositorio y haz clic en **"Publicar"**.

### Paso 4: Habilitar Firebase Authentication
1. En el menú izquierdo de Firebase Console, entra en **Compilación -> Authentication**.
2. Haz clic en **"Comenzar"**.
3. En la pestaña **"Sign-in method"** (Método de acceso), selecciona **"Correo electrónico/contraseña"**, activa el primer interruptor (**Habilitar**) y haz clic en **"Guardar"**.
4. Ve a la pestaña **"Users"** (Usuarios) y haz clic en **"Añadir usuario"** para crear el correo y contraseña del Administrador (por ejemplo `admin@elcarmen.com`). Copia el `User UID` generado y crea su documento en la colección `usuarios` de Firestore con `{ uid: "<UID>", nombre: "Administrador", email: "admin@elcarmen.com", rol: "Administrador", activo: true }`.

---

## 4. Estrategia de Protección y Migración de `localStorage` (Etapa 9)

- **Ningún dato existente en `localStorage` se borra ni se migra automáticamente.**
- Para inspeccionar los registros locales antes de migrar, desde la consola del navegador o desde el servicio [`js/services/firebase-service.js`](file:///c:/Users/Admin/Downloads/Sistema-de-Gesti-n-de-Caja-Inventario-y-Control-Administrativo-1/js/services/firebase-service.js):
  1. `inspeccionarDatosLocalStorage()` devuelve el inventario exacto de claves y documentos reales frente a semillas de demostración.
  2. `generarPropuestaMigracionLocalStorage()` presenta el plan detallado por colección sin tocar la base de datos.
  3. `ejecutarMigracionAutorizadaAFirestore({ autorizadoPorUsuario: true })` transfiere únicamente los registros reales cuando el usuario lo autoriza expresamente, verificando antes cada ID en Firestore para impedir duplicados.

---

## 5. Preparación para Futuro Despliegue en Netlify (Etapa 11)

- El archivo [`netlify.toml`](file:///c:/Users/Admin/Downloads/Sistema-de-Gesti-n-de-Caja-Inventario-y-Control-Administrativo-1/netlify.toml) ya está configurado con directorio de publicación `.` (`publish = "."`), cabeceras de seguridad y redirecciones SPA.
- Cuando decidas conectar Netlify en el futuro, solo deberás configurar las variables listadas en [`.env.example`](file:///c:/Users/Admin/Downloads/Sistema-de-Gesti-n-de-Caja-Inventario-y-Control-Administrativo-1/.env.example) dentro de *Site configuration -> Environment variables*.
