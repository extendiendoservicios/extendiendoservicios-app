import * as React from 'react'
import { Star } from 'lucide-react'
import { cn } from 'cn'

/**
 * StarRating (MOB-SUP-001): cinco estrellas para calificar a un empleado
 * (`07` sección 2.2, SUP-05) con modo editable y modo de solo lectura (para
 * las tablas ADM-13/ADM-17).
 *
 * Accesibilidad (`07` sección 5): en modo editable es un `radiogroup` con
 * foco itinerante, igual patrón que `SegmentedControl` — flechas mueven y
 * eligen, Home/End van a los extremos —, pero sin dar la vuelta (una
 * calificación no es circular). Cada estrella tiene nombre propio ("3 de 5
 * estrellas"). Los botones son de 44×44 px como mínimo (objetivo táctil): la
 * escala de `07` sección 2.2 pedía 36 px, pero eso repetiría el problema que
 * quedó pendiente en `Stepper` durante F14, así que se corrige acá.
 * El relleno de la estrella (ícono lleno vs. contorno) no depende solo del
 * color, así que también se distingue sin él.
 */
interface StarRatingProps {
  /** Puntaje actual, de 1 a `max`. `null` cuando todavía no hay calificación. */
  value: number | null
  /** Solo se usa en modo editable (componente controlado). */
  onValueChange?: (value: number) => void
  /** Sin interacción: para mostrar un puntaje ya cargado (tablas, historial). */
  readOnly?: boolean
  disabled?: boolean
  /** Cantidad de estrellas del grupo. */
  max?: number
  /** Tamaño chico de solo lectura (ícono 16 px), para celdas de tabla densas. */
  size?: 'sm' | 'md'
  /** Etiqueta del grupo completo en modo editable, p. ej. "Calificación". */
  'aria-label'?: string
  className?: string
}

function starLabel(n: number, max: number) {
  return `${n} de ${max} estrellas`
}

function StarRating({
  value,
  onValueChange,
  readOnly = false,
  disabled = false,
  max = 5,
  size = 'md',
  'aria-label': ariaLabel,
  className,
}: StarRatingProps) {
  const stars = React.useMemo(
    () => Array.from({ length: max }, (_, i) => i + 1),
    [max],
  )
  const buttonRefs = React.useRef(new Map<number, HTMLButtonElement>())

  if (readOnly) {
    const label = value !== null ? starLabel(value, max) : 'Sin calificar'
    return (
      <div
        role="img"
        aria-label={label}
        className={cn('inline-flex items-center gap-0.5', className)}
      >
        {stars.map((n) => {
          const filled = value !== null && n <= value
          return (
            <Star
              key={n}
              aria-hidden="true"
              strokeWidth={filled ? 1.5 : 1.7}
              className={cn(
                size === 'sm' ? 'h-4 w-4' : 'h-5 w-5',
                filled
                  ? 'fill-warning text-warning'
                  : 'fill-none text-border-strong',
              )}
            />
          )
        })}
      </div>
    )
  }

  function focusStar(n: number) {
    buttonRefs.current.get(n)?.focus()
  }

  function selectStar(n: number) {
    if (disabled) return
    onValueChange?.(n)
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    n: number,
  ) {
    let next: number | undefined
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = Math.min(max, n + 1)
        break
      case 'ArrowLeft':
      case 'ArrowDown':
        next = Math.max(1, n - 1)
        break
      case 'Home':
        next = 1
        break
      case 'End':
        next = max
        break
      default:
        return
    }
    event.preventDefault()
    selectStar(next)
    focusStar(next)
  }

  // Sin calificación todavía: el primer botón es el que recibe el Tab
  // (mismo criterio que un radiogroup nativo sin ninguna opción marcada).
  const focusableStar = value ?? 1

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={cn('inline-flex items-center gap-0.5', className)}
    >
      {stars.map((n) => {
        const selected = value === n
        const filled = value !== null && n <= value
        return (
          <button
            key={n}
            ref={(node) => {
              if (node) {
                buttonRefs.current.set(n, node)
              } else {
                buttonRefs.current.delete(n)
              }
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={starLabel(n, max)}
            tabIndex={n === focusableStar ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              selectStar(n)
            }}
            onKeyDown={(event) => {
              handleKeyDown(event, n)
            }}
            className="flex h-11 w-11 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Star
              aria-hidden="true"
              strokeWidth={filled ? 1.5 : 1.7}
              className={cn(
                'h-6 w-6',
                filled
                  ? 'fill-warning text-warning'
                  : 'fill-none text-border-strong',
              )}
            />
          </button>
        )
      })}
    </div>
  )
}

export { StarRating }
