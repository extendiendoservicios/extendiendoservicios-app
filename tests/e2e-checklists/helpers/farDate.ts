// tests/e2e-checklists/helpers/farDate.ts — TASK-008 (P12.3, 08_Fases_y_Backlog.md F12)
//
// Año lejano reservado para esta suite (encargo P12.3: "fechas fuera de rango real, por ejemplo
// 2199"), distinto de los que ya reservan otras suites de backend real (2190 `e2e-shifts-services`,
// 2191 `e2e-assignments`): esta suite crea turnos con `create_shift` (puntual, no
// `generate_shifts`) sobre un cliente y sedes propios y descartables, así que en rigor no hace
// falta un mes lejano para evitar chocar con servicios reales de vigencia abierta (eso solo le
// pasa a `generate_shifts`) — se usa igual por seguirse el criterio explícito del encargo: fechas
// fuera de cualquier rango real de uso, para que no quede ninguna duda de que estos turnos son de
// prueba si alguien los mira en `App_dev`.
export const FAR_YEAR = 2199
export const FAR_MONTH = 4 // abril

/** Dos días puntuales del mes reservado, para los dos turnos que arma la suite. */
export const FAR_DATE_SITE_SHIFT = `${FAR_YEAR}-04-10`
export const FAR_DATE_OTHER_SITE_SHIFT = `${FAR_YEAR}-04-11`
/** Turno de fixture liviano para el spec móvil (390 px), en un tercer día del mismo mes. */
export const FAR_DATE_MOBILE_SHIFT = `${FAR_YEAR}-04-12`
