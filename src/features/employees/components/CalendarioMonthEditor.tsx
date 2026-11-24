import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { MoreVertical, Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { isApiError } from '@/api/errors'
import type { FixedGap } from '@/api/employeeFixed'
import type { CalendarNote } from '@/api/employeeCalendarNotes'
import { useAuth } from '@/features/auth/AuthProvider'
import type { ShiftListRow } from '@/api/shifts'
import {
  planningKeys,
  useAssignEmployeeMutation,
} from '@/features/planning/queries'
import { groupGapsByDate } from '@/features/employees/fixedGaps'
import { groupNotesByDate } from '@/features/employees/calendarNotes'
import { shiftsKeys } from '@/features/shifts/queries'
import { WARNING_MESSAGES } from '@/features/planning/components/AssignEmployeeSheet'
import { RemoveAssignmentDialog } from '@/features/planning/components/RemoveAssignmentDialog'
import { conflictToastOptions } from '@/features/shifts/conflictLink'
import { formatShiftRange } from '@/features/shifts/openEnded'
import { formatDateOnly } from '@/features/settings/dateOnly'
import {
  applyTimeEdit,
  dateAtPoint,
  moveToDate,
  monthDates,
  type DayRect,
} from '@/features/employees/calendarioMonth'
import {
  runCronogramaCommand,
  type CronogramaCommand,
} from '@/features/employees/cronogramaCommands'
import {
  COMPLETED_DATE_MESSAGE,
  completedDateChangeBlocked,
  decideScope,
  hasScheduleChanged,
  minutesToTime,
  uncoveredShifts,
  wholeShiftChange,
  type ScheduleChange,
  type UndoAction,
  type WeekBlock,
} from '@/features/employees/cronogramaWeek'
import {
  CRONOGRAMA_WEEKDAYS,
  type CronogramaDay,
  type CronogramaMonth,
} from '@/features/employees/cronograma'
import {
  MoveDialog,
  NEW_SHIFT,
  SAME_SHIFT,
  ScopeDialog,
  type PendingChange,
} from './CalendarioDialogs'
import { blockColors, TimeCell } from './blockParts'
import { FixedGapBlock, GapReplaceSheet } from './FixedGapBlock'
import {
  CalendarNoteCell,
  CalendarNoteDialog,
  DeleteCalendarNoteDialog,
} from './CalendarNoteParts'
import {
  ClientColorConfirmDialog,
  ClientColorSubmenu,
  type ClientColorRequest,
} from '@/features/planning/components/ClientColorChange'
import { OwnerDeleteDialog } from '@/features/ownerDelete/components/OwnerDeleteDialog'
import { canOwnerDelete } from '@/features/ownerDelete/matching'
import {
  DRAG_THRESHOLD_PX,
  UncoveredPanel,
  type UncoveredDragState,
} from './UncoveredPanel'

/** Advertencias de la creación de un turno (OF-23). */
/** Duración de los avisos con «Deshacer» (DEF-P30-08). */
export const UNDO_TOAST_DURATION_MS = 10_000

const SHIFT_WARNING_MESSAGES: Record<string, string> = {
  HOLIDAY: 'La fecha del turno nuevo es feriado.',
}

function describeWarnings(warnings: string[]): string {
  return warnings
    .map(
      (warning) =>
        WARNING_MESSAGES[warning as keyof typeof WARNING_MESSAGES] ??
        SHIFT_WARNING_MESSAGES[warning] ??
        warning,
    )
    .join(' ')
}

// ---------------------------------------------------------------------------
// Un turno: bloque de tres casillas
// ---------------------------------------------------------------------------

interface MonthBlockProps {
  block: WeekBlock
  siteLabel: string
  start: string
  end: string
  canEdit: boolean
  disabled: boolean
  dragging: boolean
  onDragMove: (block: WeekBlock, x: number, y: number) => void
  onDragEnd: (block: WeekBlock, x: number, y: number) => void
  onDragCancel: () => void
  onTimeCommit: (block: WeekBlock, edge: 'start' | 'end', value: string) => void
  onOpenShift: (block: WeekBlock) => void
  onMove: (block: WeekBlock) => void
  onRemove: (block: WeekBlock) => void
  /** D-05: pide cambiar el color del cliente (abre la confirmación). */
  onColorRequest: (request: ClientColorRequest) => void
  /** D-06: «Eliminar turno», solo la dirección (OD-22). */
  canDelete: boolean
  onDelete: (block: WeekBlock) => void
}

function MonthBlock({
  block,
  siteLabel,
  start,
  end,
  canEdit,
  disabled,
  dragging,
  onDragMove,
  onDragEnd,
  onDragCancel,
  onTimeCommit,
  onOpenShift,
  onMove,
  onRemove,
  onColorRequest,
  canDelete,
  onDelete,
}: MonthBlockProps) {
  const origin = useRef<{ x: number; y: number; active: boolean } | null>(null)
  const justDragged = useRef(false)
  const colors = blockColors(block.colorIndex)
  const interactive = canEdit && !disabled

  function suppressClick(): boolean {
    return justDragged.current
  }

  return (
    <div
      data-testid="turno"
      data-assignment-id={block.assignmentId}
      className={`print-keep-together flex flex-col rounded-sm border select-none ${
        interactive ? 'cursor-grab' : ''
      } ${dragging ? 'opacity-50' : ''}`}
      style={colors}
      onPointerDown={(event) => {
        // En pantallas táctiles no hay arrastre: los cambios se hacen tocando.
        if (
          !interactive ||
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
        if (!state) {
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
        onDragMove(block, event.clientX, event.clientY)
      }}
      onPointerUp={(event) => {
        const state = origin.current
        origin.current = null
        if (state?.active) {
          event.currentTarget.releasePointerCapture?.(event.pointerId)
          justDragged.current = true
          setTimeout(() => {
            justDragged.current = false
          }, 0)
          onDragEnd(block, event.clientX, event.clientY)
        }
      }}
      onPointerCancel={() => {
        if (origin.current?.active) {
          onDragCancel()
        }
        origin.current = null
      }}
    >
      <div className="grid grid-cols-2 gap-px">
        <TimeCell
          value={start}
          label={`Hora de inicio del turno de ${siteLabel}`}
          editable={interactive}
          suppressClick={suppressClick}
          onCommit={(value) => onTimeCommit(block, 'start', value)}
        />
        <TimeCell
          value={end}
          label={`Hora de fin del turno de ${siteLabel}`}
          editable={interactive && !block.openEnded}
          suppressClick={suppressClick}
          onCommit={(value) => onTimeCommit(block, 'end', value)}
        />
      </div>
      <div className="flex items-start border-t border-inherit">
        {canEdit ? (
          <button
            type="button"
            data-testid="sede"
            aria-label={`Abrir el turno de ${siteLabel}`}
            title={siteLabel}
            className="line-clamp-2 min-w-0 flex-1 px-0.5 text-center text-[10px] leading-[14px] font-bold [overflow-wrap:anywhere] hover:underline"
            onClick={() => {
              if (!suppressClick()) {
                onOpenShift(block)
              }
            }}
          >
            {siteLabel}
          </button>
        ) : (
          <span
            data-testid="sede"
            title={siteLabel}
            className="line-clamp-2 min-w-0 flex-1 px-0.5 text-center text-[10px] leading-[14px] font-bold [overflow-wrap:anywhere]"
          >
            {siteLabel}
          </span>
        )}
        {canEdit && (
          <span data-menu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Opciones del turno de ${siteLabel}`}
                  className="rounded p-0.5 hover:bg-black/10 max-md:min-h-6 max-md:min-w-6"
                  disabled={disabled}
                >
                  <MoreVertical className="size-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onOpenShift(block)}>
                  Abrir el turno
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onMove(block)}>
                  Mover o cambiar horario…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onRemove(block)}>
                  Quitar de este turno
                </DropdownMenuItem>
                <ClientColorSubmenu
                  clientId={block.clientId}
                  clientName={block.clientName}
                  currentIndex={block.colorIndex}
                  onRequest={onColorRequest}
                />
                {canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => onDelete(block)}
                    >
                      Eliminar turno
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Calendario mensual editable
// ---------------------------------------------------------------------------

/**
 * Calendario mensual editable del empleado (OH-05, P30.4a). La misma hoja en
 * papel de la empresa, pero cada turno es un bloque de tres casillas que se
 * edita: la hora de inicio y fin en el lugar, el cliente abre el turno, el
 * bloque se arrastra a otro día (mismo horario) y el panel de «turnos sin
 * cubrir» del mes se arrastra al calendario para asignar. Todo cambio pasa
 * por las mismas reglas de alcance y los mismos RPC que usaba la semana (OF-10,
 * OF-23) y tiene «Deshacer». Con `canEdit` en falso es solo lectura.
 */
function CalendarioMonthEditor({
  profileId,
  personName,
  month,
  blocks,
  allShifts,
  canEdit,
  gaps = [],
  notes,
}: {
  profileId: string
  personName: string
  month: CronogramaMonth
  blocks: WeekBlock[]
  allShifts: ShiftListRow[]
  canEdit: boolean
  /** Fijos sin asignar del mes (OH-06); se dibujan con borde punteado. */
  gaps?: FixedGap[]
  /**
   * D-08: observaciones del mes. Si viene (aunque sea vacío) se muestran con el
   * botón «+» en cada día; quien no las puede ver no la pasa.
   */
  notes?: CalendarNote[]
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // Borrar turnos es solo de la dirección (P27): sin eso, «Solo a» con turno nuevo no se puede deshacer.
  const canDeleteShifts = canOwnerDelete(useAuth())
  const openPath = (path: string) => void navigate(path)

  const blockById = useMemo(
    () => new Map(blocks.map((block) => [block.assignmentId, block])),
    [blocks],
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
  const dates = useMemo(() => {
    const [year, monthNumber] = month.from.split('-').map(Number)
    return monthDates(year ?? 0, monthNumber ?? 1)
  }, [month.from])

  const gapsByDate = useMemo(() => groupGapsByDate(gaps), [gaps])
  const assignEmployee = useAssignEmployeeMutation()
  const [replaceGap, setReplaceGap] = useState<FixedGap | null>(null)
  // D-05: color del cliente a confirmar. D-06: turno a eliminar (solo la dirección).
  const [colorRequest, setColorRequest] = useState<ClientColorRequest | null>(
    null,
  )
  const [deleteShiftId, setDeleteShiftId] = useState<string | null>(null)
  // D-08: alta (`note` nula) o edición de una observación; eliminación a confirmar.
  const [noteDialog, setNoteDialog] = useState<{
    date: string
    note: CalendarNote | null
  } | null>(null)
  const [deletingNote, setDeletingNote] = useState<CalendarNote | null>(null)
  const notesByDate = useMemo(() => groupNotesByDate(notes ?? []), [notes])

  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingChange | null>(null)
  const [moveDialog, setMoveDialog] = useState<WeekBlock | null>(null)
  const [removing, setRemoving] = useState<WeekBlock | null>(null)
  const [drag, setDrag] = useState<{
    blockId: string
    targetDate: string | null
    x: number
    y: number
  } | null>(null)
  const [assignDrag, setAssignDrag] = useState<UncoveredDragState | null>(null)

  const cellRefs = useRef(new Map<string, HTMLElement>())
  const gridRef = useRef<HTMLDivElement | null>(null)

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: planningKeys.all })
    void queryClient.invalidateQueries({ queryKey: shiftsKeys.all })
    // D-07: cambiar el horario de un turno finalizado recalcula horas y asistencia.
    void queryClient.invalidateQueries({ queryKey: ['attendance'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
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
      const warning = describeWarnings([
        ...result.warnings,
        ...(result.shiftWarnings ?? []),
      ])
      const options = result.undo
        ? {
            // DEF-P30-08: con «Deshacer» el aviso dura 10 s, no los ~4 s por defecto.
            duration: UNDO_TOAST_DURATION_MS,
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

  /** Punto de entrada de todo cambio de horario o de día: decide turno entero o pregunta. */
  function requestChange(
    block: WeekBlock,
    next: ScheduleChange,
    resizeOnly: boolean,
  ) {
    if (!hasScheduleChanged(block, next)) {
      return
    }
    if (completedDateChangeBlocked(block, next)) {
      toast.error(COMPLETED_DATE_MESSAGE)
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
    if (targetShiftId === NEW_SHIFT) {
      return execute(
        {
          kind: 'move_new_shift',
          assignmentId: block.assignmentId,
          date: next.date,
          start,
          end,
          canUndo: canDeleteShifts,
        },
        block,
        `Creamos un turno nuevo en ${block.siteName} y pasamos a ${personName}.`,
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

  function commitTime(block: WeekBlock, edge: 'start' | 'end', value: string) {
    const result = applyTimeEdit(block, edge, value)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    requestChange(block, result.next, true)
  }

  // ----- arrastre de bloques a otro día ---------------------------------

  function dayRects(): DayRect[] {
    const rects: DayRect[] = []
    for (const [date, element] of cellRefs.current) {
      const rect = element.getBoundingClientRect()
      rects.push({
        date,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      })
    }
    return rects
  }

  function dragMove(block: WeekBlock, x: number, y: number) {
    setDrag({
      blockId: block.assignmentId,
      targetDate: dateAtPoint(dayRects(), x, y),
      x,
      y,
    })
  }

  function dragEnd(block: WeekBlock, x: number, y: number) {
    const target = dateAtPoint(dayRects(), x, y)
    setDrag(null)
    if (target && target !== block.date) {
      requestChange(block, moveToDate(block, target), false)
    }
  }

  function assignShift(shift: ShiftListRow) {
    void execute(
      { kind: 'assign', shiftId: shift.id, employeeId: profileId },
      undefined,
      `Asignamos a ${personName} al turno.`,
    )
  }

  /** OH-06: «Asignar» a esta persona; los errores de la base se muestran tal cual. */
  async function assignGap(gap: FixedGap) {
    setBusy(true)
    try {
      const result = await assignEmployee.mutateAsync({
        shiftId: gap.shiftId,
        employeeId: profileId,
      })
      refresh()
      const warning = describeWarnings(result.warnings)
      const message = `Asignamos a ${personName} al turno de ${gap.siteName}.`
      if (warning) {
        toast.warning(`${message} Con advertencias: ${warning}`)
      } else {
        toast.success(message)
      }
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos asignar el turno.',
        conflictToastOptions(error, openPath),
      )
    } finally {
      setBusy(false)
    }
  }

  const draggedBlock = drag ? blockById.get(drag.blockId) : undefined

  function renderGaps(dayGaps: FixedGap[]) {
    return dayGaps.map((gap) => (
      <FixedGapBlock
        key={`${gap.shiftId}`}
        gap={gap}
        personName={personName}
        busy={busy}
        onReplace={setReplaceGap}
        onAssign={(target) => void assignGap(target)}
        canDelete={canDeleteShifts}
        onDelete={(target) => setDeleteShiftId(target.shiftId)}
      />
    ))
  }

  /** D-08: las observaciones del día y el «+» para agregar otra. */
  function renderNotes(date: string) {
    if (!notes) {
      return null
    }
    return (
      <>
        {(notesByDate.get(date) ?? []).map((note) => (
          <CalendarNoteCell
            key={note.id}
            profileId={profileId}
            note={note}
            onEdit={(target) => setNoteDialog({ date, note: target })}
            onDelete={setDeletingNote}
          />
        ))}
        <button
          type="button"
          aria-label={`Agregar una observación el ${formatDateOnly(date)}`}
          className="flex items-center justify-center rounded-sm border border-dashed border-neutral-400 py-0.5 text-neutral-500 hover:bg-neutral-100 max-md:min-h-6 print:hidden"
          onClick={() => setNoteDialog({ date, note: null })}
        >
          <Plus className="size-3" />
        </button>
      </>
    )
  }

  function renderDay(day: CronogramaDay) {
    const fullCell = day.kind === 'leave' || day.kind === 'holiday'
    const background =
      day.kind === 'holiday'
        ? 'bg-[#dc2626] text-white'
        : day.kind === 'leave'
          ? 'bg-neutral-300 text-black'
          : day.inMonth
            ? 'bg-white text-black'
            : 'bg-neutral-100 text-neutral-400'
    const isTarget = drag?.targetDate === day.date
    const dayGaps = day.inMonth ? (gapsByDate.get(day.date) ?? []) : []
    return (
      <td
        key={day.date}
        ref={(element) => {
          if (element && day.inMonth) {
            cellRefs.current.set(day.date, element)
          } else {
            cellRefs.current.delete(day.date)
          }
        }}
        data-testid={`dia-${day.date}`}
        data-kind={day.inMonth ? day.kind : 'fuera'}
        data-drop-target={isTarget ? 'true' : undefined}
        className={`h-[21mm] border border-neutral-700 p-0 align-top ${background} ${
          isTarget ? 'outline-2 -outline-offset-2 outline-primary' : ''
        }`}
      >
        <div className="flex h-full min-h-[21mm]">
          <span className="w-4 shrink-0 border-r border-neutral-500 pt-0.5 text-center text-[10px] font-bold tabular-nums xl:w-5 xl:text-[11px]">
            {day.inMonth ? day.day : ''}
          </span>
          {fullCell ? (
            // OH-06: con licencia o feriado, los fijos sin asignar van debajo del rótulo.
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span
                className={`flex items-center justify-center px-1 text-center text-[12px] font-bold [overflow-wrap:anywhere] ${
                  dayGaps.length > 0 ? 'pt-1' : 'flex-1'
                }`}
              >
                {day.label}
              </span>
              {dayGaps.length > 0 && (
                <div className="flex min-w-0 flex-col gap-1.5 p-0.5 text-black">
                  {renderGaps(dayGaps)}
                </div>
              )}
              {day.inMonth && notes && (
                <div className="flex min-w-0 flex-col gap-1.5 p-0.5 text-black">
                  {renderNotes(day.date)}
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-0.5">
              {day.holiday && (
                <span className="bg-[#dc2626] text-center text-[10px] leading-4 font-bold text-white">
                  FERIADO
                </span>
              )}
              {day.shifts.map((shift) => {
                const block = blockById.get(shift.key)
                if (!block) {
                  return null
                }
                return (
                  <MonthBlock
                    key={shift.key}
                    block={block}
                    siteLabel={shift.site}
                    start={shift.start}
                    end={shift.end}
                    canEdit={canEdit}
                    disabled={busy}
                    dragging={drag?.blockId === shift.key}
                    onDragMove={dragMove}
                    onDragEnd={dragEnd}
                    onDragCancel={() => setDrag(null)}
                    onTimeCommit={commitTime}
                    onOpenShift={(target) =>
                      void navigate(`/admin/turnos/${target.shiftId}`)
                    }
                    onMove={setMoveDialog}
                    onRemove={setRemoving}
                    onColorRequest={setColorRequest}
                    canDelete={canDeleteShifts}
                    onDelete={(target) => setDeleteShiftId(target.shiftId)}
                  />
                )
              })}
              {renderGaps(dayGaps)}
              {day.inMonth && renderNotes(day.date)}
            </div>
          )}
        </div>
      </td>
    )
  }

  return (
    <div className="flex flex-col gap-3" data-testid="calendario-mes">
      {canEdit && (
        <p className="text-[12px] text-text-2">
          Tocá una hora para editarla (Enter confirma, Esc cancela), tocá el
          cliente para abrir el turno o arrastrá un turno a otro día para
          moverlo. En el celular usá el menú del turno. Cada cambio pasa por las
          validaciones del servidor.
        </p>
      )}
      <div className="flex flex-col gap-3 xl:flex-row">
        <div
          ref={gridRef}
          className={`min-w-0 flex-1 overflow-x-auto rounded-md border bg-white p-3 ${
            assignDrag?.over
              ? 'border-primary ring-2 ring-ring'
              : 'border-border'
          }`}
        >
          <div className="min-w-[700px] font-mono text-black lg:min-w-0 print:min-w-[860px]">
            <h2 className="mb-1.5 text-[16px] font-bold">{month.title}</h2>
            <table className="w-full table-fixed border-collapse">
              <thead>
                <tr>
                  {CRONOGRAMA_WEEKDAYS.map((weekday) => (
                    <th
                      key={weekday}
                      scope="col"
                      className="border border-neutral-700 bg-neutral-800 py-0.5 text-[11px] font-bold text-white"
                    >
                      {weekday}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {month.weeks.map((week) => (
                  <tr key={week[0]?.date}>{week.map(renderDay)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {canEdit && (
          <UncoveredPanel
            uncovered={uncovered}
            days={dates}
            personName={personName}
            busy={busy}
            gridRef={gridRef}
            onDrag={setAssignDrag}
            onAssign={assignShift}
          />
        )}
      </div>

      {drag && draggedBlock && (
        <div
          className="pointer-events-none fixed z-50 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-white shadow-lg"
          style={{ left: drag.x + 12, top: drag.y + 12 }}
        >
          {draggedBlock.siteName}
          {drag.targetDate ? ` → ${formatDateOnly(drag.targetDate)}` : ''}
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
          days={dates}
          onClose={() => setMoveDialog(null)}
          onConfirm={(next) => {
            const block = moveDialog
            setMoveDialog(null)
            requestChange(block, next, false)
          }}
        />
      )}

      {replaceGap && (
        <GapReplaceSheet
          gap={replaceGap}
          profileId={profileId}
          onClose={() => {
            setReplaceGap(null)
            refresh()
          }}
        />
      )}

      {noteDialog && (
        <CalendarNoteDialog
          profileId={profileId}
          date={noteDialog.date}
          note={noteDialog.note}
          onClose={() => setNoteDialog(null)}
        />
      )}

      {deletingNote && (
        <DeleteCalendarNoteDialog
          profileId={profileId}
          note={deletingNote}
          onClose={() => setDeletingNote(null)}
        />
      )}

      <ClientColorConfirmDialog
        request={colorRequest}
        onClose={() => setColorRequest(null)}
      />

      {deleteShiftId && (
        <OwnerDeleteDialog
          kind="shift"
          id={deleteShiftId}
          open
          onOpenChange={(open) => {
            if (!open) {
              setDeleteShiftId(null)
            }
          }}
          onDeleted={() => {
            setDeleteShiftId(null)
            refresh()
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

export { CalendarioMonthEditor }
