import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

/**
 * ConfirmDialog (DS-010): diálogo de confirmación con motivo obligatorio
 * (`07` sección 2.4 — "cancelar turno, quitar asignación, cerrar
 * asignación", reutilizado por SHIFT-011 y otras tareas de front-admin). El
 * botón de confirmar queda deshabilitado mientras el motivo esté vacío; al
 * confirmar, se devuelve el motivo ya recortado (`trim()`).
 *
 * No llama a ninguna API: `onConfirm` es un callback. Si la acción es
 * asíncrona, el que lo usa controla `isLoading` (deshabilita el formulario y
 * muestra el spinner del botón) y cierra el diálogo (`onOpenChange(false)`)
 * cuando la RPC termina bien — así se puede mantener abierto si falla.
 */
interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  /** Etiqueta del campo de motivo. Default: "Motivo". */
  reasonLabel?: string
  reasonPlaceholder?: string
  /** Default: "Cancelar". */
  cancelLabel?: string
  /** Default: "Confirmar". */
  confirmLabel?: string
  /** `destructive` para acciones que sacan o cancelan algo. Default: `primary`. */
  variant?: 'primary' | 'destructive'
  /** Deshabilita el formulario y muestra el spinner mientras se resuelve la RPC. */
  isLoading?: boolean
  onConfirm: (reason: string) => void
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  reasonLabel = 'Motivo',
  reasonPlaceholder,
  cancelLabel = 'Cancelar',
  confirmLabel = 'Confirmar',
  variant = 'primary',
  isLoading = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [reason, setReason] = React.useState('')
  const reasonId = React.useId()

  // Empieza en blanco cada vez que se abre (no arrastra el motivo de la
  // última vez que se usó este mismo diálogo). Ajuste de estado durante el
  // render (patrón recomendado por React para "resetear estado cuando
  // cambia una prop"), no un efecto: evita el repintado extra de
  // `useEffect` + `setState`.
  const [wasOpen, setWasOpen] = React.useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setReason('')
    }
  }

  const trimmedReason = reason.trim()
  const isConfirmDisabled = trimmedReason.length === 0 || isLoading

  function handleConfirm() {
    if (isConfirmDisabled) {
      return
    }
    onConfirm(trimmedReason)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="flex flex-col gap-[5px]">
          <label
            htmlFor={reasonId}
            className="text-[11px] font-semibold text-text-2"
          >
            {reasonLabel}
          </label>
          <Textarea
            id={reasonId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={reasonPlaceholder}
            rows={3}
            disabled={isLoading}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant}
            onClick={handleConfirm}
            disabled={isConfirmDisabled}
            loading={isLoading}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { ConfirmDialog }
export type { ConfirmDialogProps }
