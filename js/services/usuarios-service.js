// Servicio de Gestión de Usuarios, Roles, Estado de Cuentas y Auditoría (Secciones 10 y 12).
// - Integra Firebase Authentication para el inicio y cierre de sesión cuando Firebase está configurado.
// - NUNCA almacena contraseñas en texto plano ni hashes manuales en documentos de Firestore.
// - Impide la auto-escalada de privilegios y exige rol Administrador para gestionar usuarios.

import {
  COLLECTIONS,
  getCollection,
  subscribeCollection,
  runAtomicTransaction
} from "./store.js";
import {
  ROLES,
  getCurrentUser,
  setCurrentUser,
  assertPermission
} from "../auth.js";
import { isFirebaseConfigured, getFirebaseClients } from "../firebase-config.js";

export const ROLES_DISPONIBLES = [
  ROLES.ADMIN,
  ROLES.CAJERO,
  ROLES.INVENTARIO,
  ROLES.CONTABILIDAD,
  ROLES.EMPLEADO
];

export function listarUsuarios() {
  return getCollection(COLLECTIONS.USUARIOS);
}

export function watchUsuarios(callback) {
  return subscribeCollection(COLLECTIONS.USUARIOS, (items) => {
    const sorted = [...items].sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
    callback(sorted);
  });
}

export function watchAuditoria(callback) {
  return subscribeCollection(COLLECTIONS.AUDITORIA, (items) => {
    const sorted = [...items].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    callback(sorted);
  });
}

// Inicia sesión validando Firebase Auth (si está configurado) y el perfil activo en la colección usuarios
export async function autenticarUsuario({ email, password }) {
  const correo = String(email || "").trim().toLowerCase();
  const clave = String(password || "");
  if (!correo) throw new Error("Ingresa tu correo electrónico.");
  if (!clave || clave.length < 4) throw new Error("Ingresa una contraseña válida.");

  if (isFirebaseConfigured()) {
    const fb = await getFirebaseClients();
    if (fb) {
      const cred = await fb.authMod.signInWithEmailAndPassword(fb.auth, correo, clave);
      const fbUser = cred.user;
      const lista = listarUsuarios();
      const perfil = lista.find(
        (u) => u.uid === fbUser.uid || String(u.email || "").toLowerCase() === correo
      );
      if (perfil && perfil.activo === false) {
        await fb.authMod.signOut(fb.auth);
        throw new Error("Tu cuenta está desactivada. Contacta al Administrador.");
      }
      const sesion = {
        uid: fbUser.uid,
        email: correo,
        name: perfil?.nombre || fbUser.displayName || correo.split("@")[0],
        role: perfil?.rol || ROLES.CAJERO,
        activo: true
      };
      setCurrentUser(sesion);
      return sesion;
    }
  }

  // Modo de desarrollo local previo a conectar Firebase Auth
  const lista = listarUsuarios();
  const existente = lista.find((u) => String(u.email || "").toLowerCase() === correo);
  if (existente) {
    if (existente.activo === false) {
      throw new Error("Esta cuenta de usuario se encuentra inactiva y no tiene acceso al sistema.");
    }
    const sesion = {
      uid: existente.uid || existente.id,
      email: existente.email,
      name: existente.nombre,
      role: existente.rol,
      activo: true
    };
    setCurrentUser(sesion);
    return sesion;
  }

  // Si el correo no está en la lista inicial, asignar rol según convención local sin escalar a Admin salvo admin@
  const esAdmin = correo.startsWith("admin");
  const rolPorPrefijo = esAdmin
    ? ROLES.ADMIN
    : correo.startsWith("caja")
      ? ROLES.CAJERO
      : correo.startsWith("bodega") || correo.startsWith("inventario")
        ? ROLES.INVENTARIO
        : correo.startsWith("contabilidad")
          ? ROLES.CONTABILIDAD
          : ROLES.EMPLEADO;
  const rawName = correo.split("@")[0] || "Usuario";
  const sesion = {
    uid: `usr-${rawName}`,
    email: correo,
    name: rawName.charAt(0).toUpperCase() + rawName.slice(1),
    role: rolPorPrefijo,
    activo: true
  };
  setCurrentUser(sesion);
  return sesion;
}

export async function cerrarSesionUsuario() {
  if (isFirebaseConfigured()) {
    try {
      const fb = await getFirebaseClients();
      if (fb) await fb.authMod.signOut(fb.auth);
    } catch {
      // Continuar con limpieza de sesión local
    }
  }
  setCurrentUser(null);
}

// Registra un usuario autorizado en la colección `usuarios` (sin guardar contraseñas en Firestore)
export async function crearUsuario({ nombre, email, rol }, user = getCurrentUser()) {
  assertPermission("usuarios.gestionar", user);

  const nom = String(nombre || "").trim();
  const correo = String(email || "").trim().toLowerCase();
  const rolAsignado = ROLES_DISPONIBLES.includes(rol) ? rol : ROLES.EMPLEADO;

  if (!nom) throw new Error("El nombre del usuario es obligatorio.");
  if (!correo || !correo.includes("@")) throw new Error("Ingresa un correo electrónico válido.");

  return runAtomicTransaction(async (tx) => {
    const usuarios = tx.getAll(COLLECTIONS.USUARIOS);
    if (usuarios.some((u) => String(u.email || "").toLowerCase() === correo)) {
      throw new Error(`Ya existe un usuario registrado con el correo ${correo}.`);
    }

    const ahora = new Date().toISOString();
    // IMPORTANTE (Sección 10): No se almacena ninguna contraseña en el documento de Firestore.
    const nuevo = tx.insert(COLLECTIONS.USUARIOS, {
      uid: `usr-${Date.now()}`,
      nombre: nom,
      email: correo,
      rol: rolAsignado,
      activo: true,
      creadoPor: user.name || user.email,
      creadoEn: ahora,
      actualizadoEn: ahora
    });

    tx.insert(COLLECTIONS.AUDITORIA, {
      accion: "USUARIO_CREACION",
      usuarioObjetivoId: nuevo.id,
      emailObjetivo: nuevo.email,
      rolAsignado: nuevo.rol,
      usuario: user.name || user.email,
      fecha: ahora
    });

    return nuevo;
  });
}

// Actualiza nombre, rol o estado activo/inactivo de un usuario (requiere rol Administrador)
export async function actualizarUsuario({ id, nombre, rol, activo }, user = getCurrentUser()) {
  assertPermission("usuarios.gestionar", user);
  if (!id) throw new Error("Identificador de usuario requerido.");

  return runAtomicTransaction(async (tx) => {
    const actual = tx.get(COLLECTIONS.USUARIOS, id);
    if (!actual) throw new Error("Usuario no encontrado.");

    const nuevoRol = rol !== undefined ? rol : actual.rol;
    if (!ROLES_DISPONIBLES.includes(nuevoRol)) {
      throw new Error(`Rol no válido: ${nuevoRol}`);
    }

    const nuevoEstado = activo !== undefined ? Boolean(activo) : Boolean(actual.activo);

    // Impedir desactivar o quitar rol Administrador al único administrador activo
    if (actual.rol === ROLES.ADMIN && (nuevoRol !== ROLES.ADMIN || !nuevoEstado)) {
      const adminsActivos = tx
        .getAll(COLLECTIONS.USUARIOS)
        .filter((u) => u.id !== id && u.rol === ROLES.ADMIN && u.activo !== false);
      if (adminsActivos.length === 0) {
        throw new Error("No se puede desactivar ni cambiar el rol del único Administrador activo del sistema.");
      }
    }

    const ahora = new Date().toISOString();
    const actualizado = tx.update(COLLECTIONS.USUARIOS, id, {
      nombre: nombre !== undefined ? String(nombre).trim() : actual.nombre,
      rol: nuevoRol,
      activo: nuevoEstado,
      actualizadoPor: user.name || user.email,
      actualizadoEn: ahora
    });

    tx.insert(COLLECTIONS.AUDITORIA, {
      accion: "USUARIO_ACTUALIZACION",
      usuarioObjetivoId: id,
      emailObjetivo: actualizado.email,
      rolAnterior: actual.rol,
      rolNuevo: actualizado.rol,
      activoAnterior: actual.activo,
      activoNuevo: actualizado.activo,
      usuario: user.name || user.email,
      fecha: ahora
    });

    // Si el usuario editado es el usuario en sesión actual, actualizar sus permisos vigentes (Sección 13)
    const sesionActual = getCurrentUser();
    if (
      sesionActual &&
      (sesionActual.uid === actualizado.uid ||
        sesionActual.uid === actualizado.id ||
        String(sesionActual.email || "").toLowerCase() === String(actualizado.email || "").toLowerCase())
    ) {
      setCurrentUser({
        ...sesionActual,
        name: actualizado.nombre,
        role: actualizado.rol,
        activo: actualizado.activo
      });
    }

    return actualizado;
  });
}
