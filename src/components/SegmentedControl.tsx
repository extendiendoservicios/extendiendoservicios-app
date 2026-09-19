import * as React from 'react'
import { cn } from 'cn'

/**
 * SegmentedControl (DS-005): `07` sección 2.2, `.seg`/`.m-seg` de
 * `Mockup/assets/ds.css` y `ds2.css`. Selección única con teclado (patrón
 * ARIA `radiogroup`/`radio`, foco itinerante): flechas mueven y seleccionan,
 * Home/End van al extremo.
 *
 * `critical` (opción en rojo cuando está activa) es del mockup móvil
 * (`.m-seg span.on.crit`, para "Ausencia"); se admite también en la variante
 * de escritorio por si hace falta el mismo patrón ahí (decisión menor).
 */
export interface SegmentedOption<Value extends string> {
  value: Value
  label: string
  /** Se pinta en `--danger` cuando está seleccionada (p. ej. "Ausencia"). */
  critical?: boolean
}

interface SegmentedControlProps<Value extends string> {
  options: ReadonlyArray<SegmentedOption<Value>>
  value: Value
  onValueChange: (value: Value) => void
  /** Variante móvil: ocupa el ancho completo, opciones a partes iguales. */
  mobile?: boolean
  className?: string
  'aria-label': string
}

function SegmentedControl<Value extends string>({
  options,
  value,
  onValueChange,
  mobile = false,
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<Value>) {
  const buttonRefs = React.useRef(new Map<Value, HTMLButtonElement>())

  function focusOptionAt(index: number) {
    const option = options[index]
    if (option) {
      buttonRefs.current.get(option.value)?.focus()
    }
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | undefined
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (index + 1) % options.length
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (index - 1 + options.length) % options.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = options.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    const nextOption = options[nextIndex]
    if (nextOption) {
      onValueChange(nextOption.value)
      focusOptionAt(nextIndex)
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'gap-[2px] rounded-md bg-secondary p-[3px]',
        mobile ? 'flex w-full gap-[3px] rounded-lg' : 'inline-flex',
        className,
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            ref={(node) => {
              if (node) {
                buttonRefs.current.set(option.value, node)
              } else {
                buttonRefs.current.delete(option.value)
              }
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onValueChange(option.value)
            }}
            onKeyDown={(event) => {
              handleKeyDown(event, index)
            }}
            className={cn(
              'rounded-md text-xs font-semibold text-text-3 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring',
              mobile
                ? 'flex-1 px-0 py-[9px] text-center'
                : 'px-[13px] py-[5px]',
              selected && 'bg-surface text-text shadow-card',
              selected && option.critical && 'text-danger',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export { SegmentedControl }
