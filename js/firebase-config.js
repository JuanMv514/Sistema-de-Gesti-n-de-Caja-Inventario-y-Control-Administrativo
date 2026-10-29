// Configuración e inicialización de Firebase (Authentication & Cloud Firestore).
// Al reemplazar las credenciales con las reales del proyecto en Firebase Console,
// todo el sistema persiste automáticamente en la nube con transacciones atómicas.

export const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  projectId: "TU_PROYECTO",
  storageBucket: "TU_PROYECTO.appspot.com",
  messagingSenderId: "TU_SENDER_ID",
  appId: "TU_APP_ID"
};

export function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.startsWith("TU_") &&
    firebaseConfig.projectId &&
    !firebaseConfig.projectId.startsWith("TU_")
  );
}

let firebaseClientsPromise = null;

export async function getFirebaseClients() {
  if (!isFirebaseConfigured()) return null;
  if (!firebaseClientsPromise) {
    firebaseClientsPromise = (async () => {
      const [{ initializeApp }, authMod, firestoreMod] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
        import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")
      ]);
      const app = initializeApp(firebaseConfig);
      return {
        app,
        auth: authMod.getAuth(app),
        db: firestoreMod.getFirestore(app),
        authMod,
        firestoreMod
      };
    })();
  }
  return firebaseClientsPromise;
}
