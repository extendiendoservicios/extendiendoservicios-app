import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/AuthProvider'
import { OwnerDeleteDialog } from '@/features/ownerDelete/components/OwnerDeleteDialog'
import { canOwnerDelete } from '@/features/ownerDelete/matching'

/**
 * OD-22: «Eliminar» el turno, solo para el dueño. Va debajo del detalle del
 * turno (ADM-06). Si el turno tiene historia (fichajes, supervisiones,
 * calificaciones, evidencia, tareas hechas, stock o faltantes), el diálogo lo
 * dice y no deja confirmar. El turno no pide escribir el nombre.
 */
function DeleteShiftAction({
  shiftId,
  onDeleted,
}: {
  shiftId: string
  onDeleted: () => void
}) {
  const auth = useAuth()
  const [open, setOpen] = useState(false)

  if (!canOwnerDelete(auth)) {
    return null
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        icon={Trash2}
        className="text-danger"
        onClick={() => setOpen(true)}
      >
        Eliminar turno
      </Button>
      {open && (
        <OwnerDeleteDialog
          kind="shift"
          id={shiftId}
          open={open}
          onOpenChange={setOpen}
          onDeleted={onDeleted}
        />
      )}
    </div>
  )
}

export { DeleteShiftAction }
