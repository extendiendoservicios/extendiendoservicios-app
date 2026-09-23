import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from '@/components/IconButton'

/**
 * Selector de año para ADM-29 "Feriados" ("Lista por año", `05_Pantallas_y_
 * Navegacion.md`): a diferencia de `MonthPicker` (que elige mes dentro de un
 * año, con una grilla en un popover), acá solo hace falta moverse de a un
 * año -- un control simple de flechas alcanza, sin agregar un popover nuevo
 * para un solo número.
 */
function YearPicker({
  year,
  onYearChange,
}: {
  year: number
  onYearChange: (year: number) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <IconButton
        icon={ChevronLeft}
        aria-label="Año anterior"
        onClick={() => onYearChange(year - 1)}
      />
      <span className="min-w-12 text-center text-sm font-semibold text-text tabular-nums">
        {year}
      </span>
      <IconButton
        icon={ChevronRight}
        aria-label="Año siguiente"
        onClick={() => onYearChange(year + 1)}
      />
    </div>
  )
}

export { YearPicker }
