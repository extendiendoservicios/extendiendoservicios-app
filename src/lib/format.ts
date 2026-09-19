import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { tz } from '@date-fns/tz'

/**
 * Utilidades de formato de fecha, hora y duración (DS-017).
 *
 * Zona horaria única del negocio (ADR-019): la operación es toda en
 * Argentina y el país no tiene horario de verano, así que el desfase con
 * UTC es siempre -03:00. Todas las fechas y horas que ve una persona se
 * calculan en esta zona fija, nunca en la del dispositivo donde corre el
 * navegador (o los tests) — por eso se pasa explícitamente en cada llamado
 * a `format` en vez de depender de `Date` "local".
 *
 * Se usa `@date-fns/tz` (paquete oficial del equipo de date-fns, pensado
 * para esto desde date-fns@4) en lugar de calcular el offset a mano: la
 * zona se nombra por su identificador IANA (no por "UTC-3"), que es lo que
 * pide el ADR y lo que sigue siendo correcto si algún día cambiara la regla
 * horaria del país; y en vez de construir un `TZDate` por cada valor, se usa
 * el contexto `tz(...)` como opción `in` de `format`, que es más liviano y
 * es la forma recomendada por la propia librería a partir de la v4.
 */

/** Identificador IANA de la zona horaria del negocio (ADR-019). */
export const BUENOS_AIRES_TIME_ZONE = 'America/Argentina/Buenos_Aires'

/** Contexto de zona horaria para pasarle a las funciones de date-fns. */
const buenosAiresContext = tz(BUENOS_AIRES_TIME_ZONE)

/** Lo que puede llegar como fecha/hora desde la UI o desde la API. */
export type DateInput = Date | string | number

/**
 * Fecha corta en español de Argentina, como la pide `07_Design_System.md`
 * sección 5: `"jue 13 ago"` (día de la semana y mes abreviados, en
 * minúscula, sin punto; día del mes sin cero a la izquierda).
 */
export function formatShortDate(date: DateInput): string {
  return format(date, 'EEE d MMM', { locale: es, in: buenosAiresContext })
}

/**
 * Hora en formato 24 horas con cero a la izquierda: `"08:00"`.
 */
export function formatTime(date: DateInput): string {
  return format(date, 'HH:mm', { locale: es, in: buenosAiresContext })
}

/**
 * Minutos como texto legible: `"45 min"`, `"1 h"`, `"1 h 20 min"`.
 *
 * Sin horas cuando hay menos de 60 minutos, sin minutos cuando el resto da
 * exacto en horas. Negativos y no enteros se truncan hacia el `0` (no
 * deberían llegar: los minutos que calcula el servidor son siempre enteros
 * y no negativos).
 */
export function formatMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.trunc(totalMinutes))
  const hours = Math.trunc(minutes / 60)
  const remainingMinutes = minutes % 60

  if (hours <= 0) {
    return `${remainingMinutes} min`
  }
  if (remainingMinutes === 0) {
    return `${hours} h`
  }
  return `${hours} h ${remainingMinutes} min`
}
