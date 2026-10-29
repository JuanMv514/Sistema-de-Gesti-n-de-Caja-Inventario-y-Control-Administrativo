// Servicio de Autenticación, Roles, Permisos y Auditoría.
// Define permisos granulares para cada operación comercial y valida en capa de negocio.

const SESSION_KEY = "elcarmen_spa_session";

export const ROLES = {
  ADMIN: "Administrador",
  EMPLEADO: "Empleado"
};

// Matriz de permisos del sistema (sección 15)
const ROLE_PERMISSIONS = {
  [ROLES.ADMIN]: new Set([
    "caja.abrir",
    "caja.cerrar",
    "caja.movimiento_efectivo",
    "caja.ver_cierres",
    "ventas.registrar",
    "ventas.consultar",
    "ventas.descuento",
    "ventas.anular",
    "ventas.devolucion",
    "clientes.crear",
    "inventario.gestionar",
    "contabilidad.gestionar",
    "reportes.ver",
    "usuarios.gestionar"
  ]),
  [ROLES.EMPLEADO]: new Set([
    "caja.abrir",
    "caja.cerrar",
    "caja.movimiento_efectivo",
    "ventas.registrar",
    "ventas.consultar",
    "clientes.crear",
    "inventario.gestionar",
    "contabilidad.gestionar"
  ])
};

export function getCurrentUser() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Ignorar error de sessionStorage
  }
  return {
    uid: "usr-admin",
    email: "admin@elcarmen.com",
    name: "Administrador",
    role: ROLES.ADMIN
  };
}

export function setCurrentUser(user) {
  try {
    if (user) sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignorar
  }
}

export function hasPermission(permission, user = getCurrentUser()) {
  if (!user || !user.role) return false;
  const set = ROLE_PERMISSIONS[user.role] || ROLE_PERMISSIONS[ROLES.EMPLEADO];
  return set.has(permission);
}

export function assertPermission(permission, user = getCurrentUser()) {
  if (!hasPermission(permission, user)) {
    throw new Error(`No tienes permisos para realizar esta acción (${permission}). Requiere autorización de Administrador.`);
  }
}
