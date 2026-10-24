import { useState } from 'react'
import { Link } from 'react-router'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Combobox } from '@/components/Combobox'
import { IconButton } from '@/components/IconButton'
import { PersonCell } from '@/components/PersonCell'
import { isApiError } from '@/api/errors'
import { useAuth } from '@/features/auth/AuthProvider'
import { canManageSupervisions } from '@/features/supervisions/permissions'
import {
  preferredSupervisorsOfClient,
  preferredSupervisorsOfSite,
} from '@/features/supervisions/priorities'
import {
  useRemoveSupervisorPriorityMutation,
  useSetSupervisorPriorityMutation,
  useSupervisorCandidatesQuery,
  useSupervisorPrioritiesQuery,
} from '@/features/supervisions/queries'

interface PreferredSupervisorsBlockProps {
  clientId: string
  /** Con `siteId` el bloque es el de la ficha de la sede; sin él, el del cliente. */
  siteId?: string
}

/**
 * Bloque «Coordinadores preferenciales» de la ficha del cliente (ADM-21) y
 * de la sede (ADM-22), P24.3 (CJ-03 y CJ-24). Sirve para ordenar la lista
 * del coordinador, no para restringirlo.
 *
 * - En el cliente: se agrega el cliente entero (cubre todas sus sedes) y se
 *   listan también los que tienen alguna de sus sedes.
 * - En la sede: se agrega la sede; los que llegan por el cliente se listan
 *   aparte y se quitan desde la ficha del cliente.
 *
 * Agregar y quitar piden `manage_supervisions` (el servidor lo vuelve a
 * verificar); sin la capacidad el bloque es de solo lectura.
 */
function PreferredSupervisorsBlock(props: PreferredSupervisorsBlockProps) {
  const { clientId, siteId } = props
  const auth = useAuth()
  const canEdit = canManageSupervisions({
    roles: auth.roles,
    capabilities: auth.capabilities,
  })
  const prioritiesQuery = useSupervisorPrioritiesQuery()
  const candidatesQuery = useSupervisorCandidatesQuery()
  const setPriority = useSetSupervisorPriorityMutation()
  const removePriority = useRemoveSupervisorPriorityMutation()
  const [selectedId, setSelectedId] = useState<string | undefined>()

  const priorities = prioritiesQuery.data ?? []
  const preferred = siteId
    ? preferredSupervisorsOfSite(priorities, siteId, clientId)
    : preferredSupervisorsOfClient(priorities, clientId)

  // En la ficha de la sede no se ofrece a quien ya la tiene (por la sede o por el cliente); en
  // la del cliente, a quien ya tiene el cliente entero.
  const alreadyIds = new Set(
    preferred
      .filter((item) => (siteId ? true : item.scope === 'client'))
      .map((item) => item.supervisorId),
  )
  const candidateChoices = (candidatesQuery.data ?? [])
    .filter((candidate) => !alreadyIds.has(candidate.profileId))
    .map((candidate) => ({
      value: candidate.profileId,
      label: `${candidate.firstName} ${candidate.lastName}`,
    }))

  async function handleAdd() {
    if (!selectedId) return
    try {
      await setPriority.mutateAsync({
        supervisorId: selectedId,
        ...(siteId ? { siteId } : { clientId }),
      })
      toast.success('Agregamos al coordinador como preferencial.')
      setSelectedId(undefined)
    } catch (error) {
      toast.error(
        isApiError(error)
          ? error.message
          : 'No pudimos agregar al coordinador.',
      )
    }
  }

  async function handleRemove(priorityId: string, name: string) {
    try {
      await removePriority.mutateAsync(priorityId)
      toast.success(`Quitamos a ${name} de los preferenciales.`)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos quitar al coordinador.',
      )
    }
  }

  return (
    <section
      aria-labelledby="preferred-supervisors-title"
      className="rounded-lg border border-border bg-surface p-5"
    >
      <h3
        id="preferred-supervisors-title"
        className="text-[13px] font-semibold text-text"
      >
        Coordinadores preferenciales
      </h3>
      <p className="mt-1 mb-3 text-[12px] text-text-3">
        {siteId
          ? 'Ven esta sede primero en su lista, pero cualquier coordinador puede tomar sus turnos.'
          : 'Ven las sedes de este cliente primero en su lista, pero cualquier coordinador puede tomar sus turnos.'}
      </p>

      {prioritiesQuery.isLoading ? (
        <Skeleton className="h-12" />
      ) : preferred.length === 0 ? (
        <p className="text-[12px] text-text-3">
          Todavía no hay coordinadores preferenciales.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {preferred.map((item) => {
            const detail = item.inherited
              ? 'Por el cliente entero'
              : item.scope === 'client'
                ? 'Cliente entero, todas sus sedes'
                : siteId
                  ? 'Esta sede'
                  : `Sede ${item.siteName ?? ''}`.trim()
            return (
              <li
                key={item.priorityId}
                className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
              >
                <Link
                  to={`/admin/empleados/${item.supervisorId}`}
                  className="min-w-0 hover:text-primary-800"
                >
                  <PersonCell
                    id={item.supervisorId}
                    name={item.supervisorName}
                    subtitle={detail}
                  />
                </Link>
                {canEdit && !item.inherited && (
                  <IconButton
                    icon={X}
                    aria-label={`Quitar a ${item.supervisorName}`}
                    disabled={removePriority.isPending}
                    onClick={() =>
                      void handleRemove(item.priorityId, item.supervisorName)
                    }
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {canEdit && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Combobox
            aria-label="Elegir coordinador preferencial"
            className="sm:w-72"
            options={candidateChoices}
            value={selectedId}
            onValueChange={setSelectedId}
            placeholder="Elegí un coordinador…"
            searchPlaceholder="Buscar coordinador…"
            emptyText="No hay coordinadores para agregar."
          />
          <Button
            type="button"
            size="sm"
            icon={Plus}
            disabled={!selectedId}
            loading={setPriority.isPending}
            onClick={() => void handleAdd()}
          >
            Agregar
          </Button>
        </div>
      )}
    </section>
  )
}

export { PreferredSupervisorsBlock }
