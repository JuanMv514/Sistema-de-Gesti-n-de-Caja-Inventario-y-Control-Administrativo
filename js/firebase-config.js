// Módulo central de configuración e inicialización de Firebase (Authentication & Cloud Firestore).
// Cumple las Etapas 4, 5, 6, 10 y 11:
// - Inicializa Firebase una sola vez (patrón Singleton).
// - No incluye claves privadas de administración (Admin SDK) ni cuentas de servicio.
// - No utiliza credenciales ficticias para simular que Firebase está conectado.
// - Distingue entre configuración presente y conexión verificada contra Firestore.
// - Soporta configuración inyectada en despliegue (window.__FIREBASE_CONFIG__), variables de entorno
//   y conexión a Firebase Emulator Suite para pruebas locales seguras.

const RUNTIME_ENV = (typeof window !== "undefined" && window.__FIREBASE_CONFIG__) || {};

export const firebaseConfig = {
  apiKey: RUNTIME_ENV.VITE_FIREBASE_API_KEY || RUNTIME_ENV.FIREBASE_API_KEY || "",
  authDomain: RUNTIME_ENV.VITE_FIREBASE_AUTH_DOMAIN || RUNTIME_ENV.FIREBASE_AUTH_DOMAIN || "",
  projectId: RUNTIME_ENV.VITE_FIREBASE_PROJECT_ID || RUNTIME_ENV.FIREBASE_PROJECT_ID || "",
  storageBucket: RUNTIME_ENV.VITE_FIREBASE_STORAGE_BUCKET || RUNTIME_ENV.FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId:
    RUNTIME_ENV.VITE_FIREBASE_MESSAGING_SENDER_ID || RUNTIME_ENV.FIREBASE_MESSAGING_SENDER_ID || "",
  appId: RUNTIME_ENV.VITE_FIREBASE_APP_ID || RUNTIME_ENV.FIREBASE_APP_ID || ""
};

export const emulatorConfig = {
  enabled: Boolean(RUNTIME_ENV.USE_FIREBASE_EMULATOR),
  firestoreHost: RUNTIME_ENV.FIRESTORE_EMULATOR_HOST || "127.0.0.1",
  firestorePort: Number(RUNTIME_ENV.FIRESTORE_EMULATOR_PORT || 8080),
  authUrl: RUNTIME_ENV.AUTH_EMULATOR_URL || "http://127.0.0.1:9099"
};

let simulatedOffline = false;
let manualConnectionOverride = null;
let connectionVerified = false;
let lastConnectionError = null;
let firebaseClientsPromise = null;
let emulatorsConnected = false;

export function setSimulatedNetworkOffline(isOffline) {
  simulatedOffline = Boolean(isOffline);
}

export function isNetworkOffline() {
  return simulatedOffline;
}

export function setFirebaseConfigOverride(customConfig) {
  manualConnectionOverride = customConfig;
  connectionVerified = false;
  lastConnectionError = null;
  firebaseClientsPromise = null;
}

export function setEmulatorConfig(partialConfig = {}) {
  Object.assign(emulatorConfig, partialConfig);
  firebaseClientsPromise = null;
  emulatorsConnected = false;
}

export function markFirebaseConnectionVerified(verified, errorMsg = null) {
  connectionVerified = Boolean(verified);
  lastConnectionError = errorMsg ? String(errorMsg) : null;
}

export function getEffectiveFirebaseConfig() {
  return manualConnectionOverride || firebaseConfig;
}

export function isFirebaseConfigured() {
  const cfg = getEffectiveFirebaseConfig();
  return Boolean(
    cfg &&
      cfg.apiKey &&
      !String(cfg.apiKey).startsWith("TU_") &&
      !String(cfg.apiKey).startsWith("PENDIENTE") &&
      cfg.projectId &&
      !String(cfg.projectId).startsWith("TU_") &&
      !String(cfg.projectId).startsWith("PENDIENTE")
  );
}

export function getMissingFirebaseEnvVars() {
  const cfg = getEffectiveFirebaseConfig();
  const required = [
    ["FIREBASE_API_KEY", cfg.apiKey],
    ["FIREBASE_AUTH_DOMAIN", cfg.authDomain],
    ["FIREBASE_PROJECT_ID", cfg.projectId],
    ["FIREBASE_APP_ID", cfg.appId]
  ];
  return required
    .filter(([, val]) => !val || String(val).startsWith("TU_") || String(val).startsWith("PENDIENTE"))
    .map(([name]) => name);
}

export function getFirebaseStatus() {
  if (simulatedOffline) {
    return {
      connected: false,
      configured: isFirebaseConfigured(),
      verified: false,
      mode: "offline-error",
      label: "Sin conexión de red",
      message: "Sin conexión con el servidor de datos. Verifica tu red."
    };
  }
  if (isFirebaseConfigured()) {
    const projectId = getEffectiveFirebaseConfig().projectId;
    const isEmu = Boolean(emulatorConfig.enabled);
    return {
      connected: true,
      configured: true,
      verified: connectionVerified,
      mode: isEmu ? "emulator" : "cloud",
      projectId,
      lastError: lastConnectionError,
      label: isEmu
        ? `Emulador Firebase (${projectId})`
        : `Firebase configurado (${projectId})`,
      message: isEmu
        ? `Conectado a Firebase Emulator Suite (${projectId})`
        : `Conectado a Firebase Firestore (${projectId})`
    };
  }
  return {
    connected: false,
    configured: false,
    verified: false,
    mode: "local-pending",
    missingVars: getMissingFirebaseEnvVars(),
    label: "Pendiente configurar Firebase",
    message:
      "Firebase todavía no está conectado · Operando en almacenamiento local hasta completar credenciales del proyecto en js/firebase-config.js"
  };
}

export async function getFirebaseClients() {
  if (simulatedOffline) {
    throw new Error("No fue posible conectar con Firebase: error de red.");
  }
  if (!isFirebaseConfigured()) return null;

  if (!firebaseClientsPromise) {
    firebaseClientsPromise = (async () => {
      try {
        const [{ initializeApp, getApps, getApp }, authMod, firestoreMod] = await Promise.all([
          import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
          import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
          import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")
        ]);
        const cfg = getEffectiveFirebaseConfig();
        const app = getApps().length ? getApp() : initializeApp(cfg);
        const auth = authMod.getAuth(app);
        const db = firestoreMod.getFirestore(app);

        if (emulatorConfig.enabled && !emulatorsConnected) {
          authMod.connectAuthEmulator(auth, emulatorConfig.authUrl, { disableWarnings: true });
          firestoreMod.connectFirestoreEmulator(
            db,
            emulatorConfig.firestoreHost,
            emulatorConfig.firestorePort
          );
          emulatorsConnected = true;
        }

        return {
          app,
          auth,
          db,
          authMod,
          firestoreMod
        };
      } catch (err) {
        firebaseClientsPromise = null;
        markFirebaseConnectionVerified(false, err.message);
        throw err;
      }
    })();
  }
  return firebaseClientsPromise;
}
