import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
  GripVertical,
  MoreVertical,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/IconButton'
import { Skeleton } from '@/components/ui/skeleton'
import { TimeInput } from '@/components/TimeInput'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { isApiError } from '@/api/errors'
import type { ShiftListRow } from '@/api/shifts'
import { clientChipColors } from '@/features/planning/clientColors'
import {
  planningKeys,
  useAssignmentsBoardRangeQuery,
  useShiftsBoardRangeQuery,
} from '@/features/planning/queries'
import { shiftsKeys } from '@/features/shifts/queries'
import { WARNING_MESSAGES } from '@/features/planning/components/AssignEmployeeSheet'
import { RemoveAssignmentDialog } from '@/features/planning/components/RemoveAssignmentDialog'
import { conflictToastOptions } from '@/features/shifts/conflictLink'
import { formatShiftRange } from '@/features/shifts/openEnded'
import {
  addDaysToIsoDate,
  formatDateOnly,
  localDateToIsoDate,
  weekdayOfIsoDate,
} from '@/features/settings/dateOnly'
import {
  runCronogramaCommand,
  type CronogramaCommand,
} from '@/features/employees/cronogramaCommands'
import {
  decideScope,
  filterUncoveredShifts,
  hasScheduleChanged,
  minutesToTime,
  moveBlock,
  previewLabel,
  resizeBlock,
  shiftDate,
  targetShiftCandidates,
  timeToMinutes,
  buildWeekBlocks,
  uncoveredShifts,
  visibleHourRange,
  wholeShiftChange,
  pxToMinutes,
  type BlockPosition,
  type ScheduleChange,
  type UndoAction,
  type WeekBlock,
} from '@/features/employees/cronogramaWeek'

/** Alto de una hora en píxeles. */
const PX_PER_HOUR = 40
/** Desde esta distancia (px) un toque o clic pasa a ser un arrastre. */
const DRAG_THRESHOLD_PX = 4
const SAME_SHIFT = '__mismo__'

/** Valor del filtro de día que no filtra. */
const ALL_DAYS = 'todos'
const WEEKDAY_SHORT = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']

/** Lunes de la semana de una fecha `YYYY-MM-DD`. */
export function mondayOfDate(isoDate: string): string {
  return addDaysToIsoDate(isoDate, -((weekdayOfIsoDate(isoDate) + 6) % 7))
}

type DragMode = 'move' | 'resize-start' | 'resize-end'

interface Preview extends BlockPosition {
  blockId: string
  mode: DragMode
}

/** Cambio de horario pendiente de que se elija «para todos» o «solo esta persona». */
interface PendingChange {
  block: WeekBlock
  next: ScheduleChange
  /** Solo cambió el horario (estirar bordes): no hay otro turno al que pasar. */
  resizeOnly: boolean
}

function describeWarnings(warnings: string[]): string {
  return warnings
    .map(
      (warning) =>
        WARNING_MESSAGES[warning as keyof typeof WARNING_MESSAGES] ?? warning,
    )
    .join(' ')
}

/**
 * Vista semana editable del cronograma (OF-10, P28.6). Arrastrar un bloque lo
 * mueve, arrastrar sus bordes cambia el horario y el panel de «turnos sin
 * cubrir» se arrastra a la grilla para asignar. Todo tiene una vía sin
 * arrastre: menú del bloque, diálogo de día y horario, botón «Asignar» y
 * teclado (flechas, Enter y Escape).
 */
function CronogramaWeekEditor({
  profileId,
  personName,
}: {
  profileId: string
  personName: string
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const openPath = (path: string) => void navigate(path)
  const [weekStart, setWeekStart] = useState(() =>
    mondayOfDate(localDateToIsoDate(new Date())),
  )
  const weekEnd = addDaysToIsoDate(weekStart, 6)
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysToIsoDate(weekStart, i)),
    [weekStart],
  )

  const assignmentsQuery = useAssignmentsBoardRangeQuery(weekStart, weekEnd, {
    employeeId: profileId,
    onlyActive: true,
  })
  const shiftsQuery = useShiftsBoardRangeQuery(weekStart, weekEnd, {})
  const allShifts = useMemo(() => shiftsQuery.data ?? [], [shiftsQuery.data])

  const blocks = useMemo(
    () => buildWeekBlocks(assignmentsQuery.data ?? [], allShifts),
    [assignmentsQuery.data, allShifts],
  )
  const uncovered = useMemo(
    () =>
      uncoveredShifts(
        allShifts,
        new Set(blocks.map((block) => block.shiftId)),
        new Date(),
      ),
    [allShifts, blocks],
  )
  const { startHour, endHour } = visibleHourRange(blocks)
  const gridStartMin = startHour * 60
  const gridHeight = (endHour - startHour) * PX_PER_HOUR

  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingChange | null>(null)
  const [moveDialog, setMoveDialog] = useState<WeekBlock | null>(null)
  const [removing, setRemoving] = useState<WeekBlock | null>(null)
  const [assignDrag, setAssignDrag] = useState<{
    shift: ShiftListRow
    x: number
    y: number
    over: boolean
  } | null>(null)

  const columnRefs = useRef<(HTMLDivElement | null)[]>([])
  const gridRef = useRef<HTMLDivElement | null>(null)

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: planningKeys.all })
    void queryClient.invalidateQueries({ queryKey: shiftsKeys.all })
  }

  async function execute(
    command: CronogramaCommand,
    block: WeekBlock | undefined,
    successMessage: string,
  ) {
    setBusy(true)
    try {
      const result = await runCronogramaCommand(command, block)
      refresh()
      const warning = describeWarnings(result.warnings)
      const options = result.undo
        ? {
            action: {
              label: 'Deshacer',
              onClick: () => void undo(result.undo as UndoAction),
            },
          }
        : undefined
      if (warning) {
        toast.warning(`${successMessage} Con advertencias: ${warning}`, options)
      } else {
        toast.success(successMessage, options)
      }
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos hacer el cambio.',
        conflictToastOptions(error, openPath),
      )
    } finally {
      setBusy(false)
    }
  }

  async function undo(action: UndoAction) {
    try {
      await runCronogramaCommand(action)
      toast.success('Deshicimos el cambio.')
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos deshacer el cambio.',
        conflictToastOptions(error, openPath),
      )
    } finally {
      refresh()
    }
  }

  /** Punto de entrada de todo cambio de horario: decide turno entero o pregunta. */
  function requestChange(
    block: WeekBlock,
    next: ScheduleChange,
    resizeOnly: boolean,
  ) {
    if (!hasScheduleChanged(block, next)) {
      return
    }
    if (decideScope(block.assignedCount) === 'whole') {
      void applyWhole(block, next)
      return
    }
    setPending({ block, next, resizeOnly })
  }

  function applyWhole(block: WeekBlock, next: ScheduleChange) {
    // DEF-P28-02: se desplaza el horario del TURNO (no se copia el del bloque,
    // que puede ser la franja propia de la persona).
    const whole = wholeShiftChange(block, next)
    return execute(
      {
        kind: 'shift_time',
        shiftId: block.shiftId,
        date: next.date,
        start: minutesToTime(whole.startMin),
        end: minutesToTime(whole.endMin),
        openEnded: block.openEnded,
        ...(whole.ownTime
          ? {
              ownTime: {
                assignmentId: block.assignmentId,
                start: minutesToTime(whole.ownTime.startMin),
                end: minutesToTime(whole.ownTime.endMin),
              },
            }
          : {}),
      },
      block,
      'Cambiamos el horario del turno.',
    )
  }

  function applyOnlyPerson(
    pendingChange: PendingChange,
    targetShiftId: string,
  ) {
    const { block, next } = pendingChange
    const start = minutesToTime(next.startMin)
    const end = minutesToTime(next.endMin)
    if (targetShiftId === SAME_SHIFT) {
      return execute(
        {
          kind: 'assignment_time',
          assignmentId: block.assignmentId,
          start,
          end,
        },
        block,
        `Cambiamos el horario de ${personName} en este turno.`,
      )
    }
    return execute(
      {
        kind: 'move',
        assignmentId: block.assignmentId,
        targetShiftId,
        start,
        end,
      },
      block,
      `Pasamos a ${personName} a otro turno.`,
    )
  }

  // ----- arrastre de bloques -------------------------------------------

  function dayIndexAt(clientX: number, fallback: number): number {
    const columns = columnRefs.current
    for (let i = 0; i < columns.length; i += 1) {
      const rect = columns[i]?.getBoundingClientRect()
      if (rect && clientX >= rect.left && clientX < rect.right) {
        return i
      }
    }
    return fallback
  }

  function previewFor(
    block: WeekBlock,
    mode: DragMode,
    deltaMinutes: number,
    dayOffset: number,
  ): Preview {
    if (mode === 'move') {
      return {
        blockId: block.assignmentId,
        mode,
        ...moveBlock(block, deltaMinutes, dayOffset),
      }
    }
    return {
      blockId: block.assignmentId,
      mode,
      dayOffset: 0,
      ...resizeBlock(
        block,
        mode === 'resize-start' ? 'start' : 'end',
        deltaMinutes,
      ),
    }
  }

  function commitPreview(block: WeekBlock, current: Preview) {
    requestChange(
      block,
      {
        date: shiftDate(block.date, current.dayOffset),
        startMin: current.startMin,
        endMin: current.endMin,
      },
      current.mode !== 'move',
    )
  }

  // ----- arrastre de turnos sin cubrir ---------------------------------

  function assignShift(shift: ShiftListRow) {
    void execute(
      { kind: 'assign', shiftId: shift.id, employeeId: profileId },
      undefined,
      `Asignamos a ${personName} al turno.`,
    )
  }

  const isLoading = assignmentsQuery.isLoading || shiftsQuery.isLoading
  const hasError = assignmentsQuery.isError || shiftsQuery.isError
  const weekLabel = `${formatDateOnly(weekStart)} al ${formatDateOnly(weekEnd)}`

  return (
    <div className="flex flex-col gap-3" data-testid="cronograma-semana">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton
          icon={ChevronLeft}
          aria-label="Semana anterior"
          variant="ghost"
          onClick={() => setWeekStart(addDaysToIsoDate(weekStart, -7))}
        />
        <span className="min-w-40 text-center text-[13px] font-semibold">
          {weekLabel}
        </span>
        <IconButton
          icon={ChevronRight}
          aria-label="Semana siguiente"
          variant="ghost"
          onClick={() => setWeekStart(addDaysToIsoDate(weekStart, 7))}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            setWeekStart(mondayOfDate(localDateToIsoDate(new Date())))
          }
        >
          Esta semana
        </Button>
      </div>
      <p className="text-[12px] text-text-2">
        Arrastrá un turno para moverlo, o sus bordes para cambiar el horario.
        También podés usar el menú del turno o el teclado (flechas, Enter y
        Escape). Cada cambio pasa por las validaciones del servidor.
      </p>

      {hasError ? (
        <p role="alert" className="text-[13px] text-danger">
          No pudimos cargar la semana. Probá de nuevo en un momento.
        </p>
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="flex flex-col gap-3 lg:flex-row">
          <div
            ref={gridRef}
            className={`min-w-0 flex-1 overflow-x-auto rounded-md border bg-white ${
              assignDrag?.over
                ? 'border-primary ring-2 ring-ring'
                : 'border-border'
            }`}
          >
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[44px_repeat(7,minmax(0,1fr))] border-b border-border text-[11px] font-semibold">
                <span />
                {days.map((date, i) => (
                  <span key={date} className="py-1 text-center">
                    {WEEKDAY_SHORT[i]} {Number(date.slice(8, 10))}
                  </span>
                ))}
              </div>
              <div
                className="grid grid-cols-[44px_repeat(7,minmax(0,1fr))]"
                style={{ height: gridHeight }}
              >
                <div className="relative text-[10px] text-text-3">
                  {Array.from({ length: endHour - startHour }, (_, i) => (
                    <span
                      key={i}
                      className="absolute right-1 -translate-y-1/2 tabular-nums"
                      style={{ top: i * PX_PER_HOUR }}
                    >
                      {String(startHour + i).padStart(2, '0')}:00
                    </span>
                  ))}
                </div>
                {days.map((date, dayIndex) => (
                  <div
                    key={date}
                    ref={(element) => {
                      columnRefs.current[dayIndex] = element
                    }}
                    data-testid={`columna-${date}`}
                    className="relative border-l border-border"
                    style={{
                      backgroundImage:
                        'linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
                      backgroundSize: `100% ${PX_PER_HOUR}px`,
                    }}
                  >
                    {blocks
                      .filter((block) => block.date === date)
                      .map((block) => (
                        <WeekBlockView
                          key={block.assignmentId}
                          block={block}
                          dayIndex={dayIndex}
                          gridStartMin={gridStartMin}
                          disabled={busy}
                          dragging={preview?.blockId === block.assignmentId}
                          weekdayLabel={formatDateOnly(date)}
                          onPreview={setPreview}
                          preview={preview}
                          previewFor={previewFor}
                          dayIndexAt={dayIndexAt}
                          onCommit={commitPreview}
                          onMoveWithMenu={() => setMoveDialog(block)}
                          onRemove={() => setRemoving(block)}
                        />
                      ))}
                    {preview && preview.mode === 'move' && (
                      <GhostBlock
                        preview={preview}
                        blocks={blocks}
                        columnIndex={dayIndex}
                        gridStartMin={gridStartMin}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <UncoveredPanel
            uncovered={uncovered}
            days={days}
            personName={personName}
            busy={busy}
            gridRef={gridRef}
            onDrag={setAssignDrag}
            onAssign={assignShift}
          />
        </div>
      )}

      {assignDrag && (
        <div
          className="pointer-events-none fixed z-50 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-white shadow-lg"
          style={{ left: assignDrag.x + 12, top: assignDrag.y + 12 }}
        >
          {assignDrag.shift.siteName}{' '}
          {formatShiftRange(
            assignDrag.shift.startTime,
            assignDrag.shift.endTime,
            assignDrag.shift.openEnded,
          )}
        </div>
      )}

      {pending && (
        <ScopeDialog
          pending={pending}
          personName={personName}
          shifts={allShifts}
          busy={busy}
          onClose={() => setPending(null)}
          onAll={() => {
            const current = pending
            setPending(null)
            void applyWhole(current.block, current.next)
          }}
          onOnlyPerson={(targetShiftId) => {
            const current = pending
            setPending(null)
            void applyOnlyPerson(current, targetShiftId)
          }}
        />
      )}

      {moveDialog && (
        <MoveDialog
          block={moveDialog}
          days={days}
          onClose={() => setMoveDialog(null)}
          onConfirm={(next) => {
            const block = moveDialog
            setMoveDialog(null)
            requestChange(block, next, false)
          }}
        />
      )}

      {removing && (
        <RemoveAssignmentDialog
          assignmentId={removing.assignmentId}
          employeeName={personName}
          open
          onOpenChange={(open) => {
            if (!open) {
              setRemoving(null)
            }
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Un bloque de la grilla
// ---------------------------------------------------------------------------

function blockStyle(block: Pick<WeekBlock, 'colorIndex'>) {
  const colors = clientChipColors(block.colorIndex)
  return colors
    ? {
        backgroundColor: colors.background,
        color: colors.color,
        borderColor: colors.dot,
      }
    : { backgroundColor: '#e5e7eb', color: '#111827', borderColor: '#6b7280' }
}

function topOf(startMin: number, gridStartMin: number): number {
  return ((startMin - gridStartMin) / 60) * PX_PER_HOUR
}

function GhostBlock({
  preview,
  blocks,
  columnIndex,
  gridStartMin,
}: {
  preview: Preview
  blocks: WeekBlock[]
  columnIndex: number
  gridStartMin: number
}) {
  const block = blocks.find((item) => item.assignmentId === preview.blockId)
  if (!block) {
    return null
  }
  const originIndex = (weekdayOfIsoDate(block.date) + 6) % 7
  if (originIndex + preview.dayOffset !== columnIndex) {
    return null
  }
  return (
    <div
      data-testid="fantasma"
      className="pointer-events-none absolute inset-x-0.5 z-20 rounded border-2 border-dashed border-primary bg-primary/10 px-1 text-[11px] font-bold text-primary"
      style={{
        top: topOf(preview.startMin, gridStartMin),
        height: ((preview.endMin - preview.startMin) / 60) * PX_PER_HOUR,
      }}
    >
      {previewLabel(preview, block.openEnded)}
    </div>
  )
}

interface WeekBlockViewProps {
  block: WeekBlock
  dayIndex: number
  gridStartMin: number
  disabled: boolean
  dragging: boolean
  weekdayLabel: string
  preview: Preview | null
  onPreview: (preview: Preview | null) => void
  previewFor: (
    block: WeekBlock,
    mode: DragMode,
    deltaMinutes: number,
    dayOffset: number,
  ) => Preview
  dayIndexAt: (clientX: number, fallback: number) => number
  onCommit: (block: WeekBlock, preview: Preview) => void
  onMoveWithMenu: () => void
  onRemove: () => void
}

function WeekBlockView({
  block,
  dayIndex,
  gridStartMin,
  disabled,
  dragging,
  weekdayLabel,
  preview,
  onPreview,
  previewFor,
  dayIndexAt,
  onCommit,
  onMoveWithMenu,
  onRemove,
}: WeekBlockViewProps) {
  const origin = useRef<{
    x: number
    y: number
    mode: DragMode
    active: boolean
  } | null>(null)

  function onPointerDown(event: React.PointerEvent, mode: DragMode) {
    if (disabled || event.button !== 0) {
      return
    }
    // Con el dedo solo se arrastra desde el asa: así el resto del bloque no
    // le quita el desplazamiento a la página.
    if (
      event.pointerType === 'touch' &&
      mode === 'move' &&
      !(event.target as HTMLElement).closest('[data-asa]')
    ) {
      return
    }
    if ((event.target as HTMLElement).closest('[data-menu]')) {
      return
    }
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    origin.current = { x: event.clientX, y: event.clientY, mode, active: false }
  }

  function onPointerMove(event: React.PointerEvent) {
    const start = origin.current
    if (!start) {
      return
    }
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (!start.active && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
      return
    }
    start.active = true
    const deltaMinutes = pxToMinutes(dy, PX_PER_HOUR)
    const target = dayIndexAt(event.clientX, dayIndex)
    onPreview(previewFor(block, start.mode, deltaMinutes, target - dayIndex))
  }

  function finish(event: React.PointerEvent, cancelled: boolean) {
    const start = origin.current
    origin.current = null
    if (!start) {
      return
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    const current = preview
    onPreview(null)
    if (!cancelled && start.active && current) {
      onCommit(block, current)
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if ((event.target as HTMLElement).closest('[data-menu]') || disabled) {
      return
    }
    const mode: DragMode = event.shiftKey ? 'resize-end' : 'move'
    const base =
      preview && preview.blockId === block.assignmentId
        ? preview
        : {
            blockId: block.assignmentId,
            mode,
            dayOffset: 0,
            startMin: block.startMin,
            endMin: block.endMin,
          }
    let next: Preview | null = null
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const delta = event.key === 'ArrowUp' ? -15 : 15
      next = event.shiftKey
        ? {
            ...base,
            mode: 'resize-end',
            ...resizeBlock(base, 'end', delta),
          }
        : { ...base, mode: 'move', ...moveBlock(base, delta, base.dayOffset) }
    } else if (
      !event.shiftKey &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) {
      const offset = base.dayOffset + (event.key === 'ArrowLeft' ? -1 : 1)
      const absolute = dayIndex + offset
      if (absolute < 0 || absolute > 6) {
        event.preventDefault()
        return
      }
      next = { ...base, mode: 'move', dayOffset: offset }
    } else if (
      event.key === 'Enter' &&
      preview?.blockId === block.assignmentId
    ) {
      event.preventDefault()
      const current = preview
      onPreview(null)
      onCommit(block, current)
      return
    } else if (
      event.key === 'Escape' &&
      preview?.blockId === block.assignmentId
    ) {
      event.preventDefault()
      onPreview(null)
      return
    }
    if (next) {
      event.preventDefault()
      onPreview(next)
    }
  }

  const shown =
    preview && preview.blockId === block.assignmentId && preview.mode !== 'move'
      ? preview
      : block
  const height = Math.max(
    ((shown.endMin - shown.startMin) / 60) * PX_PER_HOUR,
    14,
  )
  const label = `${block.siteName}, ${formatShiftRange(
    minutesToTime(block.startMin),
    minutesToTime(block.endMin),
    block.openEnded,
  )}, ${weekdayLabel}`

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${label}. Con las flechas lo movés, con Mayús y flecha arriba o abajo cambiás el fin; Enter confirma y Escape cancela.`}
      data-testid="bloque"
      data-assignment-id={block.assignmentId}
      className={`absolute inset-x-0.5 z-10 flex cursor-grab touch-pan-y flex-col overflow-hidden rounded border text-[11px] leading-tight select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
        dragging ? 'opacity-50' : ''
      }`}
      style={{
        ...blockStyle(block),
        top: topOf(shown.startMin, gridStartMin),
        height,
      }}
      onPointerDown={(event) => onPointerDown(event, 'move')}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event, false)}
      onPointerCancel={(event) => finish(event, true)}
      onKeyDown={onKeyDown}
    >
      <span
        data-testid="borde-superior"
        aria-hidden
        className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize touch-none"
        onPointerDown={(event) => onPointerDown(event, 'resize-start')}
      />
      <div className="flex items-start gap-0.5 px-0.5 pt-1">
        <span data-asa aria-hidden className="touch-none">
          <GripVertical className="size-3.5 shrink-0 opacity-70" />
        </span>
        <span className="min-w-0 flex-1 font-bold [overflow-wrap:anywhere]">
          {previewLabel(
            preview && preview.blockId === block.assignmentId ? preview : block,
            block.openEnded,
          )}
          <span className="block font-semibold">{block.siteName}</span>
        </span>
        <span data-menu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Opciones del turno de ${block.siteName}`}
                className="rounded p-0.5 hover:bg-black/10 max-md:min-h-6 max-md:min-w-6"
                disabled={disabled}
              >
                <MoreVertical className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <DropdownMenuItem onSelect={onMoveWithMenu}>
                Mover o cambiar horario…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onRemove}>
                Quitar del turno
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      {!block.openEnded && (
        <span
          data-testid="borde-inferior"
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize touch-none"
          onPointerDown={(event) => onPointerDown(event, 'resize-end')}
        />
      )}
    </div>
  )
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
      aria-label="Turnos sin cubrir de la semana"
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
          Arrastrá uno a la grilla para asignar a {personName}, o usá «Asignar».
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
            No hay turnos sin cubrir esta semana.
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

// ---------------------------------------------------------------------------
// Diálogos
// ---------------------------------------------------------------------------

function ScopeDialog({
  pending,
  personName,
  shifts,
  busy,
  onClose,
  onAll,
  onOnlyPerson,
}: {
  pending: PendingChange
  personName: string
  shifts: ShiftListRow[]
  busy: boolean
  onClose: () => void
  onAll: () => void
  onOnlyPerson: (targetShiftId: string) => void
}) {
  const { block, next, resizeOnly } = pending
  const sameDay = next.date === block.date
  const candidates = resizeOnly
    ? []
    : targetShiftCandidates(shifts, block.siteId, next.date, block.shiftId)
  const options = [
    ...(sameDay
      ? [{ value: SAME_SHIFT, label: 'Mismo turno, con horario propio' }]
      : []),
    ...candidates.map((shift) => ({
      value: shift.id,
      label: `Turno de ${formatShiftRange(shift.startTime, shift.endTime, shift.openEnded)}`,
    })),
  ]
  const [target, setTarget] = useState(options[0]?.value ?? '')

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            ¿Mover el turno para todos o pasar solo a {personName} a otro
            horario?
          </DialogTitle>
          <DialogDescription>
            El turno tiene {block.assignedCount} personas asignadas. Nuevo
            horario: {formatDateOnly(next.date)}{' '}
            {previewLabel(next, block.openEnded)}.
          </DialogDescription>
        </DialogHeader>
        {options.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="destino-solo">Si pasás solo a {personName}</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger id="destino-solo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <p className="text-[12px] text-text-2">
            No hay otro turno de esa sede ese día al que pasar solo a{' '}
            {personName}. Podés mover el turno para todos o crear antes el turno
            en Turnos.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="dark" onClick={onAll} disabled={busy}>
            Mover para todos
          </Button>
          <Button
            onClick={() => onOnlyPerson(target)}
            disabled={busy || options.length === 0 || !target}
          >
            Solo a {personName}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Vía accesible sin arrastre: elegir día y horario en un diálogo. */
function MoveDialog({
  block,
  days,
  onClose,
  onConfirm,
}: {
  block: WeekBlock
  days: string[]
  onClose: () => void
  onConfirm: (next: ScheduleChange) => void
}) {
  const [date, setDate] = useState(block.date)
  const [start, setStart] = useState(minutesToTime(block.startMin))
  const [end, setEnd] = useState(minutesToTime(block.endMin))
  const valid =
    start !== '' && end !== '' && timeToMinutes(end) > timeToMinutes(start)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mover o cambiar horario</DialogTitle>
          <DialogDescription>
            {block.siteName}. Elegí el día y el horario nuevos.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mover-dia">Día</Label>
            <Select value={date} onValueChange={setDate}>
              <SelectTrigger id="mover-dia">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {days.map((day) => (
                  <SelectItem key={day} value={day}>
                    {formatDateOnly(day)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mover-inicio">Desde</Label>
              <TimeInput
                id="mover-inicio"
                step={900}
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mover-fin">Hasta</Label>
              <TimeInput
                id="mover-fin"
                step={900}
                value={end}
                disabled={block.openEnded}
                onChange={(event) => setEnd(event.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!valid}
            onClick={() =>
              onConfirm({
                date,
                startMin: timeToMinutes(start),
                endMin: block.openEnded
                  ? timeToMinutes(start) + (block.endMin - block.startMin)
                  : timeToMinutes(end),
              })
            }
          >
            Mover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { CronogramaWeekEditor }
