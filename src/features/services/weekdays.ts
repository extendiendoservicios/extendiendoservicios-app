/**
 * `formatWeekdays` (SERVICE-003): arma el texto corto de los días de un
 * servicio para las listas de ADM-21 y ADM-22 -- por ejemplo "lun a vie" en
 * vez de "lun, mar, mié, jue, vie". Semana en el orden de exhibición de
 * `04_Modelo_de_Datos.md` sección 2.1 (empieza en lunes; `0` = domingo
 * queda al final).
 */

const WEEKDAY_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

const WEEKDAY_ABBREVIATIONS: Record<number, string> = {
  0: 'dom',
  1: 'lun',
  2: 'mar',
  3: 'mié',
  4: 'jue',
  5: 'vie',
  6: 'sáb',
}

/** Agrupa los días en tandas consecutivas según `WEEKDAY_DISPLAY_ORDER`. */
function groupConsecutiveWeekdays(orderedWeekdays: number[]): number[][] {
  const groups: number[][] = []
  for (const day of orderedWeekdays) {
    const currentGroup = groups.at(-1)
    const lastDayOfGroup = currentGroup?.at(-1)
    const isConsecutive =
      lastDayOfGroup != null &&
      WEEKDAY_DISPLAY_ORDER.indexOf(day) ===
        WEEKDAY_DISPLAY_ORDER.indexOf(lastDayOfGroup) + 1
    if (isConsecutive && currentGroup) {
      currentGroup.push(day)
    } else {
      groups.push([day])
    }
  }
  return groups
}

/**
 * `[1,2,3,4,5]` → `"lun a vie"`; `[0,6]` → `"dom, sáb"` (dos días sueltos no
 * consecutivos en el orden de exhibición no se combinan); los 7 días →
 * `"Todos los días"`.
 */
export function formatWeekdays(weekdays: number[]): string {
  if (weekdays.length === 7) {
    return 'Todos los días'
  }
  const ordered = WEEKDAY_DISPLAY_ORDER.filter((day) => weekdays.includes(day))
  const groups = groupConsecutiveWeekdays(ordered)
  return groups
    .map((group) =>
      group.length >= 3
        ? `${WEEKDAY_ABBREVIATIONS[group[0] as number]} a ${WEEKDAY_ABBREVIATIONS[group.at(-1) as number]}`
        : group.map((day) => WEEKDAY_ABBREVIATIONS[day]).join(', '),
    )
    .join(', ')
}

/** Texto de las semanas del mes: `[1,2]` → `"1.ª y 2.ª"`, `[5]` → `"última"`. */
function formatWeeksOfMonth(weeksOfMonth: number[]): string {
  const labels = [...weeksOfMonth]
    .sort((a, b) => a - b)
    .map((week) => (week === 5 ? 'última' : `${week}.ª`))
  if (labels.length === 1) {
    return labels[0] as string
  }
  return `${labels.slice(0, -1).join(', ')} y ${labels.at(-1)}`
}

/**
 * AJ3-05: días del servicio con su repetición mensual. Sin `weeksOfMonth`
 * (o `null`: todas las semanas) es igual a `formatWeekdays`; con semanas:
 * `"lun · 1.ª y 2.ª semana del mes"`, `"mar y jue · última semana del mes"`.
 */
export function formatServiceDays(
  weekdays: number[],
  weeksOfMonth?: number[] | null,
): string {
  const days = formatWeekdays(weekdays)
  if (!weeksOfMonth || weeksOfMonth.length === 0) {
    return days
  }
  // Para dos o tres días sueltos suena mejor "mar y jue" que "mar, jue".
  const lastComma = days.lastIndexOf(', ')
  const spoken =
    lastComma >= 0
      ? `${days.slice(0, lastComma)} y ${days.slice(lastComma + 2)}`
      : days
  return `${spoken} · ${formatWeeksOfMonth(weeksOfMonth)} semana del mes`
}
