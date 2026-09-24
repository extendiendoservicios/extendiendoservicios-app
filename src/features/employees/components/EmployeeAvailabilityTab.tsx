import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { CalendarClock, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/IconButton'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EmptyState } from '@/components/EmptyState'
import { SimpleConfirmDialog } from '@/features/settings/components/SimpleConfirmDialog'
import { isApiError } from '@/api/errors'
import type { EmployeeAvailabilitySlot } from '@/api/employees'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  employeeAvailabilitySlotFormValuesToInput,
  employeeAvailabilitySlotSchema,
  type EmployeeAvailabilitySlotFormValues,
} from '@/features/employees/schemas'
import {
  useCreateEmployeeAvailabilityMutation,
  useDeleteEmployeeAvailabilityMutation,
  useEmployeeAvailabilityQuery,
} from '@/features/employees/queries'

/** Orden de exhibición (semana empieza en lunes), valor `0`..`6` = domingo..sábado (`04` sección 2.1). */
const WEEKDAY_OPTIONS: { value: string; label: string }[] = [
  { value: '1', label: 'Lunes' },
  { value: '2', label: 'Martes' },
  { value: '3', label: 'Miércoles' },
  { value: '4', label: 'Jueves' },
  { value: '5', label: 'Viernes' },
  { value: '6', label: 'Sábado' },
  { value: '0', label: 'Domingo' },
]

function weekdayLabel(weekday: number): string {
  return (
    WEEKDAY_OPTIONS.find((option) => Number(option.value) === weekday)?.label ??
    ''
  )
}

/** `"HH:mm:ss"` (columna `time` de Postgres) → `"HH:mm"`. */
function shortTime(time: string): string {
  return time.slice(0, 5)
}

/**
 * EMP-007, pestaña "Disponibilidad" de ADM-17 (P-035): franjas horarias
 * declaradas por día de la semana, agrupadas por día para leerlas rápido.
 * Alta y quitar en línea; sin edición de una franja existente (se quita y
 * se vuelve a cargar -- decisión menor, ver el reporte del encargo).
 */
function EmployeeAvailabilityTab({
  profileId,
  canEdit,
}: {
  profileId: string
  canEdit: boolean
}) {
  const auth = useAuth()
  const availabilityQuery = useEmployeeAvailabilityQuery(profileId)
  const createSlot = useCreateEmployeeAvailabilityMutation(profileId)
  const deleteSlot = useDeleteEmployeeAvailabilityMutation(profileId)
  const [slotToDelete, setSlotToDelete] =
    useState<EmployeeAvailabilitySlot | null>(null)

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EmployeeAvailabilitySlotFormValues>({
    resolver: zodResolver(employeeAvailabilitySlotSchema),
    defaultValues: { weekday: '1', startTime: '', endTime: '' },
  })

  const slots = availabilityQuery.data ?? []
  const slotsByWeekday = new Map<number, EmployeeAvailabilitySlot[]>()
  for (const slot of slots) {
    const current = slotsByWeekday.get(slot.weekday) ?? []
    current.push(slot)
    slotsByWeekday.set(slot.weekday, current)
  }

  async function onSubmit(values: EmployeeAvailabilitySlotFormValues) {
    try {
      await createSlot.mutateAsync({
        input: employeeAvailabilitySlotFormValuesToInput(values),
        createdBy: auth.userId as string,
      })
      reset({ weekday: values.weekday, startTime: '', endTime: '' })
      toast.success('Agregamos la franja.')
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos agregar la franja.',
      )
    }
  }

  async function handleDelete() {
    if (!slotToDelete) return
    try {
      await deleteSlot.mutateAsync(slotToDelete.id)
      toast.success('Quitamos la franja.')
      setSlotToDelete(null)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos quitar la franja.',
      )
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <form
          noValidate
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:flex-wrap sm:items-end"
        >
          <div className="flex flex-col gap-1">
            <label
              htmlFor="availability-weekday"
              className="text-[10px] font-semibold tracking-wide text-text-3 uppercase"
            >
              Día
            </label>
            <Controller
              control={control}
              name="weekday"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="availability-weekday" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="availability-start"
              className="text-[10px] font-semibold tracking-wide text-text-3 uppercase"
            >
              Desde
            </label>
            <Input
              id="availability-start"
              type="time"
              aria-invalid={Boolean(errors.startTime)}
              {...register('startTime')}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="availability-end"
              className="text-[10px] font-semibold tracking-wide text-text-3 uppercase"
            >
              Hasta
            </label>
            <Input
              id="availability-end"
              type="time"
              aria-invalid={Boolean(errors.endTime)}
              {...register('endTime')}
            />
          </div>
          <Button
            type="submit"
            size="sm"
            icon={Plus}
            loading={createSlot.isPending}
          >
            Agregar
          </Button>
          {(errors.startTime || errors.endTime) && (
            <p className="w-full text-[11px] text-danger">
              {errors.endTime?.message ?? errors.startTime?.message}
            </p>
          )}
        </form>
      )}

      {availabilityQuery.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : slots.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Todavía no hay disponibilidad cargada"
          description="Agregá una franja con el formulario de arriba."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {WEEKDAY_OPTIONS.filter((option) =>
            slotsByWeekday.has(Number(option.value)),
          ).map((option) => (
            <div key={option.value}>
              <h4 className="mb-1 text-[12px] font-semibold text-text">
                {option.label}
              </h4>
              <ul className="flex flex-wrap gap-2">
                {(slotsByWeekday.get(Number(option.value)) ?? []).map(
                  (slot) => (
                    <li
                      key={slot.id}
                      className="flex items-center gap-2 rounded-full border border-border-strong bg-surface px-3 py-1 text-[12px] text-text"
                    >
                      {shortTime(slot.startTime)} – {shortTime(slot.endTime)}
                      {canEdit && (
                        <IconButton
                          icon={X}
                          aria-label={`Quitar franja de ${weekdayLabel(slot.weekday)}, ${shortTime(slot.startTime)} a ${shortTime(slot.endTime)}`}
                          onClick={() => setSlotToDelete(slot)}
                        />
                      )}
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>
      )}

      <SimpleConfirmDialog
        open={slotToDelete != null}
        onOpenChange={(open) => !open && setSlotToDelete(null)}
        title="Quitar franja"
        description={
          slotToDelete
            ? `${weekdayLabel(slotToDelete.weekday)}, de ${shortTime(slotToDelete.startTime)} a ${shortTime(slotToDelete.endTime)}.`
            : undefined
        }
        confirmLabel="Quitar"
        isLoading={deleteSlot.isPending}
        onConfirm={() => void handleDelete()}
      />
    </div>
  )
}

export { EmployeeAvailabilityTab }
