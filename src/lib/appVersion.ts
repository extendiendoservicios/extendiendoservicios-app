/**
 * Versión de la app inyectada en el build desde `package.json` (ADR-020).
 * Se muestra al pie de la sidebar y de "Más" con `AppVersion` (P17.6).
 */
export const APP_VERSION = import.meta.env.VITE_APP_VERSION
