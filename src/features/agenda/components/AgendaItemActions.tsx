import { useState } from 'react'
import { CalendarPlus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isApiError } from '@/api/errors'
import type { AgendaItem } from '@/api/agenda'
import {
  useDeleteAgendaItemMutation,
  useDuplicateAgendaItemMutation,
  useSetAgendaItemResolvedMutation,
} from '../queries'

function errorText(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback
}

/** Check «Resuelto»: al tildar, el servidor pone el verde (AG-12). */
function AgendaResolvedCheck({ item }: { item: AgendaItem }) {
  const setResolved = useSetAgendaItemResolvedMutation()
  const id = `agenda-resolved-${item.id}`
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={item.resolved}
        disabled={setResolved.isPending}
        onCheckedChange={(checked) =>
          setResolved.mutate(
            { id: item.id, resolved: checked === true },
            {
              onError: (error) =>
                toast.error(errorText(error, 'No pudimos cambiar el estado.')),
            },
          )
        }
      />
      <label htmlFor={id} className="text-[12.5px] text-text">
        Resuelto
      </label>
    </div>
  )
}

/** «Duplicar al mes siguiente» (AG-13): la copia sale sin resolver. */
function AgendaDuplicateButton({ item }: { item: AgendaItem }) {
  const duplicate = useDuplicateAgendaItemMutation()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      icon={CalendarPlus}
      loading={duplicate.isPending}
      onClick={() =>
        duplicate.mutate(item.id, {
          onSuccess: () => toast.success('Lo copiamos al mes siguiente.'),
          onError: (error) =>
            toast.error(errorText(error, 'No pudimos duplicarlo.')),
        })
      }
    >
      Duplicar al mes siguiente
    </Button>
  )
}

/** «Eliminar» con confirmación (AG-14): borra de forma definitiva. */
function AgendaDeleteButton({
  item,
  onDeleted,
}: {
  item: AgendaItem
  onDeleted?: () => void
}) {
  const [open, setOpen] = useState(false)
  const remove = useDeleteAgendaItemMutation()

  function confirm() {
    remove.mutate(item.id, {
      onSuccess: () => {
        setOpen(false)
        toast.success('Lo eliminamos.')
        onDeleted?.()
      },
      onError: (error) =>
        toast.error(errorText(error, 'No pudimos eliminarlo.')),
    })
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        icon={Trash2}
        className="text-danger"
        onClick={() => setOpen(true)}
      >
        Eliminar
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar de la agenda?</DialogTitle>
            <DialogDescription>
              Se borra de forma definitiva y no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Volver
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={remove.isPending}
              onClick={confirm}
            >
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export { AgendaResolvedCheck, AgendaDuplicateButton, AgendaDeleteButton }
