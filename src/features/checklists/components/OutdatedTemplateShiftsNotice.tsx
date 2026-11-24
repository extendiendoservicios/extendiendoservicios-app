import { useState } from 'react'
import { toast } from 'sonner'
import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { isApiError } from '@/api/errors'
import {
  useOutdatedTemplateShiftsCountQuery,
  useReloadTemplateShiftTasksMutation,
} from '@/features/checklists/queries'
import { SimpleConfirmDialog } from '@/features/settings/components/SimpleConfirmDialog'

export function turnosProximos(count: number): string {
  return count === 1 ? '1 turno próximo' : `${count} turnos próximos`
}

/**
 * D-03 (P32): aviso de turnos próximos con tareas distintas a la plantilla y
 * botón «Actualizar turnos» (recarga en lote, con confirmación). Solo lo ve
 * quien puede editar (la RPC exige `edit_checklists`) y solo si hay turnos.
 */
function OutdatedTemplateShiftsNotice({
  clientId,
  siteId,
  canEdit,
}: {
  clientId: string
  siteId: string | null
  canEdit: boolean
}) {
  const [open, setOpen] = useState(false)
  const countQuery = useOutdatedTemplateShiftsCountQuery(
    clientId,
    siteId,
    canEdit,
  )
  const reload = useReloadTemplateShiftTasksMutation()
  const count = countQuery.data ?? 0

  if (!canEdit || count <= 0) {
    return null
  }

  async function handleConfirm() {
    try {
      const updated = await reload.mutateAsync({ clientId, siteId })
      toast.success(
        updated === 1
          ? 'Actualizamos 1 turno.'
          : `Actualizamos ${updated} turnos.`,
      )
      setOpen(false)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos actualizar los turnos.',
      )
    }
  }

  return (
    <>
      <Alert variant="warn">
        <TriangleAlert />
        <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
          <AlertDescription>
            Hay {turnosProximos(count)} con tareas distintas a esta plantilla.
          </AlertDescription>
          <Button size="sm" onClick={() => setOpen(true)}>
            Actualizar turnos
          </Button>
        </div>
      </Alert>
      <SimpleConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Actualizar los turnos con la plantilla"
        description={`Vamos a reemplazar las tareas de ${turnosProximos(count)} por las de esta plantilla. Los turnos en curso, finalizados o cancelados, y los que ya tienen tareas marcadas, no cambian.`}
        confirmLabel="Actualizar turnos"
        isLoading={reload.isPending}
        onConfirm={() => void handleConfirm()}
      />
    </>
  )
}

export { OutdatedTemplateShiftsNotice }
