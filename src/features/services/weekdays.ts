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
