import * as React from 'react'
import { cn } from 'cn'
import { Check, ChevronsUpDown } from 'lucide-react'
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

/**
 * Combobox (DS-004): select con búsqueda sobre `command` + `popover`
 * (`07` sección 2.2), para elegir empleado, cliente o sede.
 */
export interface ComboboxOption<Value extends string> {
  value: Value
  label: string
}

interface ComboboxProps<Value extends string> {
  options: Array<ComboboxOption<Value>>
  value?: Value
  onValueChange: (value: Value) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  'aria-label'?: string
  className?: string
}

function Combobox<Value extends string>({
  options,
  value,
  onValueChange,
  placeholder = 'Elegí una opción',
  searchPlaceholder = 'Buscar…',
  emptyText = 'Sin resultados.',
  'aria-label': ariaLabel,
  className,
}: ComboboxProps<Value>) {
  const [open, setOpen] = React.useState(false)
  const selected = options.find((option) => option.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={cn(
            'w-full justify-between font-normal',
            !selected && 'text-text-3',
            className,
          )}
        >
          {selected ? selected.label : placeholder}
          <ChevronsUpDown aria-hidden="true" className="text-text-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-0"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  onSelect={() => {
                    onValueChange(option.value)
                    setOpen(false)
                  }}
                >
                  <Check
                    aria-hidden="true"
                    className={cn(
                      'size-4',
                      option.value === value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export { Combobox }
