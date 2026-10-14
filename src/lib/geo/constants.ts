/**
 * Valores por defecto de la validación por ubicación (módulo B1, B-02, B-06,
 * B-23). Único lugar donde viven: la base guarda los vigentes en
 * `company_settings` (`geofence_radius_m`, `geofence_max_accuracy_m`) y la app
 * los usa solo como respaldo y para pintar el mini mapa.
 */

/** Radio general de una sede, en metros (B-02). */
export const DEFAULT_GEOFENCE_RADIUS_M = 150

/** Precisión máxima para que la intersección cuente como «Validado», en metros (B-23). */
export const DEFAULT_MAX_ACCURACY_M = 150

/** Espera de «Esperar mejor señal», en milisegundos (B-06). */
export const DEFAULT_WAIT_FOR_SIGNAL_MS = 30_000

/** Radio propio de una sede: mínimo y máximo permitidos (B-02). */
export const GEOFENCE_RADIUS_MIN_M = 50
export const GEOFENCE_RADIUS_MAX_M = 1000

/** Radio medio de la Tierra, en metros. Debe coincidir con `geo_distance_m` en la base (P22.1). */
export const EARTH_RADIUS_M = 6_371_008.8
