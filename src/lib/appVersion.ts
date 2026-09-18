/**
 * Versión de la app inyectada en el build desde `package.json` (ADR-020).
 * Se va a mostrar en el pie de la sidebar y del menú "Más" a partir de F5.
 */
export const APP_VERSION = import.meta.env.VITE_APP_VERSION
