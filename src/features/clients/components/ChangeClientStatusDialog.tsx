import { useState } from 'react'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Field, FieldLabel } from '@/components/ui/field'
import { SimpleConfirmDialog } from '@/features/settings/components/SimpleConfirmDialog'
import { isApiError } from '@/api/errors'
import type { ClientDetail, ClientStatus } from '@/api/clients'
import { CLIENT_STATUS_OPTIONS } from '@/features/clients/schemas'
import { useSetClientStatusMutation } from '@/features/clients/queries'
import { useAuth } from '@/features/auth/AuthProvider'

/**
 * CLIENT-006 (`05` línea 75, acción "cambiar estado" de ADM-21): confirmación
 * con la explicación del efecto de cada estado (`06_API.md` sección 4:
 * "Pasar a suspended o closed no toca turnos existentes; generate_shifts y
 * create_shift rechazan clientes no activos"). No pide motivo obligatorio:
 * "cambiar estado del cliente" no está en la lista de `07` sección 2.4 que sí
 * lo exige (cancelar turno, quitar asignación, cerrar asignación, registrar
 * en nombre de) -- se reutiliza `SimpleConfirmDialog`
 * (`src/features/settings/components/SimpleConfirmDialog.tsx`), no
 * `ConfirmDialog`.
 */
const STATUS_EFFECT_DESCRIPTION: Record<ClientStatus, string> = {
  active:
    'El cliente vuelve a admitir turnos nuevos. Los turnos y las asignaciones ya generados no cambian.',
  suspended:
    'Los turnos ya generados no se tocan, pero no se van a poder generar ni crear turnos nuevos mientras esté suspendido.',
  closed:
    'El cliente queda dado de baja. Los turnos ya generados no se tocan, pero no se van a poder generar ni crear turnos nuevos hasta que vuelva a estar activo.',
}

function ChangeClientStatusDialog({
  client,
  open,
  onOpenChange,
}: {
  client: ClientDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const auth = useAuth()
  const setClientStatus = useSetClientStatusMutation()
  // El estado actual no se ofrece: elegirlo no cambiaría nada.
  const statusOptions = CLIENT_STATUS_OPTIONS.filter(
    (option) => option.value !== client.status,
  )
  const firstOtherStatus = statusOptions[0]?.value ?? client.status
  const [nextStatus, setNextStatus] = useState<ClientStatus>(firstOtherStatus)

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setNextStatus(firstOtherStatus)
    }
    onOpenChange(nextOpen)
  }

  async function handleConfirm() {
    try {
      await setClientStatus.mutateAsync({
        id: client.id,
        status: nextStatus,
        updatedBy: auth.userId as string,
      })
      toast.success('Cambiamos el estado del cliente.')
      onOpenChange(false)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos cambiar el estado.',
      )
    }
  }

  return (
    <SimpleConfirmDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Cambiar estado del cliente"
      description={STATUS_EFFECT_DESCRIPTION[nextStatus]}
      confirmLabel="Cambiar estado"
      isLoading={setClientStatus.isPending}
      onConfirm={() => void handleConfirm()}
    >
      <Field>
        <FieldLabel htmlFor="client-next-status">Estado nuevo</FieldLabel>
        <Select
          value={nextStatus}
          onValueChange={(value) => setNextStatus(value as ClientStatus)}
        >
          <SelectTrigger id="client-next-status" className="w-full">
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
    </SimpleConfirmDialog>
  )
}

export { ChangeClientStatusDialog }
