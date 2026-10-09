import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { CalendarOff, Pencil, Plus, Save } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { EmptyState } from '@/components/EmptyState'
import { SimpleConfirmDialog } from '@/features/settings/components/SimpleConfirmDialog'
import { isApiError } from '@/api/errors'
import type { EmployeeLeave } from '@/api/employees'
import { formatCalendarDate } from '@/lib/format'
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
  useCreateEmployeeLeaveMutation,
  useDeactivateEmployeeLeaveMutation,
  useEmployeeLeavesQuery,
  useUpdateEmployeeLeaveMutation,
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
}: {
  profileId: string
  canEdit: boolean
}) {
  const auth = useAuth()
  const leavesQuery = useEmployeeLeavesQuery(profileId)
  const createLeave = useCreateEmployeeLeaveMutation(profileId)
  const updateLeave = useUpdateEmployeeLeaveMutation(profileId)
  const deactivateLeave = useDeactivateEmployeeLeaveMutation(profileId)
  // AJ2-08: licencia que se está editando con el mismo formulario del alta.
  const [editingLeave, setEditingLeave] = useState<EmployeeLeave | null>(null)
  const [leaveToEnd, setLeaveToEnd] = useState<EmployeeLeave | null>(null)

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

  async function onSubmit(values: EmployeeLeaveFormValues) {
    const input = employeeLeaveFormValuesToInput(values)
    if (editingLeave) {
      try {
        await updateLeave.mutateAsync({
          id: editingLeave.id,
          input,
          updatedBy: auth.userId as string,
        })
        cancelEditing()
        toast.success('Guardamos los cambios de la licencia.')
      } catch (error) {
        toast.error(
          isApiError(error)
            ? error.message
            : 'No pudimos guardar los cambios de la licencia.',
        )
      }
      return
    }
    try {
      await createLeave.mutateAsync({
        input,
        createdBy: auth.userId as string,
      })
      reset({ startsOn: '', endsOn: '', reason: '' })
      toast.success('Agregamos la licencia.')
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos agregar la licencia.',
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

  return (
    <div className="flex flex-col gap-4">
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
              loading={createLeave.isPending || updateLeave.isPending}
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

export { EmployeeLeavesTab }
