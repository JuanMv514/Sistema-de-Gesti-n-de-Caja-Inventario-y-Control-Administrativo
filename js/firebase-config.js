// Módulo central de configuración e inicialización de Firebase (Authentication & Cloud Firestore).
// Cumple la Sección 4:
// - Inicializa Firebase una sola vez.
// - No incluye claves privadas de administración ni cuentas de servicio.
// - No utiliza credenciales ficticias para simular conexión activa.
// - Soporta configuración inyectada en despliegue (window.__FIREBASE_CONFIG__), variables de entorno
//   y conexión opcional a Firebase Emulator Suite para pruebas locales.

const RUNTIME_ENV = (typeof window !== "undefined" && window.__FIREBASE_CONFIG__) || {};

export const firebaseConfig = {
  apiKey: RUNTIME_ENV.VITE_FIREBASE_API_KEY || RUNTIME_ENV.FIREBASE_API_KEY || "",
  authDomain: RUNTIME_ENV.VITE_FIREBASE_AUTH_DOMAIN || RUNTIME_ENV.FIREBASE_AUTH_DOMAIN || "",
  projectId: RUNTIME_ENV.VITE_FIREBASE_PROJECT_ID || RUNTIME_ENV.FIREBASE_PROJECT_ID || "",
  storageBucket: RUNTIME_ENV.VITE_FIREBASE_STORAGE_BUCKET || RUNTIME_ENV.FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: RUNTIME_ENV.VITE_FIREBASE_MESSAGING_SENDER_ID || RUNTIME_ENV.FIREBASE_MESSAGING_SENDER_ID || "",
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

export function setSimulatedNetworkOffline(isOffline) {
  simulatedOffline = Boolean(isOffline);
}

export function isNetworkOffline() {
  return simulatedOffline;
}

export function setFirebaseConfigOverride(customConfig) {
  manualConnectionOverride = customConfig;
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
    .filter(([, val]) => !val || String(val).startsWith("TU_"))
    .map(([name]) => name);
}

export function getFirebaseStatus() {
  if (simulatedOffline) {
    return {
      connected: false,
      mode: "offline-error",
      message: "Sin conexión con el servidor de datos. Verifica tu red."
    };
  }
  if (isFirebaseConfigured()) {
    return {
      connected: true,
      mode: emulatorConfig.enabled ? "emulator" : "cloud",
      projectId: getEffectiveFirebaseConfig().projectId,
      message: emulatorConfig.enabled
        ? `Conectado a Firebase Emulator Suite (${getEffectiveFirebaseConfig().projectId})`
        : `Conectado a Firebase Firestore (${getEffectiveFirebaseConfig().projectId})`
    };
  }
  return {
    connected: false,
    mode: "local-pending",
    missingVars: getMissingFirebaseEnvVars(),
    message: "Firebase todavía no está configurado · Operando en almacenamiento local de desarrollo"
  };
}

let firebaseClientsPromise = null;
let emulatorsConnected = false;

export async function getFirebaseClients() {
  if (simulatedOffline) {
    throw new Error("No fue posible conectar con Firebase: error de red.");
  }
  if (!isFirebaseConfigured()) return null;

  if (!firebaseClientsPromise) {
    firebaseClientsPromise = (async () => {
      const [{ initializeApp, getApps, getApp }, authMod, firestoreMod] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
        import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")
      ]);
      const app = getApps().length ? getApp() : initializeApp(getEffectiveFirebaseConfig());
      const auth = authMod.getAuth(app);
      const db = firestoreMod.getFirestore(app);

      if (emulatorConfig.enabled && !emulatorsConnected) {
        authMod.connectAuthEmulator(auth, emulatorConfig.authUrl, { disableWarnings: true });
        firestoreMod.connectFirestoreEmulator(db, emulatorConfig.firestoreHost, emulatorConfig.firestorePort);
        emulatorsConnected = true;
      }

      return {
        app,
        auth,
        db,
        authMod,
        firestoreMod
      };
    })();
  }
  return firebaseClientsPromise;
}
