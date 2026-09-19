import * as React from 'react'
import { cn } from 'cn'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarIcon } from 'lucide-react'
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
 */
interface DatePickerProps {
  value?: Date
  onValueChange: (date: Date | undefined) => void
  placeholder?: string
  disabled?: boolean
  'aria-label'?: string
  className?: string
}

function DatePicker({
  value,
  onValueChange,
  placeholder = 'Elegí una fecha',
  disabled,
  'aria-label': ariaLabel,
  className,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)

  return (
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
            className,
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
          locale={es}
          weekStartsOn={1}
          selected={value}
          onSelect={(date) => {
            onValueChange(date)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
