import * as React from 'react'
import { cn } from 'cn'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
// El español de react-day-picker suma las etiquetas de accesibilidad (por ejemplo «Ir al mes
// siguiente»); el de date-fns solo traduce fechas y deja esas etiquetas en inglés.
import { es as esDayPicker } from 'react-day-picker/locale'
import { CalendarIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

/**
 * DatePicker (DS-005): `07` sección 2.2, sobre `calendar` + `popover` de
 * shadcn. Español, semana empezando en lunes (`weekStartsOn={1}`, ya que el
 * locale `es` de date-fns no lo fija por si solo para `react-day-picker`).
 *
 * `clearable` (OH-12): para campos opcionales. Con fecha elegida muestra una ✕
 * en la casilla y un botón dentro del desplegable (`clearLabel`, por defecto
 * «Borrar fecha»); los dos llaman `onValueChange(undefined)`. Usarlo solo si el
 * campo es opcional.
 */
interface DatePickerProps {
  value?: Date
  onValueChange: (date: Date | undefined) => void
  placeholder?: string
  disabled?: boolean
  'aria-label'?: string
  className?: string
  /** AJ3-08: primera fecha elegible (las anteriores quedan deshabilitadas). */
  minDate?: Date
  /** AJ3-08: última fecha elegible (las posteriores quedan deshabilitadas). */
  maxDate?: Date
  /** OH-12: permite borrar la fecha elegida (solo para campos opcionales). */
  clearable?: boolean
  /** OH-12: texto del botón de borrar dentro del desplegable. Default «Borrar fecha». */
  clearLabel?: string
}

function DatePicker({
  value,
  onValueChange,
  placeholder = 'Elegí una fecha',
  disabled,
  'aria-label': ariaLabel,
  className,
  minDate,
  maxDate,
  clearable = false,
  clearLabel = 'Borrar fecha',
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)

  const showClear = clearable && value != null && !disabled

  const picker = (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          icon={CalendarIcon}
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            'w-full justify-start font-normal',
            !value && 'text-text-3',
            // Deja lugar a la ✕ para que el texto no quede debajo.
            showClear && 'pr-10',
            // Con `clearable` el ancho de `className` lo toma el contenedor.
            !clearable && className,
          )}
        >
          {value
            ? format(value, "d 'de' MMMM 'de' yyyy", { locale: es })
            : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          locale={esDayPicker}
          weekStartsOn={1}
          selected={value}
          defaultMonth={value ?? minDate}
          disabled={[
            ...(minDate ? [{ before: minDate }] : []),
            ...(maxDate ? [{ after: maxDate }] : []),
          ]}
          onSelect={(date) => {
            onValueChange(date)
            setOpen(false)
          }}
        />
        {clearable && value != null && (
          <div className="border-t border-border p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                onValueChange(undefined)
                setOpen(false)
              }}
            >
              {clearLabel}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )

  if (!clearable) {
    return picker
  }

  return (
    <div className={cn('relative w-full', className)}>
      {picker}
      {showClear && (
        <button
          type="button"
          aria-label={
            ariaLabel ? `Borrar la fecha: ${ariaLabel}` : 'Borrar la fecha'
          }
          onClick={() => onValueChange(undefined)}
          className="absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-text-3 outline-none hover:bg-bg hover:text-text-2 focus-visible:ring-3 focus-visible:ring-ring max-md:size-9"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  )
}

export { DatePicker }
