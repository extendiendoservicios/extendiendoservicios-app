import { useState } from 'react'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { DatePicker } from '@/components/DatePicker'
import { Field, FieldLabel } from '@/components/ui/field'
import { SimpleConfirmDialog } from '@/features/settings/components/SimpleConfirmDialog'
import { isApiError } from '@/api/errors'
import type { ServiceStatus } from '@/api/services'
import { useAuth } from '@/features/auth/AuthProvider'
import { canGenerateShifts } from '@/features/shifts/permissions'
import { canOwnerDelete } from '@/features/ownerDelete/matching'
import { useOwnerDeleteMutation } from '@/features/ownerDelete/queries'
import {
  formatDateOnly,
  localDateToIsoDate,
} from '@/features/settings/dateOnly'
import {
  defaultDeleteFromDate,
  futureShiftsNotice,
  shiftCleanupMessage,
  statusEffectDescription,
  statusOffersShiftCleanup,
} from '@/features/services/statusShifts'
import { GenerateServiceShiftsDialog } from './GenerateServiceShiftsDialog'
import { SERVICE_STATUS_OPTIONS } from '@/features/services/schemas'
import {
  useServiceShiftsFromCountQuery,
  useSetServiceStatusMutation,
} from '@/features/services/queries'

/**
 * SERVICE-004 (acción "pausar"/"finalizar" de la lista de servicios de
 * ADM-21 y ADM-22): mismo patrón que `ChangeClientStatusDialog`/
 * `ChangeSiteStatusDialog` -- confirmación con la explicación del efecto de
 * cada estado (`06_API.md` sección 6: "Solo `active` genera turnos"), sin
 * motivo obligatorio (no está en la lista de `07_Design_System.md` sección
 * 2.4 que sí lo exige).
 *
 * P31.3 (D-03): al pausar o finalizar, la dirección puede eliminar de una vez
 * los turnos futuros sin historia (casilla marcada por defecto, desde mañana).
 * El administrador solo ve cuántos turnos quedan.
 */
function ChangeServiceStatusDialog({
  service,
  open,
  onOpenChange,
}: {
  service: { id: string; name: string; status: ServiceStatus }
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const auth = useAuth()
  const setServiceStatus = useSetServiceStatusMutation()
  const ownerDelete = useOwnerDeleteMutation()
  const isOwner = canOwnerDelete(auth)
  // D-03: casilla (marcada por defecto) y fecha (mañana) de la limpieza de turnos.
  const [deleteShifts, setDeleteShifts] = useState(true)
  const [deleteFrom, setDeleteFrom] = useState<Date>(
    () => new Date(`${defaultDeleteFromDate()}T00:00:00`),
  )
  // OD-27: al reactivar, se ofrece generar los turnos del mes.
  const [generateFor, setGenerateFor] = useState<{
    serviceId: string
    validFrom: string | null
  } | null>(null)
  const canGenerate = canGenerateShifts({
    roles: auth.roles,
    capabilities: auth.capabilities,
  })
  // El estado actual no se ofrece: elegirlo no cambiaría nada.
  const statusOptions = SERVICE_STATUS_OPTIONS.filter(
    (option) => option.value !== service.status,
  )
  const firstOtherStatus = statusOptions[0]?.value ?? service.status
  const [nextStatus, setNextStatus] = useState<ServiceStatus>(firstOtherStatus)

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setNextStatus(firstOtherStatus)
      setDeleteShifts(true)
      setDeleteFrom(new Date(`${defaultDeleteFromDate()}T00:00:00`))
    }
    onOpenChange(nextOpen)
  }

  const offersCleanup = statusOffersShiftCleanup(nextStatus)
  const showOwnerCleanup = isOwner && offersCleanup
  const deletingShifts = showOwnerCleanup && deleteShifts
  const fromIso = localDateToIsoDate(deleteFrom)
  // Administrador: cuántos turnos quedan (solo la dirección puede eliminarlos).
  const remainingQuery = useServiceShiftsFromCountQuery(
    service.id,
    defaultDeleteFromDate(),
    open && offersCleanup && !isOwner,
  )
  const adminNotice =
    open && offersCleanup && !isOwner
      ? futureShiftsNotice(remainingQuery.data ?? 0)
      : null

  async function handleConfirm() {
    try {
      const updated = await setServiceStatus.mutateAsync({
        id: service.id,
        status: nextStatus,
        updatedBy: auth.userId as string,
      })
      toast.success('Cambiamos el estado del servicio.')
      if (deletingShifts) {
        // Después de cambiar el estado: si esto falla, el estado ya quedó cambiado.
        try {
          const result = await ownerDelete.mutateAsync({
            kind: 'service_shifts',
            id: service.id,
            confirmName: service.name,
            fromDate: fromIso,
          })
          toast.success(shiftCleanupMessage(result))
        } catch (error) {
          toast.error(
            isApiError(error)
              ? `No pudimos eliminar los turnos: ${error.message}`
              : 'No pudimos eliminar los turnos del servicio.',
          )
        }
      }
      if (nextStatus === 'active' && canGenerate) {
        setGenerateFor({ serviceId: updated.id, validFrom: updated.validFrom })
        return
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos cambiar el estado.',
      )
    }
  }

  if (generateFor) {
    return (
      <GenerateServiceShiftsDialog
        serviceId={generateFor.serviceId}
        validFrom={generateFor.validFrom}
        onFinish={() => onOpenChange(false)}
      />
    )
  }

  return (
    <SimpleConfirmDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={`Cambiar estado de "${service.name}"`}
      description={statusEffectDescription(nextStatus, deletingShifts)}
      confirmLabel="Cambiar estado"
      isLoading={setServiceStatus.isPending || ownerDelete.isPending}
      onConfirm={() => void handleConfirm()}
    >
      <Field>
        <FieldLabel htmlFor="service-next-status">Estado nuevo</FieldLabel>
        <Select
          value={nextStatus}
          onValueChange={(value) => setNextStatus(value as ServiceStatus)}
        >
          <SelectTrigger id="service-next-status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {showOwnerCleanup && (
        <div className="flex flex-col gap-2">
          <label
            htmlFor="service-delete-shifts"
            className="flex items-center gap-2 text-[12.5px] text-text-2"
          >
            <Checkbox
              id="service-delete-shifts"
              checked={deleteShifts}
              onCheckedChange={(checked) => setDeleteShifts(checked === true)}
            />
            {`Eliminar los turnos de este servicio desde ${formatDateOnly(fromIso)}`}
          </label>
          {deleteShifts && (
            <Field>
              <FieldLabel>Desde</FieldLabel>
              <DatePicker
                aria-label="Eliminar los turnos desde"
                value={deleteFrom}
                onValueChange={(next) => next && setDeleteFrom(next)}
              />
              <p className="text-[11.5px] text-text-3">
                Los turnos con fichajes, supervisiones u otros registros no se
                eliminan: se te avisa cuántos quedaron.
              </p>
            </Field>
          )}
        </div>
      )}
      {adminNotice && (
        <p role="status" className="text-[12.5px] text-text-2">
          {adminNotice}
        </p>
      )}
    </SimpleConfirmDialog>
  )
}

export { ChangeServiceStatusDialog }
