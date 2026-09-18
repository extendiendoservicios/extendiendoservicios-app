import * as React from 'react'
import { cn } from 'cn'
import { format, startOfMonth } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/IconButton'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

/**
 * MonthPicker (DS-005): `07` sección 2.2. `react-day-picker` (usado por
 * `Calendar`/`DatePicker`) trabaja por día, no por mes, así que acá se arma
 * una grilla propia de 12 meses con navegación por año, en español.
 */
interface MonthPickerProps {
  /** Cualquier fecha del mes elegido; se normaliza al primer día. */
  value?: Date
  onValueChange: (date: Date) => void
  placeholder?: string
  'aria-label'?: string
  className?: string
}

function MonthPicker({
  value,
  onValueChange,
  placeholder = 'Elegí un mes',
  'aria-label': ariaLabel = 'Elegir mes',
  className,
}: MonthPickerProps) {
  const [open, setOpen] = React.useState(false)
  const [viewYear, setViewYear] = React.useState(() =>
    (value ?? new Date()).getFullYear(),
  )

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) {
      // Al abrir, la grilla vuelve a mostrar el año del valor actual (o el
      // año en curso si todavía no hay uno elegido).
      setViewYear((value ?? new Date()).getFullYear())
    }
  }

  const months = React.useMemo(
    () =>
      Array.from({ length: 12 }, (_, month) =>
        format(new Date(viewYear, month, 1), 'MMM', { locale: es }),
      ),
    [viewYear],
  )

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          icon={CalendarIcon}
          aria-label={ariaLabel}
          className={cn(
            'w-full justify-start font-normal',
            !value && 'text-text-3',
            className,
          )}
        >
          {value ? (
            <span className="capitalize">
              {format(value, 'MMMM yyyy', { locale: es })}
            </span>
          ) : (
            placeholder
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <div className="flex items-center justify-between pb-2">
          <IconButton
            icon={ChevronLeft}
            aria-label="Año anterior"
            onClick={() => {
              setViewYear((year) => year - 1)
            }}
          />
          <span className="text-sm font-semibold text-text tabular-nums">
            {viewYear}
          </span>
          <IconButton
            icon={ChevronRight}
            aria-label="Año siguiente"
            onClick={() => {
              setViewYear((year) => year + 1)
            }}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {months.map((label, index) => {
            const selected =
              value != null &&
              value.getFullYear() === viewYear &&
              value.getMonth() === index

            return (
              <button
                key={label + String(index)}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  onValueChange(startOfMonth(new Date(viewYear, index, 1)))
                  setOpen(false)
                }}
                className={cn(
                  'rounded-md px-2 py-2 text-[13px] font-medium text-text-2 capitalize outline-none transition-colors hover:bg-bg focus-visible:ring-3 focus-visible:ring-ring',
                  selected && 'bg-primary text-white hover:bg-primary',
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { MonthPicker }
