import { loadTemplate } from "../template-loader.js";

// Vista: Usuarios y Seguridad (pendiente de implementar)
// Debe devolver una función de limpieza (p. ej. para cancelar onSnapshot) o nada.
export async function render(root) {
  root.innerHTML = await loadTemplate("usuarios");
}
