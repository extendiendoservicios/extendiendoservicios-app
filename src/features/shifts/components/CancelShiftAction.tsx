import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/AuthProvider'
import { planningKeys } from '@/features/planning/queries'
import { canCancelShift, isShiftCancellable } from '../permissions'
import { CancelShiftDialog } from './CancelShiftDialog'

/**
 * Acción «Cancelar turno» del detalle (ADM-06, `05` línea 40: `cancel_shift`).
 * Mismo diálogo, misma capacidad (`cancel_shifts`) y mismos estados que la
 * lista del día (ADM-05); si no corresponde, no se muestra. Al cancelar,
 * refresca el detalle (`planningKeys`) además de lo que ya invalida la mutación.
 */
interface CancelShiftActionProps {
  shift: { id: string; shiftDate: string; status: string }
}

function CancelShiftAction({ shift }: CancelShiftActionProps) {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  if (
    !canCancelShift({ roles: auth.roles, capabilities: auth.capabilities }) ||
    !isShiftCancellable(shift.status)
  ) {
    return null
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon={Ban}
        onClick={() => setOpen(true)}
      >
        Cancelar turno
      </Button>
      <CancelShiftDialog
        shiftId={shift.id}
        shiftDate={shift.shiftDate}
        open={open}
        onOpenChange={setOpen}
        onCancelled={() =>
          void queryClient.invalidateQueries({ queryKey: planningKeys.all })
        }
      />
    </>
  )
}

export { CancelShiftAction }
