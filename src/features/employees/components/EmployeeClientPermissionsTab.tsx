import { useState } from 'react'
import { toast } from 'sonner'
import { Plus, ShieldCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/IconButton'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EmptyState } from '@/components/EmptyState'
import { SimpleConfirmDialog } from '@/features/settings/components/SimpleConfirmDialog'
import { isApiError } from '@/api/errors'
import { useAuth } from '@/features/auth/AuthProvider'
import { useClientFilterOptionsQuery } from '@/features/sites/queries'
import {
  useAddEmployeeClientPermissionMutation,
  useEmployeeClientPermissionsForQuery,
  useRemoveEmployeeClientPermissionMutation,
} from '@/features/employees/queries'

/**
 * EMP-006, pestaña "Habilitaciones" de ADM-17 (P-034): clientes para los
 * que esta persona puede asignarse a un turno. Sin capacidad extra: la
 * verificación de "puede editar" la hace la pantalla que la usa
 * (`canEditEmployee`, `06` sección 3: "Habilitaciones | O, A").
 */
function EmployeeClientPermissionsTab({
  profileId,
  canEdit,
}: {
  profileId: string
  canEdit: boolean
}) {
  const auth = useAuth()
  const permissionsQuery = useEmployeeClientPermissionsForQuery(profileId)
  const clientOptionsQuery = useClientFilterOptionsQuery()
  const addPermission = useAddEmployeeClientPermissionMutation(profileId)
  const removePermission = useRemoveEmployeeClientPermissionMutation(profileId)

  const [selectedClientId, setSelectedClientId] = useState('')
  const [clientToRemove, setClientToRemove] = useState<{
    id: string
    name: string
  } | null>(null)

  const permissions = permissionsQuery.data ?? []
  const enabledClientIds = new Set(permissions.map((p) => p.clientId))
  const availableClientOptions = (clientOptionsQuery.data ?? []).filter(
    (option) => !enabledClientIds.has(option.id),
  )

  async function handleAdd() {
    if (!selectedClientId) return
    try {
      await addPermission.mutateAsync({
        clientId: selectedClientId,
        createdBy: auth.userId as string,
      })
      setSelectedClientId('')
      toast.success('Agregamos la habilitación.')
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos agregar el cliente.',
      )
    }
  }

  async function handleRemove() {
    if (!clientToRemove) return
    try {
      await removePermission.mutateAsync(clientToRemove.id)
      toast.success(`Quitamos la habilitación para ${clientToRemove.name}.`)
      setClientToRemove(null)
    } catch (error) {
      toast.error(
        isApiError(error)
          ? error.message
          : 'No pudimos quitar la habilitación.',
      )
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-lg border border-border bg-surface-2 p-3 text-[12px] text-text-2">
        Si no habilitás a ningún cliente en particular, esta persona queda
        habilitada para asignarse a turnos de cualquier cliente. Habilitá
        clientes puntuales solo si querés restringirla a algunos.
      </p>

      {canEdit && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Select value={selectedClientId} onValueChange={setSelectedClientId}>
            <SelectTrigger
              aria-label="Elegir cliente a habilitar"
              className="w-full sm:w-64"
            >
              <SelectValue placeholder="Elegí un cliente…" />
            </SelectTrigger>
            <SelectContent>
              {availableClientOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            icon={Plus}
            disabled={!selectedClientId}
            loading={addPermission.isPending}
            onClick={() => void handleAdd()}
          >
            Habilitar
          </Button>
        </div>
      )}

      {permissionsQuery.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : permissions.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="Sin restricciones cargadas"
          description="Esta persona está habilitada para todos los clientes."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {permissions.map((permission) => (
            <li
              key={permission.clientId}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3"
            >
              <span className="text-[12.5px] text-text">
                {permission.clientName}
              </span>
              {canEdit && (
                <IconButton
                  icon={X}
                  aria-label={`Quitar habilitación para ${permission.clientName}`}
                  onClick={() =>
                    setClientToRemove({
                      id: permission.clientId,
                      name: permission.clientName,
                    })
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <SimpleConfirmDialog
        open={clientToRemove != null}
        onOpenChange={(open) => !open && setClientToRemove(null)}
        title="Quitar habilitación"
        description={
          clientToRemove
            ? permissions.length === 1
              ? `Esta era la última habilitación cargada: al quitarla, esta persona vuelve a estar habilitada para todos los clientes.`
              : `Esta persona ya no va a estar habilitada para asignarse a turnos de ${clientToRemove.name}.`
            : undefined
        }
        confirmLabel="Quitar"
        isLoading={removePermission.isPending}
        onConfirm={() => void handleRemove()}
      />
    </div>
  )
}

export { EmployeeClientPermissionsTab }
