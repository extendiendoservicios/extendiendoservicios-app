import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  Ban,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  MapPin,
  MoreVertical,
  Palette,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { IconButton, IconButtonGroup } from '@/components/IconButton'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { es as esDayPicker } from 'react-day-picker/locale'
import { Skeleton } from '@/components/ui/skeleton'
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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
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
import {
  addDaysToIsoDate,
  formatDateOnly,
  localDateToIsoDate,
} from '@/features/settings/dateOnly'
import { useWorkdaysByDateQuery } from '@/features/workdays/queries'
import { agendaBlockStyle } from '../agendaColors'
import {
  buildCoordinatorWorkdays,
  buildDailyStaffList,
  formatGroupRange,
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
import { AgendaColorDialog } from './AgendaColorPicker'

const LINE_MAX_LENGTH = 1000

function errorText(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback
}

/** Diálogo chico para escribir un texto (renglón fijo o renglón libre). */
function TextLineDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  initial,
  allowEmpty,
  pending,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  label: string
  initial: string
  allowEmpty: boolean
  pending: boolean
  onSubmit: (text: string) => void
}) {
  const [text, setText] = useState(initial)
  const trimmed = text.trim()
  const canSave = allowEmpty || trimmed !== ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (canSave) {
              onSubmit(trimmed)
            }
          }}
        >
          <Field>
            <FieldLabel htmlFor="agenda-line-text">{label}</FieldLabel>
            <Input
              id="agenda-line-text"
              value={text}
              maxLength={LINE_MAX_LENGTH}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={pending} disabled={!canSave}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type RowDialog =
  | { type: 'color' }
  | { type: 'fixed' }
  | { type: 'new-line' }
  | { type: 'edit-line'; line: AgendaStaffLine }

/** `YYYY-MM-DD` a `Date` local (sin pasar por UTC). */
function dateOnlyToLocalDate(isoDate: string): Date {
  const [year = 0, month = 1, day = 1] = isoDate.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
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

/**
 * Un bloque de persona (AG-28): solo texto. Todo lo que se puede hacer está en
 * el menú ⋮ de la esquina superior derecha.
 */
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
  const [dialog, setDialog] = useState<RowDialog | null>(null)
  const save = useSaveAgendaStaffLineMutation()
  const remove = useDeleteAgendaStaffLineMutation()
  const setFixedLine = useSetAgendaEmployeeFixedLineMutation()

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

  function saveFixed(text: string) {
    setFixedLine.mutate(
      { employeeId: entry.employeeId, text: text === '' ? null : text },
      {
        onSuccess: () => setDialog(null),
        onError: (error) =>
          toast.error(errorText(error, 'No pudimos guardar el renglón fijo.')),
      },
    )
  }

  function saveLine(id: string | null, text: string) {
    save.mutate(
      { id, employeeId: entry.employeeId, day, body: text },
      {
        onSuccess: () => setDialog(null),
        onError: (error) =>
          toast.error(errorText(error, 'No pudimos guardar el renglón.')),
      },
    )
  }

  function removeLine(line: AgendaStaffLine) {
    remove.mutate(line.id, {
      onError: (error) =>
        toast.error(errorText(error, 'No pudimos borrar el renglón.')),
    })
  }

  const shifts = entry.autoLines.filter(
    (line): line is ShiftLine =>
      line.kind === 'shift' && isShiftCancellable(line.shiftStatus),
  )
  const menuLabel = `Opciones de ${entry.label}`

  return (
    <li
      className="relative rounded-md border border-border bg-bg py-1.5 pr-9 pl-2"
      style={agendaBlockStyle(entry.borderColor, entry.fillColor)}
      data-testid="agenda-employee"
    >
      <div className="absolute top-0.5 right-0.5">
        <DropdownMenu>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    icon={MoreVertical}
                    aria-label={menuLabel}
                    className="size-7"
                  />
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{menuLabel}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <DropdownMenuContent align="end" className="max-w-[18rem]">
            <DropdownMenuItem onSelect={() => setDialog({ type: 'color' })}>
              <Palette />
              Color…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog({ type: 'fixed' })}>
              <MapPin />
              Puesto o zona…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog({ type: 'new-line' })}>
              <Plus />
              Agregar renglón…
            </DropdownMenuItem>
            {shifts.map((shift) => {
              const name = `${formatGroupRange(shift.startTime, shift.endTime, shift.openEnded)} ${shift.siteName}`
              return (
                <Fragment key={shift.assignmentId}>
                  <DropdownMenuSeparator />
                  {canChangeTime && (
                    <DropdownMenuItem
                      onSelect={() => onChangeTime(entry, shift)}
                    >
                      <Clock />
                      <span className="truncate">Cambiar horario · {name}</span>
                    </DropdownMenuItem>
                  )}
                  {canCancel && (
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => onCancel(shift)}
                    >
                      <Ban />
                      <span className="truncate">Cancelar turno · {name}</span>
                    </DropdownMenuItem>
                  )}
                </Fragment>
              )
            })}
            {entry.freeLines.map((line, index) => (
              <Fragment key={line.id}>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <span className="truncate">
                      Renglón · {truncate(line.body, 24)}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem
                      onSelect={() => setDialog({ type: 'edit-line', line })}
                    >
                      <Pencil />
                      <span className="truncate">
                        Editar renglón · {truncate(line.body, 24)}
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={index === 0}
                      onSelect={() => void handleMove(index, -1)}
                    >
                      <ChevronUp />
                      Subir
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={index === entry.freeLines.length - 1}
                      onSelect={() => void handleMove(index, 1)}
                    >
                      <ChevronDown />
                      Bajar
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => removeLine(line)}
                    >
                      <Trash2 />
                      Eliminar
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-col gap-0.5 text-[12px] leading-snug text-text">
        <Link
          to={`/admin/empleados/${entry.employeeId}`}
          className="text-[13px] font-semibold underline-offset-2 hover:underline"
        >
          {entry.label}
        </Link>
        {entry.fixedLine && <p>{entry.fixedLine}</p>}
        {entry.autoLines.map((line, index) => (
          <p key={line.kind === 'leave' ? `leave-${index}` : line.assignmentId}>
            ▪️ {line.text}
          </p>
        ))}
        {entry.isCoordinator && workday && (
          <div className="flex flex-col text-text-2">
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
        {entry.freeLines.map((line) => (
          <p key={line.id}>▪️ {line.body}</p>
        ))}
      </div>

      <AgendaColorDialog
        open={dialog?.type === 'color'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={`Color de ${entry.label}`}
        value={{ border: entry.borderColor, fill: entry.fillColor }}
        onChange={(next) => onColor(entry.employeeId, next)}
      />
      {dialog?.type === 'fixed' && (
        <TextLineDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title="Puesto o zona"
          description="Se repite todos los días. Dejalo vacío para sacarlo."
          label="Puesto o zona"
          initial={entry.fixedLine ?? ''}
          allowEmpty
          pending={setFixedLine.isPending}
          onSubmit={saveFixed}
        />
      )}
      {dialog?.type === 'new-line' && (
        <TextLineDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title="Agregar renglón"
          description="Un renglón libre solo para este día."
          label="Renglón"
          initial=""
          allowEmpty={false}
          pending={save.isPending}
          onSubmit={(text) => saveLine(null, text)}
        />
      )}
      {dialog?.type === 'edit-line' && (
        <TextLineDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title="Editar renglón"
          description="Solo cambia este día."
          label="Renglón"
          initial={dialog.line.body}
          allowEmpty={false}
          pending={save.isPending}
          onSubmit={(text) => saveLine(dialog.line.id, text)}
        />
      )}
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
  const [pickerOpen, setPickerOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Al cambiar de día, el scroll interno de la lista vuelve arriba.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [date])

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
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold text-text">
          Lista de empleados
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={Copy}
          aria-label="Copiar el parte del día para WhatsApp"
          disabled={isLoading || entries.length === 0}
          onClick={() => void copyForWhatsApp()}
        >
          WhatsApp
        </Button>
      </div>
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
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <IconButton icon={CalendarDays} aria-label="Elegir fecha" />
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>Elegir fecha</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="single"
                locale={esDayPicker}
                weekStartsOn={1}
                selected={dateOnlyToLocalDate(date)}
                defaultMonth={dateOnlyToLocalDate(date)}
                onSelect={(picked) => {
                  if (picked) {
                    setDate(localDateToIsoDate(picked))
                    setPickerOpen(false)
                  }
                }}
              />
            </PopoverContent>
          </Popover>
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

      <div
        ref={scrollRef}
        data-testid="agenda-employee-scroll"
        className="-mx-1 max-h-[70vh] overflow-y-auto px-1 py-0.5 lg:max-h-[26rem]"
      >
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
      </div>

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
