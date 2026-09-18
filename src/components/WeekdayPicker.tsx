import { cn } from 'cn'

/**
 * WeekdayPicker (DS-005): L M M J V S D para `services.weekdays`
 * (`04_Modelo_de_Datos.md`), valor `number[]` con `0` = domingo (como en
 * PostgreSQL `extract(dow from ...)`), mostrado con la semana empezando en
 * lunes.
 */
const WEEKDAYS: ReadonlyArray<{
  value: number
  label: string
  fullLabel: string
}> = [
  { value: 1, label: 'L', fullLabel: 'Lunes' },
  { value: 2, label: 'M', fullLabel: 'Martes' },
  { value: 3, label: 'M', fullLabel: 'Miércoles' },
  { value: 4, label: 'J', fullLabel: 'Jueves' },
  { value: 5, label: 'V', fullLabel: 'Viernes' },
  { value: 6, label: 'S', fullLabel: 'Sábado' },
  { value: 0, label: 'D', fullLabel: 'Domingo' },
]

interface WeekdayPickerProps {
  /** `0`..`6`, `0` = domingo. No se asume ningún orden particular. */
  value: number[]
  onValueChange: (value: number[]) => void
  'aria-label'?: string
  className?: string
}

function WeekdayPicker({
  value,
  onValueChange,
  'aria-label': ariaLabel = 'Días de la semana',
  className,
}: WeekdayPickerProps) {
  function toggleDay(day: number) {
    const next = value.includes(day)
      ? value.filter((selectedDay) => selectedDay !== day)
      : [...value, day]
    onValueChange(next.sort((a, b) => a - b))
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('flex gap-[6px]', className)}
    >
      {WEEKDAYS.map((day) => {
        const selected = value.includes(day.value)
        return (
          <button
            key={day.value}
            type="button"
            aria-pressed={selected}
            aria-label={day.fullLabel}
            onClick={() => {
              toggleDay(day.value)
            }}
            className={cn(
              'flex size-11 items-center justify-center rounded-full border border-border-strong bg-surface text-[13px] font-semibold text-text-2 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring',
              selected && 'border-primary bg-primary text-white',
            )}
          >
            {day.label}
          </button>
        )
      })}
    </div>
  )
}

export { WeekdayPicker }
