import type { SortingState } from '@tanstack/react-table'

type SortValue = string | number | null | undefined

const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' })

/**
 * Orden por el primer criterio de `sorting`, para las tablas que ordenan la
 * lista completa antes de paginarla en el cliente (`DataTable` con
 * `manualSorting`): ordenar solo la página visible confundiría. Estable (los
 * empates conservan el orden de entrada) y con los valores vacíos siempre al
 * final, en cualquier dirección. Sin criterio devuelve la lista tal cual.
 */
function sortRowsBy<T>(
  rows: T[],
  sorting: SortingState,
  accessors: Record<string, (row: T) => SortValue>,
): T[] {
  const criterion = sorting[0]
  const accessor = criterion ? accessors[criterion.id] : undefined
  if (!criterion || !accessor) {
    return rows
  }
  const direction = criterion.desc ? -1 : 1
  return rows
    .map((row, index) => ({ row, index, value: accessor(row) }))
    .sort((a, b) => {
      const aEmpty = a.value == null || a.value === ''
      const bEmpty = b.value == null || b.value === ''
      if (aEmpty || bEmpty) {
        return aEmpty === bEmpty ? a.index - b.index : aEmpty ? 1 : -1
      }
      const result =
        typeof a.value === 'number' && typeof b.value === 'number'
          ? a.value - b.value
          : collator.compare(String(a.value), String(b.value))
      return result === 0 ? a.index - b.index : result * direction
    })
    .map((item) => item.row)
}

export { sortRowsBy }
export type { SortValue }
