import { cn } from 'cn'
import { Minus, Plus } from 'lucide-react'
import { IconButton } from '@/components/IconButton'

/**
 * Stepper (DS-005): `− valor +` con mínimo y máximo (`07` sección 2.2,
 * `.step` de `Mockup/assets/ds2.css`). Pensado para minutos de demora u
 * otros contadores acotados.
 *
 * Accesibilidad: los botones son `IconButton` (34×34, ya con foco visible y
 * objetivo táctil ≥ 44 px lo cubre el propio botón); se deshabilitan en los
 * límites y el valor se anuncia con `aria-live` al cambiar.
 */
interface StepperProps {
  value: number
  onValueChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** Etiqueta del grupo completo, p. ej. "Minutos de demora". */
  'aria-label': string
  decrementLabel?: string
  incrementLabel?: string
  formatValue?: (value: number) => string
  className?: string
}

function Stepper({
  value,
  onValueChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  'aria-label': ariaLabel,
  decrementLabel = 'Restar',
  incrementLabel = 'Sumar',
  formatValue,
  className,
}: StepperProps) {
  const canDecrement = value - step >= min
  const canIncrement = value + step <= max

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('flex items-center gap-[11px]', className)}
    >
      <IconButton
        icon={Minus}
        aria-label={decrementLabel}
        disabled={!canDecrement}
        onClick={() => {
          onValueChange(Math.max(min, value - step))
        }}
      />
      <output
        aria-live="polite"
        className="min-w-[34px] text-center text-base font-bold text-text tabular-nums"
      >
        {formatValue ? formatValue(value) : value}
      </output>
      <IconButton
        icon={Plus}
        aria-label={incrementLabel}
        disabled={!canIncrement}
        onClick={() => {
          onValueChange(Math.min(max, value + step))
        }}
      />
    </div>
  )
}

export { Stepper }
