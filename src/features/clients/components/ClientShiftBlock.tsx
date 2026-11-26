import type { ReactNode } from 'react'
import { Link } from 'react-router'
import {
  blockColors,
  TimeCell,
} from '@/features/employees/components/blockParts'
import type { ClientCalendarBlock } from '@/features/clients/clientCalendar'

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
 * turno, D-07) y quién va. Pensado para que P34.2 le sume la edición con
 * `canEdit`, `onTimeCommit` y `actions` sin cambiar su estructura.
 */
function ClientShiftBlock({
  block,
  highlighted = false,
  canEdit = false,
  onTimeCommit,
  actions,
  printing = false,
}: ClientShiftBlockProps) {
  const editable = canEdit && !block.cancelled && onTimeCommit != null
  const names = block.people.map((person) => person.shortName).join(', ')
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
      } ${block.cancelled ? 'line-through opacity-60' : ''}`}
      style={blockStyle(block)}
    >
      <div className="grid grid-cols-2 gap-px">
        <TimeCell
          value={block.start}
          label={`Hora de inicio del turno de ${block.siteName}`}
          editable={editable}
          suppressClick={() => false}
          onCommit={(value) => onTimeCommit?.(block, 'start', value)}
        />
        <TimeCell
          value={block.end}
          label={`Hora de fin del turno de ${block.siteName}`}
          editable={editable && !block.openEnded}
          suppressClick={() => false}
          onCommit={(value) => onTimeCommit?.(block, 'end', value)}
        />
      </div>
      <div className="flex items-start border-t border-inherit">
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
          >
            {block.siteName}
          </Link>
        )}
        {actions}
      </div>
      <div
        data-testid="personas"
        className="flex flex-wrap items-center gap-x-1 border-t border-inherit px-0.5 text-[10px] leading-[14px]"
      >
        {block.uncovered ? (
          <span className="font-bold text-danger">Sin cubrir</span>
        ) : (
          <>
            {names && <span className="[overflow-wrap:anywhere]">{names}</span>}
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
