// Carga plantillas HTML desde /templates y las cachea.
const cache = new Map();

export async function loadTemplate(name) {
  if (!cache.has(name)) {
    const res = await fetch(`/templates/${name}.html`);
    if (!res.ok) throw new Error(`No se pudo cargar la plantilla "${name}"`);
    cache.set(name, await res.text());
  }
  return cache.get(name);
}
