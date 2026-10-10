import { useState } from 'react'
import { cn } from 'cn'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { EmployeeOption } from '@/api/employees'
import {
  selectionLimitMessage,
  toggleEmployee,
} from '@/features/shifts/assignOnCreate'

/**
 * AJ2-17: selector múltiple de empleados activos, con búsqueda (por nombre o
 * legajo) y tope. Lo usan «Nuevo turno» (tope = dotación del turno) y
 * «Empleados fijos» del servicio (tope = dotación del servicio). Sobre
 * `command` + `popover` como `Combobox`, que es de uno solo.
 *
 * Al llegar al tope no se pueden sumar más (las filas quedan deshabilitadas)
 * y se avisa debajo; sacar a alguien siempre se puede.
 */
interface EmployeeMultiPickerProps {
  options: EmployeeOption[]
  value: string[]
  onValueChange: (next: string[]) => void
  /** Tope de personas (dotación pedida). */
  max: number
  loading?: boolean
  'aria-label'?: string
  placeholder?: string
  className?: string
}

function EmployeeMultiPicker({
  options,
  value,
  onValueChange,
  max,
  loading = false,
  'aria-label': ariaLabel = 'Empleados',
  placeholder = 'Elegí empleados',
  className,
}: EmployeeMultiPickerProps) {
  const [open, setOpen] = useState(false)
  const atLimit = value.length >= max
  // Un id que ya no figura entre los activos (p. ej. un fijo dado de baja) se
  // muestra igual, para poder sacarlo.
  const selected: EmployeeOption[] = loading
    ? []
    : value.map(
        (id) =>
          options.find((option) => option.profileId === id) ?? {
            profileId: id,
            name: 'Empleado que ya no está activo',
            employeeNumber: 0,
          },
      )

  function toggle(id: string) {
    const result = toggleEmployee(value, id, max)
    if (result.ok) {
      onValueChange(result.next)
    }
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel}
            className="w-full justify-between font-normal text-text-3"
          >
            {loading
              ? 'Cargando empleados…'
              : value.length === 0
                ? placeholder
                : `${value.length} de ${max} elegido${value.length === 1 ? '' : 's'}`}
            <ChevronsUpDown aria-hidden="true" className="text-text-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) p-0"
        >
          <Command>
            <CommandInput placeholder="Buscar por nombre o legajo…" />
            <CommandList>
              <CommandEmpty>Sin resultados.</CommandEmpty>
              <CommandGroup>
                {options.map((option) => {
                  const isSelected = value.includes(option.profileId)
                  return (
                    <CommandItem
                      key={option.profileId}
                      value={`${option.name} ${option.employeeNumber}`}
                      disabled={!isSelected && atLimit}
                      onSelect={() => toggle(option.profileId)}
                    >
                      <Check
                        aria-hidden="true"
                        className={cn(
                          'size-4',
                          isSelected ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {option.name}
                      </span>
                      <span className="text-[11px] text-text-3">
                        Legajo {option.employeeNumber}
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Empleados elegidos">
          {selected.map((option) => (
            <li key={option.profileId}>
              <Badge variant="neutral" className="gap-1 pr-1 text-[12px]">
                {option.name}
                <button
                  type="button"
                  aria-label={`Quitar a ${option.name}`}
                  onClick={() => toggle(option.profileId)}
                  className="rounded-full p-0.5 outline-none hover:bg-border focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}

      {atLimit && (
        <p role="status" className="text-[11px] text-text-3">
          {selectionLimitMessage(max)}
        </p>
      )}
    </div>
  )
}

export { EmployeeMultiPicker }
