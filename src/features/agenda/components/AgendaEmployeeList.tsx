import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  Ban,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Plus,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { IconButton, IconButtonGroup } from '@/components/IconButton'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isApiError } from '@/api/errors'
import type { AgendaStaffLine } from '@/api/agenda'
import { useAuth } from '@/features/auth/AuthProvider'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import { AssignmentTimeDialog } from '@/features/planning/components/AssignmentTimeDialog'
import {
  planningKeys,
  useAssignmentsBoardRangeQuery,
} from '@/features/planning/queries'
import { CancelShiftDialog } from '@/features/shifts/components/CancelShiftDialog'
import {
  canCancelShift,
  canManageShiftTime,
  isShiftCancellable,
} from '@/features/shifts/permissions'
import { addDaysToIsoDate, formatDateOnly } from '@/features/settings/dateOnly'
import { useWorkdaysByDateQuery } from '@/features/workdays/queries'
import { agendaBlockStyle } from '../agendaColors'
import {
  buildCoordinatorWorkdays,
  buildDailyStaffList,
  moveLine,
  type DailyCoordinatorEntry,
  type DailyStaffEntry,
  type ShiftLine,
} from '../dailyList'
import {
  useAgendaEmployeeColorsQuery,
  useAgendaLeavesQuery,
  useAgendaShiftObservationsQuery,
  useAgendaStaffLinesQuery,
  useAgendaStaffQuery,
  useDeleteAgendaStaffLineMutation,
  useSaveAgendaStaffLineMutation,
  useSetAgendaEmployeeColorMutation,
  useSetAgendaEmployeeFixedLineMutation,
} from '../queries'
import { buildWhatsAppText } from '../whatsappText'
import { AgendaColorPicker } from './AgendaColorPicker'

const LINE_MAX_LENGTH = 1000

function errorText(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback
}

/** Renglón fijo (AG-22): texto de puesto o zona, sin viñeta, editable en línea. */
function FixedLineInput({ entry }: { entry: DailyStaffEntry }) {
  const [text, setText] = useState(entry.fixedLine ?? '')
  const [synced, setSynced] = useState(entry.fixedLine)
  const setFixedLine = useSetAgendaEmployeeFixedLineMutation()

  if (entry.fixedLine !== synced) {
    setSynced(entry.fixedLine)
    setText(entry.fixedLine ?? '')
  }

  function commit() {
    const next = text.trim()
    if (next === (entry.fixedLine ?? '')) {
      return
    }
    setFixedLine.mutate(
      { employeeId: entry.employeeId, text: next === '' ? null : next },
      {
        onError: (error) => {
          toast.error(errorText(error, 'No pudimos guardar el renglón fijo.'))
          setText(entry.fixedLine ?? '')
        },
      },
    )
  }

  return (
    <Input
      aria-label={`Renglón fijo de ${entry.name}`}
      placeholder="Puesto o zona (se repite todos los días)"
      value={text}
      maxLength={LINE_MAX_LENGTH}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur()
        }
      }}
      className="h-8 bg-surface text-[12px] text-text"
    />
  )
}

interface FreeLineRowProps {
  line: AgendaStaffLine
  index: number
  total: number
  onMove: (index: number, delta: -1 | 1) => void
  day: string
}

/** Renglón libre del día (AG-23): texto editable en línea, subir, bajar y borrar. */
function FreeLineRow({ line, index, total, onMove, day }: FreeLineRowProps) {
  const [text, setText] = useState(line.body)
  const [synced, setSynced] = useState(line.body)
  const save = useSaveAgendaStaffLineMutation()
  const remove = useDeleteAgendaStaffLineMutation()

  if (line.body !== synced) {
    setSynced(line.body)
    setText(line.body)
  }

  function commit() {
    const next = text.trim()
    if (next === line.body) {
      return
    }
    if (next === '') {
      toast.error('El renglón no puede quedar vacío. Para sacarlo, borralo.')
      setText(line.body)
      return
    }
    save.mutate(
      { id: line.id, employeeId: line.employeeId, day, body: next },
      {
        onError: (error) => {
          toast.error(errorText(error, 'No pudimos guardar el renglón.'))
          setText(line.body)
        },
      },
    )
  }

  return (
    <li className="flex items-center gap-1 text-text">
      <span aria-hidden="true">▪️</span>
      <Input
        aria-label="Renglón libre"
        value={text}
        maxLength={LINE_MAX_LENGTH}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          }
        }}
        className="h-8 bg-surface text-[12px]"
      />
      <IconButtonGroup>
        <IconButton
          icon={ChevronUp}
          aria-label="Subir renglón"
          disabled={index === 0}
          onClick={() => onMove(index, -1)}
          className="size-7"
        />
        <IconButton
          icon={ChevronDown}
          aria-label="Bajar renglón"
          disabled={index === total - 1}
          onClick={() => onMove(index, 1)}
          className="size-7"
        />
        <IconButton
          icon={Trash2}
          aria-label="Borrar renglón"
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(line.id, {
              onError: (error) =>
                toast.error(errorText(error, 'No pudimos borrar el renglón.')),
            })
          }
          className="size-7 text-danger"
        />
      </IconButtonGroup>
    </li>
  )
}

/** «+ renglón»: Enter o salir del campo con texto lo agrega. */
function NewFreeLine({
  employeeId,
  day,
  onClose,
}: {
  employeeId: string
  day: string
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const save = useSaveAgendaStaffLineMutation()

  function commit() {
    const body = text.trim()
    if (body === '') {
      onClose()
      return
    }
    save.mutate(
      { id: null, employeeId, day, body },
      {
        onSuccess: onClose,
        onError: (error) =>
          toast.error(errorText(error, 'No pudimos agregar el renglón.')),
      },
    )
  }

  return (
    <li className="flex items-center gap-1 text-text">
      <span aria-hidden="true">▪️</span>
      <Input
        ref={(element) => element?.focus()}
        aria-label="Renglón nuevo"
        placeholder="Escribí el renglón y apretá Enter"
        value={text}
        disabled={save.isPending}
        maxLength={LINE_MAX_LENGTH}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            setText('')
            onClose()
          }
        }}
        className="h-8 bg-surface text-[12px]"
      />
    </li>
  )
}

interface StaffRowProps {
  entry: DailyStaffEntry
  day: string
  workday: DailyCoordinatorEntry | undefined
  canChangeTime: boolean
  canCancel: boolean
  onChangeTime: (entry: DailyStaffEntry, shift: ShiftLine) => void
  onCancel: (shift: ShiftLine) => void
  onColor: (
    employeeId: string,
    next: { border: number | null; fill: number | null },
  ) => void
}

function StaffRow({
  entry,
  day,
  workday,
  canChangeTime,
  canCancel,
  onChangeTime,
  onCancel,
  onColor,
}: StaffRowProps) {
  const [adding, setAdding] = useState(false)
  const save = useSaveAgendaStaffLineMutation()

  async function handleMove(index: number, delta: -1 | 1) {
    const next = moveLine(entry.freeLines, index, delta)
    try {
      for (const [position, line] of next.entries()) {
        if (line.position !== position) {
          await save.mutateAsync({
            id: line.id,
            employeeId: line.employeeId,
            day,
            body: line.body,
            position,
          })
        }
      }
    } catch (error) {
      toast.error(errorText(error, 'No pudimos mover el renglón.'))
    }
  }

  return (
    <li
      className="flex flex-col gap-1.5 rounded-md border border-border bg-bg p-2"
      style={agendaBlockStyle(entry.borderColor, entry.fillColor)}
      data-testid="agenda-employee"
    >
      <div className="flex items-center justify-between gap-2">
        <Link
          to={`/admin/empleados/${entry.employeeId}`}
          className="text-[13px] font-semibold underline-offset-2 hover:underline"
        >
          {entry.label}
        </Link>
        <AgendaColorPicker
          label="Color"
          value={{ border: entry.borderColor, fill: entry.fillColor }}
          onChange={(next) => onColor(entry.employeeId, next)}
        />
      </div>
      <div className="flex flex-col gap-1 rounded-sm bg-surface/90 p-1.5 text-[12px] text-text">
        <FixedLineInput entry={entry} />

        {entry.autoLines.map((line, index) =>
          line.kind === 'leave' ? (
            <p key={`leave-${index}`}>▪️ {line.text}</p>
          ) : (
            <div key={line.assignmentId} className="flex flex-col gap-1">
              <p>
                ▪️ {line.text}
                <span className="block pl-5 text-[11px] text-text-3">
                  {line.clientName}
                </span>
              </p>
              <div className="flex flex-wrap gap-1.5 pl-5">
                {canChangeTime && isShiftCancellable(line.shiftStatus) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon={Clock}
                    onClick={() => onChangeTime(entry, line)}
                  >
                    Cambiar horario
                  </Button>
                )}
                {canCancel && isShiftCancellable(line.shiftStatus) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon={Ban}
                    className="text-danger"
                    onClick={() => onCancel(line)}
                  >
                    Cancelar turno
                  </Button>
                )}
              </div>
            </div>
          ),
        )}

        {entry.isCoordinator && workday && (
          <div className="flex flex-col gap-0.5 text-text-2">
            <span>{workday.workdayLabel}</span>
            {workday.supervisions.map((supervision) => (
              <Link
                key={supervision.id}
                to={`/admin/supervisiones/${supervision.id}`}
                className="underline underline-offset-2"
              >
                Supervisión: {supervision.siteName} · {supervision.clientName}
              </Link>
            ))}
          </div>
        )}

        <ul className="flex flex-col gap-1">
          {entry.freeLines.map((line, index) => (
            <FreeLineRow
              key={line.id}
              line={line}
              index={index}
              total={entry.freeLines.length}
              onMove={(from, delta) => void handleMove(from, delta)}
              day={day}
            />
          ))}
          {adding && (
            <NewFreeLine
              employeeId={entry.employeeId}
              day={day}
              onClose={() => setAdding(false)}
            />
          )}
        </ul>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={Plus}
          className="self-start"
          onClick={() => setAdding(true)}
        >
          renglón
        </Button>
      </div>
    </li>
  )
}

/**
 * Lista de empleados del día (AG-15 y AG-21 a AG-25), aislada del resto de la
 * pizarra. Es el parte que hoy se manda al grupo de WhatsApp: se navega por día
 * (‹ fecha ›, arranca en hoy) y muestra a todo el personal activo por legajo,
 * con el renglón fijo, los turnos y licencias del día (automáticos, por hora) y
 * los renglones libres. Los coordinadores suman su jornada y supervisiones, solo
 * para mirar. Desde los turnos se puede cambiar el horario o cancelar el turno
 * real (mismos diálogos y reglas que Planificación). «Copiar para WhatsApp» arma
 * el texto del día.
 */
function AgendaEmployeeList() {
  const today = todayInBuenosAires()
  const [date, setDate] = useState(today)
  const auth = useAuth()
  const actor = { roles: auth.roles, capabilities: auth.capabilities }
  const queryClient = useQueryClient()

  const staffQuery = useAgendaStaffQuery()
  const assignmentsQuery = useAssignmentsBoardRangeQuery(date, date, {
    onlyActive: true,
  })
  const colorsQuery = useAgendaEmployeeColorsQuery()
  const linesQuery = useAgendaStaffLinesQuery(date)
  const leavesQuery = useAgendaLeavesQuery(date)
  const workdaysQuery = useWorkdaysByDateQuery(date, true, date === today)
  const setColor = useSetAgendaEmployeeColorMutation()

  const shiftIds = useMemo(
    () => (assignmentsQuery.data ?? []).map((row) => row.shiftId),
    [assignmentsQuery.data],
  )
  const observationsQuery = useAgendaShiftObservationsQuery(shiftIds)

  const entries = useMemo(
    () =>
      buildDailyStaffList({
        day: date,
        staff: staffQuery.data ?? [],
        assignments: assignmentsQuery.data ?? [],
        shiftObservations: observationsQuery.data ?? {},
        leaves: leavesQuery.data ?? [],
        staffLines: linesQuery.data ?? [],
        colors: colorsQuery.data ?? [],
      }),
    [
      date,
      staffQuery.data,
      assignmentsQuery.data,
      observationsQuery.data,
      leavesQuery.data,
      linesQuery.data,
      colorsQuery.data,
    ],
  )
  const workdays = useMemo(
    () => buildCoordinatorWorkdays(workdaysQuery.data ?? []),
    [workdaysQuery.data],
  )

  const [timeTarget, setTimeTarget] = useState<{
    entry: DailyStaffEntry
    shift: ShiftLine
  } | null>(null)
  const [cancelTarget, setCancelTarget] = useState<ShiftLine | null>(null)
  const [manualText, setManualText] = useState<string | null>(null)

  function changeColor(
    employeeId: string,
    next: { border: number | null; fill: number | null },
  ) {
    setColor.mutate(
      { employeeId, border: next.border, fill: next.fill },
      {
        onError: (error) =>
          toast.error(errorText(error, 'No pudimos guardar el color.')),
      },
    )
  }

  async function copyForWhatsApp() {
    const text = buildWhatsAppText(date, entries)
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copiado')
    } catch {
      // Sin permiso del navegador: se muestra el texto para copiarlo a mano.
      setManualText(text)
    }
  }

  const isLoading = staffQuery.isLoading || assignmentsQuery.isLoading

  return (
    <section
      aria-label="Lista de empleados"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3"
    >
      <h2 className="text-[14px] font-semibold text-text">
        Lista de empleados
      </h2>
      <div className="flex items-center justify-between gap-2">
        <IconButtonGroup>
          <IconButton
            icon={ChevronLeft}
            aria-label="Día anterior"
            onClick={() => setDate((current) => addDaysToIsoDate(current, -1))}
          />
          <IconButton
            icon={ChevronRight}
            aria-label="Día siguiente"
            onClick={() => setDate((current) => addDaysToIsoDate(current, 1))}
          />
        </IconButtonGroup>
        <p className="text-[13px] font-semibold text-text capitalize">
          {formatDateOnly(date)}
        </p>
        {date !== today && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setDate(today)}
          >
            Hoy
          </Button>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        icon={Copy}
        disabled={isLoading || entries.length === 0}
        onClick={() => void copyForWhatsApp()}
      >
        Copiar para WhatsApp
      </Button>

      {isLoading ? (
        <Skeleton className="h-24" />
      ) : assignmentsQuery.isError || staffQuery.isError ? (
        <p role="alert" className="text-[12.5px] text-danger">
          No pudimos cargar la lista del día.
        </p>
      ) : entries.length === 0 ? (
        <p className="text-[12.5px] text-text-3">No hay personal activo.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <StaffRow
              key={entry.employeeId}
              entry={entry}
              day={date}
              workday={workdays.get(entry.employeeId)}
              canChangeTime={canManageShiftTime(actor)}
              canCancel={canCancelShift(actor)}
              onChangeTime={(row, shift) =>
                setTimeTarget({ entry: row, shift })
              }
              onCancel={setCancelTarget}
              onColor={changeColor}
            />
          ))}
        </ul>
      )}

      {timeTarget && (
        <AssignmentTimeDialog
          assignmentId={timeTarget.shift.assignmentId}
          employeeName={timeTarget.entry.name}
          currentStartTime={timeTarget.shift.startTime}
          currentEndTime={
            timeTarget.shift.openEnded ? null : timeTarget.shift.endTime
          }
          shiftOpenEnded={timeTarget.shift.openEnded}
          open
          onOpenChange={(open) => {
            if (!open) {
              setTimeTarget(null)
            }
          }}
        />
      )}
      {cancelTarget && (
        <CancelShiftDialog
          shiftId={cancelTarget.shiftId}
          shiftDate={cancelTarget.shiftDate}
          open
          onOpenChange={(open) => {
            if (!open) {
              setCancelTarget(null)
            }
          }}
          warning={
            cancelTarget.otherPeopleCount > 0
              ? `Este turno tiene ${cancelTarget.otherPeopleCount} ${cancelTarget.otherPeopleCount === 1 ? 'persona más asignada' : 'personas más asignadas'}: se cancela para todas.`
              : undefined
          }
          onCancelled={() =>
            void queryClient.invalidateQueries({ queryKey: planningKeys.all })
          }
        />
      )}
      <Dialog
        open={manualText !== null}
        onOpenChange={(open) => {
          if (!open) {
            setManualText(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Copiá el texto a mano</DialogTitle>
            <DialogDescription>
              El navegador no nos dejó copiarlo solo. Seleccioná todo y copialo.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            readOnly
            aria-label="Texto para WhatsApp"
            value={manualText ?? ''}
            rows={14}
            onFocus={(event) => event.currentTarget.select()}
          />
        </DialogContent>
      </Dialog>
    </section>
  )
}

export { AgendaEmployeeList }
