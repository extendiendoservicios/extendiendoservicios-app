import { useState } from 'react'
import { toast } from 'sonner'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { isApiError } from '@/api/errors'
import {
  isAuthDeleteFailed,
  type OwnerDeleteKind,
  type OwnerDeleteResult,
} from '@/api/ownerDelete'
import { formatDateOnly } from '@/features/settings/dateOnly'
import {
  useOwnerDeleteMutation,
  useOwnerDeletePreviewQuery,
} from '@/features/ownerDelete/queries'
import {
  confirmNameMatches,
  describeItem,
} from '@/features/ownerDelete/matching'

/** Cuántos turnos salteados se listan como máximo. */
const MAX_SKIPPED_SHOWN = 8

/** Cómo se llama lo que se borra, para el título y el aviso de éxito. */
const KIND_LABELS: Record<OwnerDeleteKind, string> = {
  shift: 'el turno',
  service: 'el servicio',
  service_shifts: 'los turnos sin historia del servicio',
  site: 'la sede',
  client: 'el cliente',
  employee: 'el empleado',
}

/**
 * OD-22 y OD-23: diálogo de borrado físico, solo del dueño (quien lo muestra
 * decide con `canOwnerDelete`; el servidor lo vuelve a verificar). Siempre
 * consulta primero la vista previa: dice que es irreversible y que puede
 * alterar registros, lista lo que se borra y, si hay bloqueos, muestra cada
 * mensaje y no deja confirmar. Para confirmar hay que escribir el nombre (el
 * turno no lo pide). Si Auth falla al borrar un empleado, ofrece reintentar.
 */
function OwnerDeleteDialog({
  kind,
  id,
  open,
  onOpenChange,
  onDeleted,
  fromDate,
}: {
  kind: OwnerDeleteKind
  id: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Se llama después de borrar (para navegar al listado, por ejemplo). */
  onDeleted?: (result: OwnerDeleteResult) => void
  /** Solo para `service_shifts`: desde qué fecha (AAAA-MM-DD). */
  fromDate?: string
}) {
  const previewQuery = useOwnerDeletePreviewQuery(kind, id, {
    enabled: open,
    fromDate,
  })
  const deleteMutation = useOwnerDeleteMutation()
  const [typedName, setTypedName] = useState('')
  const [authFailed, setAuthFailed] = useState(false)
  const preview = previewQuery.data

  const needsName = kind !== 'shift'
  const blocked = preview != null && preview.blockers.length > 0
  const nothingToDelete = preview != null && !blocked && !preview.canDelete
  const canConfirm =
    preview != null &&
    preview.canDelete &&
    !blocked &&
    confirmNameMatches(kind, preview, typedName)

  function handleOpenChange(next: boolean) {
    if (!next) {
      setTypedName('')
      setAuthFailed(false)
      deleteMutation.reset()
    }
    onOpenChange(next)
  }

  async function handleConfirm() {
    if (!preview) {
      return
    }
    try {
      const result = await deleteMutation.mutateAsync({
        kind,
        id,
        confirmName: typedName,
        fromDate,
      })
      toast.success(successMessage(kind, preview.name, result))
      handleOpenChange(false)
      onDeleted?.(result)
    } catch (error) {
      if (isAuthDeleteFailed(error)) {
        setAuthFailed(true)
      }
      // El mensaje del servidor se muestra tal cual, debajo.
    }
  }

  const error = deleteMutation.error
  const skippedShown = preview?.skipped.slice(0, MAX_SKIPPED_SHOWN) ?? []
  const skippedHidden = (preview?.skipped.length ?? 0) - skippedShown.length

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Eliminar ${KIND_LABELS[kind]}${
            preview ? ` «${preview.name}»` : ''
          }`}</DialogTitle>
          <DialogDescription>
            Es irreversible: se borra de verdad y no se puede recuperar. Puede
            alterar registros relacionados.
          </DialogDescription>
        </DialogHeader>

        {previewQuery.isLoading && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6" />
            <Skeleton className="h-6" />
          </div>
        )}

        {previewQuery.isError && (
          <p role="alert" className="text-[12.5px] text-danger">
            {isApiError(previewQuery.error)
              ? previewQuery.error.message
              : 'No pudimos revisar qué se va a eliminar.'}
          </p>
        )}

        {blocked && (
          <Alert variant="crit">
            <TriangleAlert aria-hidden="true" />
            <AlertDescription>
              <p className="font-semibold">No se puede eliminar todavía.</p>
              <ul className="mt-1 list-disc pl-4">
                {preview.blockers.map((blocker) => (
                  <li key={blocker.code}>{blocker.message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {nothingToDelete && (
          <p className="text-[12.5px] text-text-2">
            No hay nada para eliminar con esos datos.
          </p>
        )}

        {preview && !blocked && preview.willDelete.length > 0 && (
          <div className="flex flex-col gap-1 text-[12.5px] text-text-2">
            <p className="font-semibold text-text">Se va a eliminar:</p>
            <ul className="list-disc pl-4">
              {preview.willDelete.map((item) => (
                <li key={item.code}>{describeItem(item)}</li>
              ))}
            </ul>
          </div>
        )}

        {preview && preview.skipped.length > 0 && (
          <div className="flex flex-col gap-1 text-[12.5px] text-text-2">
            <p className="font-semibold text-text">
              {`Se saltean ${preview.skipped.length} ${
                preview.skipped.length === 1
                  ? 'turno con historia'
                  : 'turnos con historia'
              }:`}
            </p>
            <ul className="list-disc pl-4">
              {skippedShown.map((item) => (
                <li key={item.shiftId}>
                  {`${formatDateOnly(item.shiftDate)}: ${item.message}`}
                </li>
              ))}
            </ul>
            {skippedHidden > 0 && <p>{`y ${skippedHidden} más.`}</p>}
          </div>
        )}

        {preview && !blocked && preview.canDelete && needsName && (
          <Field>
            <FieldLabel htmlFor="owner-delete-name">
              {`Para confirmar, escribí «${preview.name}»`}
            </FieldLabel>
            <Input
              id="owner-delete-name"
              autoComplete="off"
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              disabled={deleteMutation.isPending}
            />
          </Field>
        )}

        {error && (
          <p role="alert" className="text-[12.5px] text-danger">
            {isApiError(error) ? error.message : 'No pudimos eliminarlo.'}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={deleteMutation.isPending}
          >
            Cancelar
          </Button>
          {preview && !blocked && preview.canDelete && (
            <Button
              type="button"
              variant="destructive"
              loading={deleteMutation.isPending}
              disabled={!canConfirm}
              onClick={() => void handleConfirm()}
            >
              {authFailed ? 'Reintentar' : 'Eliminar'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Texto del aviso de éxito, con los conteos de lo que se borró. */
export function successMessage(
  kind: OwnerDeleteKind,
  name: string,
  result: OwnerDeleteResult,
): string {
  if (kind === 'service_shifts') {
    const deleted = result.deleted.shifts ?? 0
    const skipped = result.skippedCount
    return `Eliminamos ${deleted} ${deleted === 1 ? 'turno' : 'turnos'}${
      skipped > 0 ? ` y salteamos ${skipped} con historia` : ''
    }.`
  }
  return `Eliminamos ${KIND_LABELS[kind]} «${name}».`
}

export { OwnerDeleteDialog }
