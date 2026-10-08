import { StarRating } from '@/components/StarRating'
import type { EmployeeRatingSummary } from '@/api/ratings'
import {
  formatRatingAverage,
  formatRatingsCount,
  ratingToStars,
} from '@/features/employees/ratingSummary'

/**
 * Promedio de calificaciones de un empleado (AJ-04 en el listado, AJ-05 en la
 * ficha): estrellas de solo lectura, el promedio con una decimal y la cantidad
 * de calificaciones como texto secundario. Sin calificaciones: «Sin
 * calificaciones».
 */
function RatingSummary({
  summary,
  size = 'sm',
}: {
  summary: EmployeeRatingSummary | undefined
  size?: 'sm' | 'md'
}) {
  if (!summary || summary.count === 0) {
    return <span className="text-[12px] text-text-3">Sin calificaciones</span>
  }
  return (
    <span
      className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5"
      title={`${formatRatingAverage(summary.average)} de 5 · ${formatRatingsCount(summary.count)}`}
    >
      <StarRating
        readOnly
        size={size}
        value={ratingToStars(summary.average)}
        aria-label="Promedio de calificaciones"
      />
      <span className="text-[13px] font-semibold text-text tabular-nums">
        {formatRatingAverage(summary.average)}
      </span>
      <span className="text-[11.5px] text-text-3">
        ({formatRatingsCount(summary.count)})
      </span>
    </span>
  )
}

export { RatingSummary }
