import { useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import {
  blockColors,
  TimeCell,
} from '@/features/employees/components/blockParts'
import type { ClientCalendarBlock } from '@/features/clients/clientCalendar'
import { DRAG_THRESHOLD_PX } from '@/features/employees/components/UncoveredPanel'

/** Color del borde según el estado (D-05): rojo sin cubrir, ámbar en curso. */
const UNCOVERED_BORDER = '#dc2626'
const IN_PROGRESS_BORDER = '#d97706'

interface ClientShiftBlockProps {
  block: ClientCalendarBlock
  /** Resalta el bloque (D-12, «N turnos sin cubrir»). */
  highlighted?: boolean
  /**
   * P34.2 (D-08): con permiso de edición las horas se editan en el lugar. En
   * P34.1 nadie lo pasa y el bloque es de solo lectura.
   */
  canEdit?: boolean
  onTimeCommit?: (
    block: ClientCalendarBlock,
    edge: 'start' | 'end',
    value: string,
  ) => void
  /**
   * P34.2 (D-09): si se pasa, el bloque se arrastra a otro día (con mouse; en
   * pantallas táctiles no hay arrastre). El bloque avisa el punto en pantalla.
   */
  drag?: {
    onMove: (block: ClientCalendarBlock, x: number, y: number) => void
    onEnd: (block: ClientCalendarBlock, x: number, y: number) => void
    onCancel: () => void
  }
  /** Mientras se arrastra, el bloque se ve atenuado. */
  dragging?: boolean
  /** P34.2 (D-10): el menú ⋮ del turno, a la derecha de la sede. */
  actions?: ReactNode
  /** En la hoja impresa la sede no es un enlace. */
  printing?: boolean
}

function blockStyle(block: ClientCalendarBlock) {
  const colors = blockColors(block.colorIndex)
  if (block.uncovered) {
    return {
      ...colors,
      borderColor: UNCOVERED_BORDER,
      borderStyle: 'dashed' as const,
    }
  }
  if (block.inProgress) {
    return { ...colors, borderColor: IN_PROGRESS_BORDER }
  }
  return colors
}

/**
 * Un turno del calendario del cliente (P34.1, D-05): horas, sede (abre el
 * turno, D-07) y quién va. Con `canEdit` las horas se editan en el lugar
 * (D-08), con `drag` se arrastra a otro día (D-09) y `actions` es el menú ⋮ (D-10).
 */
function ClientShiftBlock({
  block,
  highlighted = false,
  canEdit = false,
  onTimeCommit,
  actions,
  drag,
  dragging = false,
  printing = false,
}: ClientShiftBlockProps) {
  const origin = useRef<{ x: number; y: number; active: boolean } | null>(null)
  const justDragged = useRef(false)
  const draggable = drag != null && !printing
  const editable = canEdit && !block.cancelled && onTimeCommit != null
  const siteClassName =
    'line-clamp-2 min-w-0 flex-1 px-0.5 text-center text-[10px] leading-[14px] font-bold [overflow-wrap:anywhere]'

  return (
    <div
      data-testid="turno"
      data-shift-id={block.shiftId}
      data-uncovered={block.uncovered ? 'true' : undefined}
      data-highlighted={highlighted ? 'true' : undefined}
      className={`print-keep-together flex flex-col rounded-sm border select-none ${
        highlighted ? 'ring-2 ring-primary ring-offset-1' : ''
      } ${block.cancelled ? 'line-through opacity-60' : ''} ${
        draggable ? 'cursor-grab' : ''
      } ${dragging ? 'opacity-50' : ''}`}
      style={blockStyle(block)}
      onPointerDown={(event) => {
        // En pantallas táctiles no hay arrastre: se usa «Mover o cambiar horario…».
        if (
          !draggable ||
          event.button !== 0 ||
          event.pointerType === 'touch' ||
          (event.target as HTMLElement).closest('[data-menu]')
        ) {
          return
        }
        justDragged.current = false
        origin.current = { x: event.clientX, y: event.clientY, active: false }
      }}
      onPointerMove={(event) => {
        const state = origin.current
        if (!state || !drag) {
          return
        }
        if (
          !state.active &&
          Math.hypot(event.clientX - state.x, event.clientY - state.y) <
            DRAG_THRESHOLD_PX
        ) {
          return
        }
        if (!state.active) {
          state.active = true
          event.currentTarget.setPointerCapture?.(event.pointerId)
        }
        drag.onMove(block, event.clientX, event.clientY)
      }}
      onPointerUp={(event) => {
        const state = origin.current
        origin.current = null
        if (state?.active && drag) {
          event.currentTarget.releasePointerCapture?.(event.pointerId)
          justDragged.current = true
          setTimeout(() => {
            justDragged.current = false
          }, 0)
          drag.onEnd(block, event.clientX, event.clientY)
        }
      }}
      onPointerCancel={() => {
        if (origin.current?.active) {
          drag?.onCancel()
        }
        origin.current = null
      }}
    >
      <div className="grid grid-cols-2 gap-px">
        <TimeCell
          value={block.start}
          label={`Hora de inicio del turno de ${block.siteName}`}
          editable={editable}
          corner="left"
          suppressClick={() => justDragged.current}
          onCommit={(value) => onTimeCommit?.(block, 'start', value)}
        />
        <TimeCell
          value={block.end}
          label={`Hora de fin del turno de ${block.siteName}`}
          editable={editable && !block.openEnded}
          corner="right"
          suppressClick={() => justDragged.current}
          onCommit={(value) => onTimeCommit?.(block, 'end', value)}
        />
      </div>
      <div className="flex items-center border-t border-inherit">
        {printing ? (
          <span data-testid="sede" className={siteClassName}>
            {block.siteName}
          </span>
        ) : (
          <Link
            data-testid="sede"
            to={`/admin/turnos/${block.shiftId}`}
            aria-label={`Abrir el turno de ${block.siteName}`}
            title={block.siteName}
            className={`${siteClassName} hover:underline`}
            onClick={(event) => {
              if (justDragged.current) {
                event.preventDefault()
              }
            }}
          >
            {block.siteName}
          </Link>
        )}
        {actions && <span data-menu>{actions}</span>}
      </div>
      <div
        data-testid="personas"
        className="flex flex-col items-center gap-y-px border-t border-inherit px-0.5 text-center text-[10px] leading-[14px]"
      >
        {block.uncovered ? (
          <span className="font-bold text-danger">Sin cubrir</span>
        ) : (
          <>
            {block.people.map((person) => (
              <span
                key={person.assignmentId}
                data-testid="persona"
                className="[overflow-wrap:anywhere]"
              >
                {person.fullName}
              </span>
            ))}
            {block.missing > 0 && (
              <span className="font-bold text-danger">
                Faltan {block.missing}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export { ClientShiftBlock }
