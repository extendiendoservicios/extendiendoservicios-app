import { useRef, useState } from 'react'
import { normalizeTypedTime } from '@/features/employees/typedTime'
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
 * D-15 (P34.2): el bloque tiene `rounded-sm` y un borde de 1 px; las casillas de
 * hora redondean su esquina exterior de arriba con el radio interior (el del
 * bloque menos ese borde), para que no choquen con la curva del bloque.
 */
export type TimeCellCorner = 'left' | 'right'

export const TIME_CELL_CORNER_CLASS: Record<TimeCellCorner, string> = {
  left: 'rounded-tl-[calc(var(--radius-sm)-1px)]',
  right: 'rounded-tr-[calc(var(--radius-sm)-1px)]',
}

/** Esquina que corresponde a cada casilla de la fila (inicio a la izquierda, fin a la derecha). */
export function timeCellCornerClass(corner?: TimeCellCorner): string {
  return corner ? TIME_CELL_CORNER_CLASS[corner] : ''
}

/**
 * Casilla de hora: se toca y se edita ahí mismo. DEF-P30-05: es un campo de
 * texto (no `input type="time"`): el control nativo de hora, controlado y en una
 * casilla de ~47 px, descartaba lo escrito porque `onChange` llega con vacío
 * mientras la hora está incompleta. Se escribe «0830» o «8:30»; Enter o salir de
 * la casilla confirman; Escape cancela y deja la hora como estaba.
 */
export function TimeCell({
  value,
  label,
  editable,
  placeholder,
  corner,
  suppressClick,
  onCommit,
}: {
  value: string
  label: string
  editable: boolean
  /** Texto cuando no hay hora (por ejemplo el fin de un turno «A terminar»). */
  placeholder?: string
  /** D-15: esquina exterior de arriba que se redondea (`left` = inicio, `right` = fin). */
  corner?: TimeCellCorner
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
    const typed = normalizeTypedTime(draft)
    if (confirm && typed !== value) {
      onCommit(typed)
    }
  }

  const cornerClass = timeCellCornerClass(corner)
  const className = `min-w-0 border border-neutral-500 px-0 text-center text-[11px] leading-4 tabular-nums lg:text-[10px] xl:text-[11px] ${cornerClass}`
  if (editing) {
    return (
      <input
        ref={(element) => {
          if (element && !element.dataset.focused) {
            element.dataset.focused = '1'
            element.focus()
            element.select()
          }
        }}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={5}
        placeholder="HH:MM"
        aria-label={label}
        value={draft}
        className={`relative z-10 h-5 w-full min-w-[3.25rem] rounded-none border border-primary bg-surface px-0.5 text-center text-[11px] text-text tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring ${cornerClass}`}
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
