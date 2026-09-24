/**
 * `computeNationalHolidays(year)` (USERS-014, ADM-29 "Cargar feriados
 * nacionales de <año>"): calcula, para cualquier año, la lista de feriados
 * nacionales de Argentina que `loadNationalHolidays` (`src/api/settings.ts`)
 * usa para dar de alta en `holidays`.
 *
 * `06_API.md` describe el botón como "una lista fija en el frontend,
 * PROPUESTO" -- se interpretó como "sin depender de ningún servicio externo"
 * (nada llama a una API de feriados), no como un array de fechas por año
 * escrito a mano: Argentina tiene feriados móviles (Carnaval y Semana Santa,
 * atados a la fecha de Pascua, distinta cada año) y trasladables por ley a
 * un lunes fijo (no por decreto anual), así que una tabla de fechas
 * literales quedaría vieja apenas cambiara el año o, peor, mal calculada a
 * mano para años futuros. En cambio, esta función aplica las REGLAS por las
 * que se calculan esas fechas, válidas para cualquier año — decisión menor
 * del encargo, documentada en el reporte para que el orquestador la
 * confirme con Mike si hiciera falta.
 *
 * Cobertura y límites (para que quede clara la exactitud real):
 * - Fijos (9): Año Nuevo, Día de la Memoria, Malvinas, Día del Trabajador,
 *   Revolución de Mayo, Paso a la Inmortalidad de Belgrano, Independencia,
 *   Inmaculada Concepción y Navidad -- estos NUNCA cambian de fecha.
 * - Móviles atados a Pascua (3): Carnaval (lunes y martes) y Viernes Santo,
 *   calculados con el algoritmo de Gauss para el domingo de Pascua
 *   (calendario gregoriano) -- exactos para cualquier año.
 * - Trasladables de la Ley 27.399, artículo 6 (4): Güemes (17 de junio), San
 *   Martín (17 de agosto), Diversidad Cultural (12 de octubre) y Soberanía
 *   Nacional (20 de noviembre). Martes o miércoles pasan al lunes anterior;
 *   jueves o viernes, al lunes siguiente; el resto queda en su fecha (ver
 *   `movableHoliday`). Corregido por el orquestador en P07.3: la versión
 *   anterior usaba "n-ésimo lunes del mes" y dejaba a Güemes fijo.
 * - Fuera de la lista: los "días feriados con fines turísticos" (puentes)
 *   y cualquier cambio que decrete el Gobierno para un año puntual. No son
 *   reglas fijas: el dueño los carga o corrige a mano desde la pantalla.
 */
export interface NationalHoliday {
  /** `yyyy-MM-dd`. */
  date: string
  name: string
}

function toIsoDate(year: number, month: number, day: number): string {
  const monthText = String(month).padStart(2, '0')
  const dayText = String(day).padStart(2, '0')
  return `${year}-${monthText}-${dayText}`
}

/**
 * Domingo de Pascua (calendario gregoriano), algoritmo de Gauss. Devuelve
 * `{ month, day }` (mes 1-12).
 */
function computeEasterSunday(year: number): { month: number; day: number } {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return { month, day }
}

/** Suma/resta días a una fecha (mes 1-12), sin librerías -- solo aritmética de `Date` en UTC. */
function addDays(
  year: number,
  month: number,
  day: number,
  delta: number,
): Date {
  return new Date(Date.UTC(year, month - 1, day + delta))
}

function dateToIso(date: Date): string {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + 1
  const day = date.getUTCDate()
  return toIsoDate(year, month, day)
}

/**
 * Feriado trasladable de la Ley 27.399, artículo 6: si cae martes o
 * miércoles se traslada al lunes anterior; si cae jueves o viernes, al lunes
 * siguiente; sábado, domingo y lunes quedan en su fecha. Aplica a los cuatro
 * trasladables: 17 de junio, 17 de agosto, 12 de octubre y 20 de noviembre.
 * (Revisión del orquestador en P07.3: la versión anterior usaba "n-ésimo
 * lunes del mes", que en 2025 daba mal tres de los cuatro.)
 */
function movableHoliday(year: number, month: number, day: number): string {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() // 0 = domingo
  const deltaByWeekday: Record<number, number> = { 2: -1, 3: -2, 4: 4, 5: 3 }
  return dateToIso(addDays(year, month, day, deltaByWeekday[weekday] ?? 0))
}

export function computeNationalHolidays(year: number): NationalHoliday[] {
  const easter = computeEasterSunday(year)

  const carnavalMonday = dateToIso(addDays(year, easter.month, easter.day, -48))
  const carnavalTuesday = dateToIso(
    addDays(year, easter.month, easter.day, -47),
  )
  const goodFriday = dateToIso(addDays(year, easter.month, easter.day, -2))

  return [
    { date: toIsoDate(year, 1, 1), name: 'Año Nuevo' },
    { date: carnavalMonday, name: 'Carnaval' },
    { date: carnavalTuesday, name: 'Carnaval' },
    {
      date: toIsoDate(year, 3, 24),
      name: 'Día Nacional de la Memoria por la Verdad y la Justicia',
    },
    { date: goodFriday, name: 'Viernes Santo' },
    {
      date: toIsoDate(year, 4, 2),
      name: 'Día del Veterano y de los Caídos en la Guerra de Malvinas',
    },
    { date: toIsoDate(year, 5, 1), name: 'Día del Trabajador' },
    { date: toIsoDate(year, 5, 25), name: 'Día de la Revolución de Mayo' },
    {
      date: movableHoliday(year, 6, 17),
      name: 'Paso a la Inmortalidad del General Martín Miguel de Güemes',
    },
    {
      date: toIsoDate(year, 6, 20),
      name: 'Paso a la Inmortalidad del General Manuel Belgrano',
    },
    { date: toIsoDate(year, 7, 9), name: 'Día de la Independencia' },
    {
      date: movableHoliday(year, 8, 17),
      name: 'Paso a la Inmortalidad del General José de San Martín',
    },
    {
      date: movableHoliday(year, 10, 12),
      name: 'Día del Respeto a la Diversidad Cultural',
    },
    {
      date: movableHoliday(year, 11, 20),
      name: 'Día de la Soberanía Nacional',
    },
    { date: toIsoDate(year, 12, 8), name: 'Inmaculada Concepción de María' },
    { date: toIsoDate(year, 12, 25), name: 'Navidad' },
  ].sort((a, b) => a.date.localeCompare(b.date))
}
