import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { FixedGap } from '@/api/employeeFixed'
import { isApiError } from '@/api/errors'
import {
  fetchServiceFixedEmployees,
  setServiceFixedEmployees,
} from '@/api/services'
import { employeesKeys } from '@/features/employees/queries'
import { planningKeys } from '@/features/planning/queries'
import { servicesKeys } from '@/features/services/queries'

/**
 * P31.7: «Quitar de fijos del servicio» desde la tarjeta punteada. Saca a la
 * persona de `service_fixed_employees` de ese servicio (lee la lista actual y
 * la vuelve a guardar sin ella). No toca los turnos ya generados: las tarjetas
 * punteadas de ese servicio dejan de aparecer porque ya no es fija.
 */
function RemoveFixedDialog({
  gap,
  profileId,
  personName,
  onClose,
}: {
  gap: FixedGap | null
  profileId: string
  personName: string
  onClose: () => void
}) {
  return gap ? (
    <RemoveFixedContent
      gap={gap}
      profileId={profileId}
      personName={personName}
      onClose={onClose}
    />
  ) : null
}

function RemoveFixedContent({
  gap,
  profileId,
  personName,
  onClose,
}: {
  gap: FixedGap
  profileId: string
  personName: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async () => {
      const current = await fetchServiceFixedEmployees(gap.serviceId)
      return setServiceFixedEmployees(
        gap.serviceId,
        current.filter((id) => id !== profileId),
      )
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: planningKeys.all })
      void queryClient.invalidateQueries({ queryKey: employeesKeys.all })
      void queryClient.invalidateQueries({ queryKey: servicesKeys.all })
    },
  })

  async function confirm() {
    try {
      await mutation.mutateAsync()
      toast.success(
        `${personName} ya no está entre los fijos de ${gap.serviceName}.`,
      )
      onClose()
    } catch (error) {
      toast.error(
        isApiError(error)
          ? error.message
          : 'No pudimos quitar a la persona de los fijos del servicio.',
      )
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) {
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quitar de fijos del servicio</DialogTitle>
          <DialogDescription>
            {personName} deja de estar entre los fijos de «{gap.serviceName}» (
            {gap.siteName}). Los turnos que ya tiene asignados no cambian y
            dejan de aparecer los avisos de ese servicio en su calendario. Los
            turnos sin cubrir hay que asignarlos a otra persona.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={mutation.isPending}
            onClick={onClose}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            loading={mutation.isPending}
            onClick={() => void confirm()}
          >
            Quitar de fijos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { RemoveFixedDialog }
