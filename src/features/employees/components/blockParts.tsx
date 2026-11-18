import { useRef, useState } from 'react'
import { TimeInput } from '@/components/TimeInput'
import { clientChipColors } from '@/features/planning/clientColors'

/**
 * Piezas compartidas por los bloques de tres casillas (inicio, fin, nombre) del
 * calendario mensual (P30.4a) y de la pizarra semanal (P30.4b).
 */

export function blockColors(colorIndex: number | null) {
  const colors = clientChipColors(colorIndex)
  return colors
    ? {
        backgroundColor: colors.background,
        color: colors.color,
        borderColor: colors.dot,
      }
    : { backgroundColor: '#e5e7eb', color: '#111827', borderColor: '#6b7280' }
}

/** Bloque de un fijo sin asignar (OH-06): borde punteado y fondo atenuado del color del cliente. */
export function gapBlockColors(colorIndex: number | null) {
  return {
    ...blockColors(colorIndex),
    backgroundImage:
      'linear-gradient(rgba(255,255,255,0.55), rgba(255,255,255,0.55))',
    borderStyle: 'dashed' as const,
  }
}

/**
 * Casilla de hora: se toca y se edita ahí mismo con `TimeInput`. Enter o salir
 * de la casilla confirman; Escape cancela y deja la hora como estaba.
 */
export function TimeCell({
  value,
  label,
  editable,
  placeholder,
  suppressClick,
  onCommit,
}: {
  value: string
  label: string
  editable: boolean
  /** Texto cuando no hay hora (por ejemplo el fin de un turno «A terminar»). */
  placeholder?: string
  /** Verdadero justo después de un arrastre: el clic que sigue no abre la edición. */
  suppressClick: () => boolean
  onCommit: (value: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const finished = useRef(false)

  function finish(confirm: boolean) {
    if (finished.current) {
      return
    }
    finished.current = true
    setEditing(false)
    if (confirm && draft !== value) {
      onCommit(draft)
    }
  }

  const className =
    'border border-neutral-500 px-0.5 text-center text-[11px] leading-4 tabular-nums'
  if (editing) {
    return (
      <TimeInput
        ref={(element) => element?.focus()}
        aria-label={label}
        value={draft}
        className="h-5 rounded-none px-0.5 py-0 text-[11px]"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            finish(true)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            finish(false)
          }
        }}
        onBlur={() => finish(true)}
      />
    )
  }
  const shown = value || placeholder || ''
  if (!editable) {
    return <span className={className}>{shown}</span>
  }
  return (
    <button
      type="button"
      aria-label={label}
      className={`${className} cursor-text hover:bg-black/10`}
      onClick={() => {
        if (suppressClick()) {
          return
        }
        finished.current = false
        setDraft(value)
        setEditing(true)
      }}
    >
      {shown}
    </button>
  )
}
