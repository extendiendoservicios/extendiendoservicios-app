import { toast } from 'sonner'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isApiError } from '@/api/errors'
import { useAuth } from '@/features/auth/AuthProvider'
import { CLIENT_COLORS } from '@/features/planning/clientColors'
import { useSetClientCalendarColorMutation } from '@/features/planning/queries'

/**
 * D-05 (P31.3): el color de un turno es el de su cliente, una sola fuente para
 * todos los calendarios. «Cambiar color del cliente» (en el menú ⋮ de la
 * tarjeta del mes y de la pizarra) elige un color y pide confirmación antes de
 * cambiarlo para todos.
 */

export interface ClientColorRequest {
  clientId: string
  clientName: string
  colorIndex: number
}

/** Submenú «Cambiar color del cliente»: elegir un color abre la confirmación. */
function ClientColorSubmenu({
  clientId,
  clientName,
  currentIndex,
  onRequest,
}: {
  clientId: string
  clientName: string
  currentIndex: number | null
  onRequest: (request: ClientColorRequest) => void
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>Cambiar color del cliente</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {CLIENT_COLORS.map((color) => (
          <DropdownMenuItem
            key={color.index}
            disabled={color.index === (currentIndex ?? 0)}
            onSelect={() =>
              onRequest({ clientId, clientName, colorIndex: color.index })
            }
          >
            <span
              aria-hidden
              className="inline-block size-3 rounded-full"
              style={{ backgroundColor: color.hex }}
            />
            {color.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/** Confirmación: «Cambia el color de RAESA en todos los calendarios.» */
function ClientColorConfirmDialog({
  request,
  onClose,
}: {
  request: ClientColorRequest | null
  onClose: () => void
}) {
  // Los hooks (sesión y mutación) solo se montan con un pedido abierto.
  return request ? (
    <ClientColorConfirmContent request={request} onClose={onClose} />
  ) : null
}

function ClientColorConfirmContent({
  request,
  onClose,
}: {
  request: ClientColorRequest
  onClose: () => void
}) {
  const auth = useAuth()
  const mutation = useSetClientCalendarColorMutation()
  const colorName =
    CLIENT_COLORS.find((color) => color.index === request.colorIndex)?.name ??
    ''

  async function confirm() {
    try {
      await mutation.mutateAsync({
        clientId: request.clientId,
        calendarColor: request.colorIndex,
        updatedBy: auth.userId as string,
      })
      toast.success(`Cambiamos el color de ${request.clientName}.`)
      onClose()
    } catch (error) {
      toast.error(
        isApiError(error)
          ? error.message
          : 'No pudimos cambiar el color del cliente.',
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
          <DialogTitle>Cambiar color del cliente</DialogTitle>
          <DialogDescription>
            Cambia el color de {request.clientName} en todos los calendarios.
            {colorName ? ` Color nuevo: ${colorName}.` : ''}
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
            Cambiar color
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { ClientColorConfirmDialog, ClientColorSubmenu }
