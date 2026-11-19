import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { useNavigate } from 'react-router'
import {
  CalendarOff,
  Pencil,
  Plus,
  Save,
  TriangleAlert,
  UserPlus,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { EmptyState } from '@/components/EmptyState'
import { LeavesAbsencesPrintAction } from '@/features/employees/components/LeavesAbsencesPrintAction'
import type { LeavesAbsencesPerson } from '@/features/employees/leavesAbsencesSheet'
import { SimpleConfirmDialog } from '@/features/settings/components/SimpleConfirmDialog'
import { isApiError, type ConflictDetail } from '@/api/errors'
import { ConflictShiftLink } from '@/features/shifts/conflictLink'
import type {
  EmployeeLeave,
  EmployeeLeaveInput,
  LeaveShiftEntry,
  SaveEmployeeLeaveResult,
} from '@/api/employees'
import { AssignEmployeeSheet } from '@/features/planning/components/AssignEmployeeSheet'
import { formatCalendarDate } from '@/lib/format'
import { formatDateOnly } from '@/features/settings/dateOnly'
import { formatShiftRange } from '@/features/shifts/openEnded'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  deriveEmployeeLeaveStatus,
  EMPLOYEE_LEAVE_STATUS_LABELS,
  type EmployeeLeaveDerivedStatus,
} from '@/features/employees/employeeLeaveStatus'
import {
  employeeLeaveFormValuesToInput,
  employeeLeaveSchema,
  type EmployeeLeaveFormValues,
} from '@/features/employees/schemas'
import {
  useDeactivateEmployeeLeaveMutation,
  useEmployeeLeavesQuery,
  useSaveEmployeeLeaveMutation,
} from '@/features/employees/queries'

const LEAVE_STATUS_VARIANT: Record<
  EmployeeLeaveDerivedStatus,
  'warning' | 'info' | 'neutral'
> = {
  current: 'warning',
  upcoming: 'info',
  ended: 'neutral',
}

/**
 * EMP-008, pestaña "Licencias" de ADM-17 (P-033): alta con "desde"
 * obligatorio y "hasta" opcional (licencia abierta), estado derivado
 * (vigente, futura, terminada) y baja lógica -- nunca borrado físico, aunque
 * la política de la base lo permita (ver el reporte del encargo). Una
 * licencia vigente es lo que hace que la cabecera de la ficha y el listado
 * (ADM-16) muestren "De licencia" (`v_employees.effective_status`).
 */
function EmployeeLeavesTab({
  profileId,
  canEdit,
  person,
}: {
  profileId: string
  canEdit: boolean
  /** Datos de la persona para el imprimible «Licencias y ausencias» (P19.11d); sin esto no se ofrece. */
  person?: LeavesAbsencesPerson
}) {
  const auth = useAuth()
  const leavesQuery = useEmployeeLeavesQuery(profileId)
  const saveLeave = useSaveEmployeeLeaveMutation(profileId)
  const deactivateLeave = useDeactivateEmployeeLeaveMutation(profileId)
  // OH-08: vista previa pendiente de confirmar (turnos que se liberan o se conservan).
  const [pendingSave, setPendingSave] = useState<{
    input: EmployeeLeaveInput
    preview: SaveEmployeeLeaveResult
  } | null>(null)
  // OH-08: turnos que quedaron sin cubrir después de guardar, con «Reemplazar».
  const [uncovered, setUncovered] = useState<LeaveShiftEntry[]>([])
  const [replaceTarget, setReplaceTarget] = useState<LeaveShiftEntry | null>(
    null,
  )
  // AJ2-08: licencia que se está editando con el mismo formulario del alta.
  const [editingLeave, setEditingLeave] = useState<EmployeeLeave | null>(null)
  const [leaveToEnd, setLeaveToEnd] = useState<EmployeeLeave | null>(null)
  const personName = person?.name ?? 'esta persona'

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EmployeeLeaveFormValues>({
    resolver: zodResolver(employeeLeaveSchema),
    defaultValues: { startsOn: '', endsOn: '', reason: '' },
  })

  // El historial incluye las licencias dadas de baja (para no perder el
  // registro), pero se muestran atenuadas y sin estado derivado -- ya no
  // cuentan para "de licencia" ni para bloquear un rango de fechas.
  const leaves = leavesQuery.data ?? []

  function startEditing(leave: EmployeeLeave) {
    setEditingLeave(leave)
    reset({
      startsOn: leave.startsOn,
      endsOn: leave.endsOn ?? '',
      reason: leave.reason ?? '',
    })
  }

  function cancelEditing() {
    setEditingLeave(null)
    reset({ startsOn: '', endsOn: '', reason: '' })
  }

  /**
   * OH-08: al tocar Guardar se pide primero la vista previa
   * (`save_employee_leave` con `p_preview`). Si la licencia libera o toca
   * turnos, se muestra el diálogo de confirmación; si no hay nada, se guarda
   * directo. Si la vista previa falla, se muestra el error y no se guarda.
   */
  async function onSubmit(values: EmployeeLeaveFormValues) {
    const input = employeeLeaveFormValuesToInput(values)
    try {
      const preview = await saveLeave.mutateAsync({
        input,
        leaveId: editingLeave?.id ?? null,
        preview: true,
      })
      if (preview.released.length > 0 || preview.kept.length > 0) {
        setPendingSave({ input, preview })
        return
      }
    } catch (error) {
      toast.error(
        isApiError(error)
          ? error.message
          : 'No pudimos revisar qué turnos toca la licencia.',
      )
      return
    }
    await confirmSave(input)
  }

  async function confirmSave(input: EmployeeLeaveInput) {
    const wasEditing = editingLeave != null
    try {
      const result = await saveLeave.mutateAsync({
        input,
        leaveId: editingLeave?.id ?? null,
      })
      setPendingSave(null)
      if (wasEditing) {
        cancelEditing()
      } else {
        reset({ startsOn: '', endsOn: '', reason: '' })
      }
      toast.success(
        wasEditing
          ? 'Guardamos los cambios de la licencia.'
          : 'Agregamos la licencia.',
      )
      setUncovered(result.released)
    } catch (error) {
      setPendingSave(null)
      toast.error(
        isApiError(error)
          ? error.message
          : wasEditing
            ? 'No pudimos guardar los cambios de la licencia.'
            : 'No pudimos agregar la licencia.',
      )
    }
  }

  async function handleEndLeave() {
    if (!leaveToEnd) return
    try {
      await deactivateLeave.mutateAsync({
        id: leaveToEnd.id,
        updatedBy: auth.userId as string,
      })
      toast.success('Dimos de baja la licencia.')
      setLeaveToEnd(null)
    } catch (error) {
      toast.error(
        isApiError(error)
          ? error.message
          : 'No pudimos dar de baja la licencia.',
      )
    }
  }

  const canPrint = auth.roles.some(
    (role) => role === 'owner' || role === 'admin',
  )

  return (
    <div className="flex flex-col gap-4">
      {person && canPrint && (
        <div className="flex justify-end">
          <LeavesAbsencesPrintAction profileId={profileId} person={person} />
        </div>
      )}
      {canEdit && (
        <form
          noValidate
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface p-3 sm:grid-cols-4"
        >
          <Field data-invalid={Boolean(errors.startsOn) || undefined}>
            <FieldLabel htmlFor="leave-starts-on">Desde</FieldLabel>
            <Input
              id="leave-starts-on"
              type="date"
              aria-invalid={Boolean(errors.startsOn)}
              {...register('startsOn')}
            />
            {errors.startsOn && (
              <FieldError>{errors.startsOn.message}</FieldError>
            )}
          </Field>
          <Field data-invalid={Boolean(errors.endsOn) || undefined}>
            <FieldLabel htmlFor="leave-ends-on">Hasta (opcional)</FieldLabel>
            <Input
              id="leave-ends-on"
              type="date"
              aria-invalid={Boolean(errors.endsOn)}
              {...register('endsOn')}
            />
            {errors.endsOn && <FieldError>{errors.endsOn.message}</FieldError>}
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="leave-reason">Motivo (opcional)</FieldLabel>
            <Input id="leave-reason" {...register('reason')} />
          </Field>
          <div className="flex flex-wrap gap-2 sm:col-span-4">
            <Button
              type="submit"
              size="sm"
              icon={editingLeave ? Save : Plus}
              loading={saveLeave.isPending && pendingSave == null}
            >
              {editingLeave ? 'Guardar cambios' : 'Agregar licencia'}
            </Button>
            {editingLeave && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={cancelEditing}
              >
                Cancelar edición
              </Button>
            )}
          </div>
        </form>
      )}

      {uncovered.length > 0 && (
        <Alert variant="warn">
          <TriangleAlert />
          <AlertDescription>
            <p className="font-semibold">
              {uncovered.length === 1
                ? `Quedó 1 turno sin cubrir por la licencia de ${personName}.`
                : `Quedaron ${uncovered.length} turnos sin cubrir por la licencia de ${personName}.`}
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {uncovered.map((entry) => (
                <li
                  key={entry.assignmentId}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1"
                >
                  <LeaveShiftLine entry={entry} />
                  <Button
                    type="button"
                    variant="dark"
                    size="sm"
                    icon={UserPlus}
                    aria-label={`Reemplazar en ${entry.clientName}, ${formatDateOnly(entry.shiftDate)}`}
                    onClick={() => setReplaceTarget(entry)}
                  >
                    Reemplazar
                  </Button>
                  <SeeShiftLink shiftId={entry.shiftId} />
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setUncovered([])}
            >
              Cerrar aviso
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {leavesQuery.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : leaves.length === 0 ? (
        <EmptyState
          icon={CalendarOff}
          title="Todavía no hay licencias cargadas"
          description="Agregá la primera con el formulario de arriba."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {leaves.map((leave) => {
            const isActive = leave.deletedAt == null
            const status = deriveEmployeeLeaveStatus({
              startsOn: leave.startsOn,
              endsOn: leave.endsOn,
            })
            return (
              <li
                key={leave.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3"
                aria-label={!isActive ? 'Licencia dada de baja' : undefined}
              >
                <div className={!isActive ? 'opacity-60' : undefined}>
                  <p className="flex items-center gap-2 text-[12.5px] text-text">
                    {formatCalendarDate(leave.startsOn)}
                    {leave.endsOn
                      ? ` – ${formatCalendarDate(leave.endsOn)}`
                      : ' – sin fecha de fin'}
                    {isActive && (
                      <Badge variant={LEAVE_STATUS_VARIANT[status]}>
                        {EMPLOYEE_LEAVE_STATUS_LABELS[status]}
                      </Badge>
                    )}
                    {!isActive && <Badge variant="neutral">Dada de baja</Badge>}
                  </p>
                  {leave.reason && (
                    <p className="mt-1 text-[11px] text-text-3">
                      {leave.reason}
                    </p>
                  )}
                </div>
                {canEdit && isActive && (
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      icon={Pencil}
                      aria-label={`Editar la licencia del ${formatCalendarDate(leave.startsOn)}`}
                      onClick={() => startEditing(leave)}
                    >
                      Editar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setLeaveToEnd(leave)}
                    >
                      Dar de baja
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {pendingSave && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !saveLeave.isPending) {
              setPendingSave(null)
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {pendingSave.preview.released.length > 0
                  ? releaseTitle(
                      pendingSave.preview.released.length,
                      personName,
                    )
                  : 'Revisá los turnos de esta licencia'}
              </DialogTitle>
              <DialogDescription>
                {pendingSave.preview.released.length > 0
                  ? 'Al confirmar se guarda la licencia y se quita a la persona de estos turnos. Quedan sin cubrir hasta que asignes a alguien.'
                  : 'No hay turnos para liberar, pero hay turnos que no se tocan.'}
              </DialogDescription>
            </DialogHeader>
            <div className="flex max-h-72 flex-col gap-3 overflow-y-auto text-[12.5px]">
              {pendingSave.preview.released.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {pendingSave.preview.released.map((entry) => (
                    <li key={entry.assignmentId}>
                      <LeaveShiftLine entry={entry} />
                    </li>
                  ))}
                </ul>
              )}
              {pendingSave.preview.kept.length > 0 && (
                <div>
                  <p className="font-semibold text-text">
                    {keptTitle(pendingSave.preview.kept.length)}
                  </p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {pendingSave.preview.kept.map((entry) => (
                      <li key={entry.assignmentId}>
                        <LeaveShiftLine entry={entry} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={saveLeave.isPending}
                onClick={() => setPendingSave(null)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                loading={saveLeave.isPending}
                onClick={() => void confirmSave(pendingSave.input)}
              >
                Confirmar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {replaceTarget && (
        <AssignEmployeeSheet
          shiftId={replaceTarget.shiftId}
          clientId={replaceTarget.clientId}
          shiftDate={replaceTarget.shiftDate}
          shiftStartTime={replaceTarget.startTime}
          shiftEndTime={replaceTarget.endTime}
          shiftOpenEnded={replaceTarget.openEnded}
          excludeEmployeeIds={[profileId]}
          open
          onOpenChange={(open) => !open && setReplaceTarget(null)}
          onAssigned={() =>
            setUncovered((current) =>
              current.filter(
                (entry) => entry.assignmentId !== replaceTarget.assignmentId,
              ),
            )
          }
        />
      )}

      <SimpleConfirmDialog
        open={leaveToEnd != null}
        onOpenChange={(open) => !open && setLeaveToEnd(null)}
        title="Dar de baja esta licencia"
        description={
          leaveToEnd
            ? `La persona deja de figurar de licencia en esas fechas y podés cargar otra licencia en ese rango. Esta queda en el historial como dada de baja.`
            : undefined
        }
        confirmLabel="Dar de baja"
        isLoading={deactivateLeave.isPending}
        onConfirm={() => void handleEndLeave()}
      />
    </div>
  )
}

/** «Se van a liberar 3 turnos de Ana Gómez». */
function releaseTitle(count: number, name: string): string {
  return count === 1
    ? `Se va a liberar 1 turno de ${name}`
    : `Se van a liberar ${count} turnos de ${name}`
}

/** «Este turno tiene fichajes y no se toca» / «Estos 2 turnos tienen fichajes y no se tocan». */
function keptTitle(count: number): string {
  return count === 1
    ? 'Este turno tiene fichajes y no se toca'
    : `Estos ${count} turnos tienen fichajes y no se tocan`
}

/** Una línea de turno: fecha, horario, cliente y sede, servicio. */
function LeaveShiftLine({ entry }: { entry: LeaveShiftEntry }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <span className="capitalize">{formatDateOnly(entry.shiftDate)}</span>
      <span>
        {formatShiftRange(entry.startTime, entry.endTime, entry.openEnded)}
      </span>
      <span>
        {entry.clientName} · {entry.siteName}
      </span>
      <span>{entry.serviceName ?? 'Turno cargado a mano'}</span>
    </span>
  )
}

/** «Ver turno» (OF-08b); el router se usa solo cuando hay turnos en la lista. */
function SeeShiftLink({ shiftId }: { shiftId: string }) {
  const navigate = useNavigate()
  return (
    <ConflictShiftLink
      detail={{ conflictShiftId: shiftId } as ConflictDetail}
      onOpen={(path) => void navigate(path)}
    />
  )
}

export { EmployeeLeavesTab }
