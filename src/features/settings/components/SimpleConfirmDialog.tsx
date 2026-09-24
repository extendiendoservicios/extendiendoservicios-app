import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * Confirmación simple, sin motivo obligatorio (a diferencia de
 * `ConfirmDialog`, `src/components/ConfirmDialog.tsx`): para acciones de
 * este dominio que no están en la lista de `07_Design_System.md` sección 2.4
 * que sí lo exige (dar de baja un feriado, cerrar un criterio de
 * calificación). Local a `features/settings` porque, a diferencia de
 * `ConfirmDialog`, todavía no hace falta en ningún otro dominio -- si una
 * segunda pantalla la necesitara, conviene subirla a `src/components/`.
 */
function SimpleConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  isLoading = false,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  isLoading?: boolean
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            {cancelLabel}
          </Button>
          <Button type="button" loading={isLoading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { SimpleConfirmDialog }
