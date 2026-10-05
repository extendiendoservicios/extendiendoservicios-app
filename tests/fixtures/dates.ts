// tests/fixtures/dates.ts — TEST-015/TEST-016 (P18.1)
//
// Fechas y horas relativas a "hoy" en hora de Argentina. Regla del encargo: el CI corre a
// cualquier hora; nada se arma como "ahora ± horas" (cerca de la medianoche cruza de día). Los
// turnos usan franjas FIJAS dentro del día del turno.

const ARGENTINA_TZ = 'America/Argentina/Buenos_Aires'

/** Hoy en Argentina como `YYYY-MM-DD`. */
export function todayAR(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ARGENTINA_TZ }).format(
    new Date(),
  )
}

/** Suma `days` (puede ser negativo) a una fecha `YYYY-MM-DD`, sin depender de la zona horaria. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}

/** Hoy + `days` en Argentina. */
export function daysFromToday(days: number): string {
  return addDays(todayAR(), days)
}

/** Día de la semana de una fecha `YYYY-MM-DD`: 0 = domingo ... 6 = sábado. */
export function weekdayOf(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Lunes de la semana de `isoDate` (semana de lunes a domingo, como la grilla de ADM-04). */
export function mondayOf(isoDate: string): string {
  const wd = weekdayOf(isoDate)
  return addDays(isoDate, wd === 0 ? -6 : 1 - wd)
}

/** Minutos desde las 0:00 de Argentina. */
export function minutesSinceMidnightAR(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ARGENTINA_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const hours = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minutes = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return hours * 60 + minutes
}

/**
 * `true` si la franja de HOY ya empezó en este momento (hora de Argentina). Hay estados de la
 * interfaz que solo existen antes del inicio ("Programado", "Quitar" una asignación): una prueba
 * que los afirma sobre un turno de hoy tiene que saltear esa línea cuando ya empezó (no es un
 * defecto de la app: el turno ya no es "programado"). El nocturno (04:30 de Argentina) siempre
 * las afirma.
 */
export function franjaYaEmpezo(franja: { start: string }): boolean {
  const [h, m] = franja.start.split(':').map(Number)
  return minutesSinceMidnightAR() >= h * 60 + m
}

/**
 * `true` si la franja de HOY todavía se muestra como "Programado" (o "Asignado"): la interfaz
 * pasa a "Próximo" cuando faltan 2 horas o menos para el inicio (derivado `upcoming`, `04`
 * sección 4; no es un estado) y a otro estado cuando ya empezó. Se pide un margen de 10 minutos
 * sobre las 2 horas para que la prueba no cruce el umbral mientras corre. Con la franja de la
 * tarde (14:00) vale solo hasta las 11:50 de Argentina; el nocturno (04:30) siempre la afirma.
 */
export function franjaSigueProgramada(franja: { start: string }): boolean {
  const [h, m] = franja.start.split(':').map(Number)
  return h * 60 + m - minutesSinceMidnightAR() > 130
}

/**
 * `true` en la ventana de la medianoche (6 min antes y 4 después), en la que el "hoy" de las
 * pantallas cambia durante la corrida. Los tests que dependen de "hoy" se saltean con un motivo
 * explícito en vez de inventar un reloj falso.
 */
export function isTooCloseToMidnight(): boolean {
  const since = minutesSinceMidnightAR()
  return since < 4 || since > 24 * 60 - 6
}

export const NEAR_MIDNIGHT_MESSAGE =
  'Estamos a menos de 6 minutos de la medianoche de Argentina (o recién pasada): el "hoy" de las ' +
  'pantallas cambia durante la corrida. Se saltea explícito; reintentar unos minutos más tarde.'

/**
 * Franjas fijas dentro del día del turno. Ninguna depende de la hora en que corre el test.
 * - `madrugada`: 00:00–00:01, ya terminó a cualquier hora salvo los primeros minutos del día
 *   (por eso `isTooCloseToMidnight`): sirve para "sin registro" y "en curso pasada la hora".
 * - `tarde` / `noche`: franjas de la tarde-noche que nunca se usan para afirmar que ya empezaron.
 */
export const FRANJAS = {
  madrugada: { start: '00:00', end: '00:01' },
  /** Igual que `madrugada`, pero 00:02–00:03: no se superpone con ella (otro test, mismo empleado). */
  madrugada2: { start: '00:02', end: '00:03' },
  manana: { start: '08:00', end: '12:00' },
  tarde: { start: '14:00', end: '18:00' },
  noche: { start: '20:00', end: '23:00' },
} as const
