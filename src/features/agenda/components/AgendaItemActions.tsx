import { useState } from 'react'
import { CalendarPlus, CircleCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { AgendaIconButton } from './AgendaIconButton'

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

/** Diálogo de confirmación de «Eliminar» (AG-14), controlado desde afuera. */
function AgendaDeleteDialog({
  item,
  open,
  onOpenChange,
  onDeleted,
}: {
  item: AgendaItem
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted?: () => void
}) {
  const remove = useDeleteAgendaItemMutation()

  function confirm() {
    remove.mutate(item.id, {
      onSuccess: () => {
        onOpenChange(false)
        toast.success('Lo eliminamos.')
        onDeleted?.()
      },
      onError: (error) =>
        toast.error(errorText(error, 'No pudimos eliminarlo.')),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            onClick={() => onOpenChange(false)}
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
      <AgendaDeleteDialog
        item={item}
        open={open}
        onOpenChange={setOpen}
        onDeleted={onDeleted}
      />
    </>
  )
}

/** Acciones de un ítem sin botón propio: las usa el menú ⋮ del popup del día. */
function useAgendaItemActions(item: AgendaItem) {
  const setResolved = useSetAgendaItemResolvedMutation()
  const duplicate = useDuplicateAgendaItemMutation()
  return {
    toggleResolved: () =>
      setResolved.mutate(
        { id: item.id, resolved: !item.resolved },
        {
          onError: (error) =>
            toast.error(errorText(error, 'No pudimos cambiar el estado.')),
        },
      ),
    duplicate: () =>
      duplicate.mutate(item.id, {
        onSuccess: () => toast.success('Lo copiamos al mes siguiente.'),
        onError: (error) =>
          toast.error(errorText(error, 'No pudimos duplicarlo.')),
      }),
  }
}

/**
 * «Resuelto» de las notas (AG-26): el único botón con texto. Activo, tiene el
 * fondo verde de la plataforma.
 */
function AgendaResolvedIconButton({ item }: { item: AgendaItem }) {
  const { toggleResolved } = useAgendaItemActions(item)
  const label = item.resolved ? 'Quitar resuelto' : 'Marcar como resuelto'
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={label}
            aria-pressed={item.resolved}
            onClick={toggleResolved}
            className={cn(
              'h-8 gap-1 px-2.5',
              item.resolved &&
                'border-success bg-success text-white hover:bg-success-800',
            )}
          >
            <CircleCheck aria-hidden="true" />
            Resuelto
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** Duplicar al mes siguiente como ícono (AG-26). */
function AgendaDuplicateIconButton({ item }: { item: AgendaItem }) {
  const { duplicate } = useAgendaItemActions(item)
  return (
    <AgendaIconButton
      icon={CalendarPlus}
      aria-label="Duplicar al mes siguiente"
      onClick={duplicate}
    />
  )
}

/** Eliminar como ícono, con confirmación (AG-26). */
function AgendaDeleteIconButton({ item }: { item: AgendaItem }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <AgendaIconButton
        icon={Trash2}
        aria-label="Eliminar"
        className="size-8 text-danger"
        onClick={() => setOpen(true)}
      />
      <AgendaDeleteDialog item={item} open={open} onOpenChange={setOpen} />
    </>
  )
}

export {
  AgendaResolvedCheck,
  AgendaDuplicateButton,
  AgendaDeleteButton,
  AgendaDeleteDialog,
  AgendaResolvedIconButton,
  AgendaDuplicateIconButton,
  AgendaDeleteIconButton,
  useAgendaItemActions,
}
