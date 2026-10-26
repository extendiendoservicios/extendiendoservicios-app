import { Check } from 'lucide-react'
import { cn } from 'cn'
import { CLIENT_COLORS } from '@/features/planning/clientColors'

interface ClientColorPickerProps {
  id: string
  /** Índice elegido (0–11) o `null` si todavía no se eligió (alta: lo asigna la base). */
  value: number | null
  onChange: (value: number) => void
}

/**
 * «Color en el calendario» (P24.8): las 12 muestras de la paleta como un
 * grupo de opciones (`radiogroup`), con el nombre del color como nombre
 * accesible. Flechas mueven y eligen, como `SegmentedControl`.
 */
function ClientColorPicker({ id, value, onChange }: ClientColorPickerProps) {
  function handleKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    const last = CLIENT_COLORS.length - 1
    let next: number
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = index === last ? 0 : index + 1
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = index === 0 ? last : index - 1
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = last
        break
      default:
        return
    }
    event.preventDefault()
    onChange(next)
    document.getElementById(`${id}-${next}`)?.focus()
  }

  const focusable = value ?? 0
  return (
    <div
      role="radiogroup"
      aria-labelledby={`${id}-label`}
      className="flex flex-wrap gap-2"
    >
      {CLIENT_COLORS.map((color) => {
        const selected = value === color.index
        return (
          <button
            key={color.index}
            id={`${id}-${color.index}`}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={color.name}
            title={color.name}
            tabIndex={color.index === focusable ? 0 : -1}
            onClick={() => onChange(color.index)}
            onKeyDown={(event) => handleKeyDown(event, color.index)}
            style={{ background: color.hex }}
            className={cn(
              'flex size-9 items-center justify-center rounded-full border-2 border-white text-white shadow-[0_0_0_1px_rgba(0,0,0,0.2)] outline-none focus-visible:ring-3 focus-visible:ring-ring max-md:size-11',
              selected && 'shadow-[0_0_0_3px_var(--dark)]',
            )}
          >
            {selected && <Check aria-hidden="true" className="size-4" />}
          </button>
        )
      })}
    </div>
  )
}

export { ClientColorPicker }
