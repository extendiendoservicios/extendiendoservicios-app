import { useId } from 'react'
import { Check, Palette } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  AGENDA_COLORS,
  RESOLVED_FILL_INDEX,
  agendaBlockStyle,
} from '../agendaColors'
import { AgendaIconButton } from './AgendaIconButton'

export interface AgendaColorValue {
  border: number | null
  fill: number | null
}

interface AgendaColorPickerProps {
  value: AgendaColorValue
  onChange: (value: AgendaColorValue) => void
  /** Texto accesible del botón que abre el selector. */
  label?: string
  disabled?: boolean
  /** Solo el ícono de la paleta, con tooltip (sin texto ni muestra). */
  iconOnly?: boolean
}

interface SwatchGroupProps {
  id: string
  title: string
  value: number | null
  onChange: (value: number | null) => void
}

/**
 * Un grupo de opciones (`radiogroup`) con las 20 muestras y «Sin color».
 * Flechas mueven y eligen, como `ClientColorPicker`.
 */
function SwatchGroup({ id, title, value, onChange }: SwatchGroupProps) {
  const last = AGENDA_COLORS.length - 1

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
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

  const focusable = value != null && value <= last ? value : 0
  return (
    <div className="flex flex-col gap-2">
      <p id={`${id}-label`} className="text-[12px] font-semibold text-text">
        {title}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        className="grid grid-cols-10 gap-1.5"
      >
        {AGENDA_COLORS.map((color) => {
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
              style={{ background: color.hex, color: color.textColor }}
              className={cn(
                'flex size-6 items-center justify-center rounded-full border border-black/20 outline-none focus-visible:ring-3 focus-visible:ring-ring max-md:size-7',
                selected && 'shadow-[0_0_0_2px_var(--dark)]',
              )}
            >
              {selected && <Check aria-hidden="true" className="size-3.5" />}
            </button>
          )
        })}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={value == null}
        onClick={() => onChange(null)}
        className={cn('self-start', value == null && 'border-dark')}
      >
        Sin color
      </Button>
    </div>
  )
}

/** Los dos grupos, «Borde» y «Relleno», con el aviso de «resuelto». */
function AgendaColorPanel({
  value,
  onChange,
}: {
  value: AgendaColorValue
  onChange: (value: AgendaColorValue) => void
}) {
  const id = useId()
  const resolved = value.fill === RESOLVED_FILL_INDEX
  return (
    <>
      <SwatchGroup
        id={`${id}-border`}
        title="Borde"
        value={value.border}
        onChange={(border) => onChange({ ...value, border })}
      />
      <SwatchGroup
        id={`${id}-fill`}
        title="Relleno"
        value={resolved ? null : value.fill}
        onChange={(fill) => onChange({ ...value, fill })}
      />
      {resolved && (
        <p className="text-[11px] text-text-3">
          Ahora está en verde porque está resuelto. Si elegís un relleno, lo
          reemplaza.
        </p>
      )}
    </>
  )
}

/**
 * Selector de colores de la Agenda (AG-11 y AG-16): un botón que abre un
 * popover con dos grupos, «Borde» y «Relleno», de 20 colores cada uno, más
 * «Sin color». Cada grupo es un `radiogroup` accesible.
 */
function AgendaColorPicker({
  value,
  onChange,
  label = 'Colores',
  disabled = false,
  iconOnly = false,
}: AgendaColorPickerProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        {iconOnly ? (
          <AgendaIconButton
            icon={Palette}
            aria-label={label}
            disabled={disabled}
          />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={label}
            title={label}
          >
            <span
              aria-hidden="true"
              className="size-4 rounded-sm border border-border-strong"
              style={agendaBlockStyle(value.border, value.fill)}
            />
            <Palette aria-hidden="true" />
            {label}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-[19rem] flex-col gap-4">
        <AgendaColorPanel value={value} onChange={onChange} />
      </PopoverContent>
    </Popover>
  )
}

/**
 * Los mismos colores en un diálogo que se abre desde afuera (por ejemplo desde
 * un menú ⋮, donde no hay un botón al que anclar el popover).
 */
function AgendaColorDialog({
  open,
  onOpenChange,
  value,
  onChange,
  title = 'Colores',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: AgendaColorValue
  onChange: (value: AgendaColorValue) => void
  title?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-4 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Elegí el borde y el relleno. Se guardan al elegirlos.
          </DialogDescription>
        </DialogHeader>
        <AgendaColorPanel value={value} onChange={onChange} />
      </DialogContent>
    </Dialog>
  )
}

export { AgendaColorPicker, AgendaColorDialog }
