import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Estado de sesión: { uid, email, role } o null
export let currentUser = null;

export const login = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const logout = () => signOut(auth);
export const isAdmin = () => currentUser?.role === "admin";

// El rol vive en Firestore: users/{uid} -> { role: "admin" | "empleado" }
async function loadRole(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data().role : "empleado";
}

// Observador global: dicta qué se renderiza
export function watchAuth(callback) {
  onAuthStateChanged(auth, async (user) => {
    currentUser = user
      ? { uid: user.uid, email: user.email, role: await loadRole(user.uid) }
      : null;
    callback(currentUser);
  });
}

