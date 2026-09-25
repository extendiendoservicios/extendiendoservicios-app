// tests/e2e-shifts-services/helpers/farDate.ts — SHIFT-012 (P10.4)
//
// "Cuidado con generate_shifts: abarca todo el sistema" (encargo P10.4). `App_dev` tiene
// servicios reales con vigencia abierta (`valid_to` nulo): generar CUALQUIER mes crea turnos
// para todos ellos también, no solo para los de esta suite. La única forma de acotar el daño es
// generar un mes tan lejano que nunca vaya a coincidir con un mes real de trabajo, reservado
// para esta suite en particular (encargo: "por ejemplo, un mes de 2190").
//
// Reglas del encargo que este archivo hace cumplir:
// - Mes fijo y lejano, siempre el mismo entre corridas (para que sea idempotente de verdad:
//   generar dos veces el mismo mes prueba SHIFT-002, generar dos meses distintos no).
// - Los servicios de fixture tienen vigencia SOLO en ese mes (`FAR_VALID_FROM`/`FAR_VALID_TO`).
// - El feriado de fixture es del mismo año lejano.
// - Las aserciones de los specs van sobre los turnos de los servicios de esta suite (filtrados
//   por `service_id` o por cliente/sede descartables), nunca sobre los contadores totales que
//   devuelve `generate_shifts` (esos si incluyen los servicios reales con vigencia abierta).

/** Año reservado para esta suite: no hay forma de que coincida con trabajo real. */
export const FAR_YEAR = 2190
/** Junio, mes fijo dentro del año reservado. */
export const FAR_MONTH = 6

/** Primer y último día del mes reservado, como vigencia de los servicios de fixture. */
export const FAR_VALID_FROM = `${FAR_YEAR}-06-01`
export const FAR_VALID_TO = `${FAR_YEAR}-06-30`

/** Feriado fijo del mes reservado, reutilizado entre corridas (`holidays.holiday_date` es
 * única en toda la tabla, también para las bajas lógicas — encargo P10.4). */
export const FAR_HOLIDAY_DATE = `${FAR_YEAR}-06-15`

/** Un día puntual del mes reservado, sin service_id, para los turnos manuales (ADM-07). */
export const FAR_PUNCTUAL_DATE = `${FAR_YEAR}-06-10`
