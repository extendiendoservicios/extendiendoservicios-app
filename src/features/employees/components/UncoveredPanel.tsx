import { useMemo, useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ShiftListRow } from '@/api/shifts'
import { formatShiftRange } from '@/features/shifts/openEnded'
import { formatDateOnly } from '@/features/settings/dateOnly'
import { filterUncoveredShifts } from '@/features/employees/cronogramaWeek'

/** Desde esta distancia (px) un toque o clic pasa a ser un arrastre. */
const DRAG_THRESHOLD_PX = 4
/** Valor del filtro de día que no filtra. */
const ALL_DAYS = 'todos'

export interface UncoveredDragState {
  shift: ShiftListRow
  x: number
  y: number
  over: boolean
}

// ---------------------------------------------------------------------------
// Panel de turnos sin cubrir
// ---------------------------------------------------------------------------

/**
 * Panel «Turnos sin cubrir»: con ~150 turnos en la semana no puede crecer sin
 * tope. En escritorio tiene altura máxima con scroll propio; en el celular
 * está plegado hasta que se lo abre. Filtro por texto (sede o cliente) y por
 * día de la semana.
 */
function UncoveredPanel({
  uncovered,
  days,
  personName,
  busy,
  gridRef,
  onDrag,
  onAssign,
}: {
  uncovered: ShiftListRow[]
  days: string[]
  personName: string
  busy: boolean
  gridRef: React.RefObject<HTMLDivElement | null>
  onDrag: (
    state: { shift: ShiftListRow; x: number; y: number; over: boolean } | null,
  ) => void
  onAssign: (shift: ShiftListRow) => void
}) {
  const [text, setText] = useState('')
  const [date, setDate] = useState<string>(ALL_DAYS)
  const [open, setOpen] = useState(false)
  const filtered = useMemo(
    () =>
      filterUncoveredShifts(uncovered, {
        text,
        date: date === ALL_DAYS ? null : date,
      }),
    [uncovered, text, date],
  )
  const filtering = text.trim() !== '' || date !== ALL_DAYS

  return (
    <aside
      className="w-full shrink-0 rounded-md border border-border bg-white p-3 lg:w-64"
      aria-label="Turnos sin cubrir del mes"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-bold">
          Turnos sin cubrir ({uncovered.length})
        </h3>
        <Button
          size="sm"
          variant="ghost"
          className="lg:hidden"
          aria-expanded={open}
          aria-controls="panel-sin-cubrir"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Ocultar' : 'Mostrar'}
        </Button>
      </div>
      <div
        id="panel-sin-cubrir"
        className={open ? 'mt-2 block' : 'mt-2 hidden lg:block'}
      >
        <p className="mb-2 text-[11px] text-text-2">
          Arrastrá uno al calendario para asignar a {personName}, o usá
          «Asignar».
        </p>
        {uncovered.length > 0 && (
          <div className="mb-2 flex flex-col gap-1.5">
            <Input
              aria-label="Buscar por sede o cliente"
              placeholder="Buscar por sede o cliente"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <Select value={date} onValueChange={setDate}>
              <SelectTrigger aria-label="Filtrar por día">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_DAYS}>Todos los días</SelectItem>
                {days.map((day) => (
                  <SelectItem key={day} value={day}>
                    {formatDateOnly(day)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {uncovered.length === 0 ? (
          <p className="text-[12px] text-text-2">
            No hay turnos sin cubrir este mes.
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-[12px] text-text-2">
            Ningún turno sin cubrir coincide con el filtro.
          </p>
        ) : (
          <>
            {filtering && (
              <p className="mb-1 text-[11px] text-text-2">
                {filtered.length} de {uncovered.length}
              </p>
            )}
            <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto pr-1 lg:max-h-[32rem]">
              {filtered.map((shift) => (
                <UncoveredItem
                  key={shift.id}
                  shift={shift}
                  disabled={busy}
                  gridRef={gridRef}
                  onDrag={onDrag}
                  onDrop={onAssign}
                  onAssign={() => onAssign(shift)}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  )
}

function UncoveredItem({
  shift,
  disabled,
  gridRef,
  onDrag,
  onDrop,
  onAssign,
}: {
  shift: ShiftListRow
  disabled: boolean
  gridRef: React.RefObject<HTMLDivElement | null>
  onDrag: (
    state: { shift: ShiftListRow; x: number; y: number; over: boolean } | null,
  ) => void
  onDrop: (shift: ShiftListRow) => void
  onAssign: () => void
}) {
  const state = useRef<{ x: number; y: number; active: boolean } | null>(null)

  function isOverGrid(x: number, y: number): boolean {
    const rect = gridRef.current?.getBoundingClientRect()
    return Boolean(
      rect &&
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom,
    )
  }

  return (
    <li
      data-testid="sin-cubrir"
      className="flex touch-pan-y items-start gap-1 rounded-md border border-border bg-surface p-1.5 text-[12px] select-none lg:touch-none"
      onPointerDown={(event) => {
        if (
          disabled ||
          event.button !== 0 ||
          (event.target as HTMLElement).closest('button')
        ) {
          return
        }
        // DEF-P28-03: sin esto, arrastrar con el mouse selecciona texto de la
        // página y no se ve el globo de arrastre.
        event.preventDefault()
        event.currentTarget.setPointerCapture?.(event.pointerId)
        state.current = { x: event.clientX, y: event.clientY, active: false }
      }}
      onPointerMove={(event) => {
        const start = state.current
        if (!start) {
          return
        }
        if (
          !start.active &&
          Math.hypot(event.clientX - start.x, event.clientY - start.y) <
            DRAG_THRESHOLD_PX
        ) {
          return
        }
        start.active = true
        onDrag({
          shift,
          x: event.clientX,
          y: event.clientY,
          over: isOverGrid(event.clientX, event.clientY),
        })
      }}
      onPointerUp={(event) => {
        const start = state.current
        state.current = null
        onDrag(null)
        if (start?.active && isOverGrid(event.clientX, event.clientY)) {
          onDrop(shift)
        }
      }}
      onPointerCancel={() => {
        state.current = null
        onDrag(null)
      }}
    >
      <GripVertical
        aria-hidden
        className="mt-0.5 size-3.5 shrink-0 text-text-3"
      />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {formatDateOnly(shift.shiftDate)} ·{' '}
          {formatShiftRange(shift.startTime, shift.endTime, shift.openEnded)}
        </p>
        <p className="text-text-2 [overflow-wrap:anywhere]">
          {shift.siteName} · {shift.clientName}
        </p>
        <p className="text-text-3">
          Faltan {shift.requiredStaff - shift.assignedCount}
        </p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={onAssign}
        aria-label={`Asignar el turno de ${shift.siteName} del ${formatDateOnly(shift.shiftDate)}`}
      >
        Asignar
      </Button>
    </li>
  )
}

export { DRAG_THRESHOLD_PX, UncoveredPanel }
