// tests/e2e-assignments/helpers/nearDates.ts — ASSIGN-015 (P11.4)
//
// Fechas relativas a "hoy" en hora de Argentina (regla común 7: "las fechas son relativas a
// hoy"), copia liviana de `todayInBuenosAires` (`src/features/employees/employeeLeaveStatus.ts`)
// sin depender de `date-fns`: esta suite arma sus turnos de fixture con `create_shift`/inserts
// directos, nunca con `generate_shifts` (esa RPC sí abarca TODO el sistema, `06_API.md` sección
// 6 -- ver el comentario de `helpers/farDate.ts` de `tests/e2e-shifts-services`), así que no hay
// riesgo de "generar" nada ajeno por usar fechas cercanas a hoy en vez de un mes lejano: los
// turnos que arma esta suite son siempre puntuales, sobre un cliente y una sede propios y
// descartables (prefijo `E2E-P114`), y quedan aislados del resto del sistema aunque su fecha sea
// real.
//
// El mes lejano reservado para esta suite (2191, distinto de 2190 que ya reservó
// `tests/e2e-shifts-services` para no chocar si algún día corren en paralelo) se usa SOLO para
// el test de rendimiento (ASSIGN-016, `month-performance.spec.ts`): ahí sí hace falta que el mes
// completo no choque con nada real, porque arma 600 turnos de golpe con la clave de servicio.

const BUENOS_AIRES_TIME_ZONE = 'America/Argentina/Buenos_Aires'

/** `"YYYY-MM-DD"` de hoy en hora de Argentina. */
export function todayInBuenosAires(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUENOS_AIRES_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(new Date())
}

/** `"YYYY-MM-DD"` de hoy + `days` días (hora de Argentina). Acepta negativos. */
export function addDaysInBuenosAires(days: number): string {
  const today = todayInBuenosAires()
  const [year, month, day] = today.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  // Mediodía UTC: evita que un corrimiento de huso corte al día anterior/siguiente al sumar.
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Año y mes reservados para el test de rendimiento de esta suite (ASSIGN-016). */
export const FAR_PERFORMANCE_YEAR = 2191
export const FAR_PERFORMANCE_MONTH = 11
export const FAR_PERFORMANCE_VALID_FROM = '2191-11-01'
export const FAR_PERFORMANCE_VALID_TO = '2191-11-30'
