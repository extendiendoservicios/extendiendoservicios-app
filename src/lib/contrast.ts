/**
 * Alto contraste (AJ2-02, paquete G de P19.6). El tema vive en
 * `src/styles/tokens.css` bajo `:root[data-contrast='high']`; acá solo se
 * pone o saca el atributo en <html> y se recuerda el último valor en
 * `localStorage` para que `index.html` lo aplique antes de que cargue React
 * (sin parpadeo). La fuente de verdad es `profiles.high_contrast`: si difiere
 * de lo guardado, manda el perfil.
 */
export const HIGH_CONTRAST_STORAGE_KEY = 'es.highContrast'

export function applyHighContrast(enabled: boolean): void {
  const root = document.documentElement
  if (enabled) root.setAttribute('data-contrast', 'high')
  else root.removeAttribute('data-contrast')
}

export function readStoredHighContrast(): boolean {
  try {
    return localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function storeHighContrast(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(HIGH_CONTRAST_STORAGE_KEY, '1')
    else localStorage.removeItem(HIGH_CONTRAST_STORAGE_KEY)
  } catch {
    // Sin almacenamiento disponible (modo privado): el perfil igual manda.
  }
}

/** Aplica el valor y lo recuerda para la próxima apertura. */
export function setHighContrast(enabled: boolean): void {
  applyHighContrast(enabled)
  storeHighContrast(enabled)
}
