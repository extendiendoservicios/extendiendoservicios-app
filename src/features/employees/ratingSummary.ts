import type { EmployeeRatingSummary } from '@/api/ratings'

/**
 * Lógica sin React del promedio de calificaciones (AJ-04, AJ-05): formato
 * del número, redondeo a estrellas y orden de la columna del listado.
 */

/** Promedio con una decimal y coma, como en Argentina: `4,3`. */
export function formatRatingAverage(average: number): string {
  return average.toLocaleString('es-AR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
}

/**
 * `StarRating` de solo lectura dibuja estrellas enteras: el promedio se
 * redondea al entero más cercano (4,5 sube a 5); el número decimal al lado
 * conserva la precisión.
 */
export function ratingToStars(average: number): number {
  return Math.min(5, Math.max(1, Math.round(average)))
}

/** Texto de la cantidad de calificaciones: «1 calificación», «12 calificaciones». */
export function formatRatingsCount(count: number): string {
  return `${count} ${count === 1 ? 'calificación' : 'calificaciones'}`
}

/**
 * Valor de orden de la columna: los empleados sin calificaciones van siempre
 * al final al ordenar de mayor a menor, y al principio de menor a mayor.
 */
export function ratingSortValue(
  summary: EmployeeRatingSummary | undefined,
): number {
  return summary && summary.count > 0 ? summary.average : -1
}

/**
 * Ordena (sin mutar) por promedio; desempata por cantidad de calificaciones y
 * conserva el orden de entrada si todo empata. Se ordena la lista completa
 * antes de paginar: ordenar solo la página visible confundiría.
 */
export function sortByRating<T>(
  rows: T[],
  getSummary: (row: T) => EmployeeRatingSummary | undefined,
  direction: 'asc' | 'desc',
): T[] {
  const factor = direction === 'asc' ? 1 : -1
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const sa = getSummary(a.row)
      const sb = getSummary(b.row)
      const byAverage = ratingSortValue(sa) - ratingSortValue(sb)
      if (byAverage !== 0) {
        return byAverage * factor
      }
      const byCount = (sa?.count ?? 0) - (sb?.count ?? 0)
      if (byCount !== 0) {
        return byCount * factor
      }
      return a.index - b.index
    })
    .map(({ row }) => row)
}
