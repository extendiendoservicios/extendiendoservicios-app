import { useState } from 'react'
import { Link } from 'react-router'
import { Building2, MapPin, Plus, Star, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Combobox } from '@/components/Combobox'
import { EmptyState } from '@/components/EmptyState'
import { IconButton } from '@/components/IconButton'
import { SegmentedControl } from '@/components/SegmentedControl'
import { isApiError } from '@/api/errors'
import { useClientFilterOptionsQuery } from '@/features/sites/queries'
import { prioritiesOfSupervisor } from '@/features/supervisions/priorities'
import {
  useRemoveSupervisorPriorityMutation,
  useSetSupervisorPriorityMutation,
  useSiteOptionsQuery,
  useSupervisorPrioritiesQuery,
} from '@/features/supervisions/queries'

type Target = 'client' | 'site'

const TARGET_OPTIONS = [
  { value: 'client', label: 'Cliente entero' },
  { value: 'site', label: 'Una sede' },
] as const

interface SupervisorPrioritiesTabProps {
  /** `profile_id` del coordinador. */
  profileId: string
  /** `manage_supervisions` (dueño o administrador con la capacidad). */
  canEdit: boolean
}

/**
 * Pestaña «Clientes y sedes preferenciales» de ADM-16 (P24.3, CJ-03 y
 * CJ-24). Sirven para ordenar la lista del coordinador («Mis sedes» primero),
 * no para restringir: puede tomar cualquier turno. Un cliente cubre todas
 * sus sedes, también las que se creen después. Alta con
 * `set_supervisor_priority` y baja lógica con `remove_supervisor_priority`.
 */
function SupervisorPrioritiesTab({
  profileId,
  canEdit,
}: SupervisorPrioritiesTabProps) {
  const prioritiesQuery = useSupervisorPrioritiesQuery()
  const clientOptionsQuery = useClientFilterOptionsQuery()
  const siteOptionsQuery = useSiteOptionsQuery(canEdit)
  const setPriority = useSetSupervisorPriorityMutation()
  const removePriority = useRemoveSupervisorPriorityMutation()

  const [target, setTarget] = useState<Target>('client')
  const [clientId, setClientId] = useState<string | undefined>()
  const [siteId, setSiteId] = useState<string | undefined>()

  const priorities = prioritiesOfSupervisor(
    prioritiesQuery.data ?? [],
    profileId,
  )
  const takenClientIds = new Set(
    priorities.filter((p) => p.kind === 'client').map((p) => p.clientId),
  )
  const takenSiteIds = new Set(
    priorities.flatMap((p) => (p.siteId ? [p.siteId] : [])),
  )

  const clientChoices = (clientOptionsQuery.data ?? [])
    .filter((option) => !takenClientIds.has(option.id))
    .map((option) => ({ value: option.id, label: option.name }))
  const siteChoices = (siteOptionsQuery.data ?? [])
    .filter((option) => !takenSiteIds.has(option.id))
    .map((option) => ({
      value: option.id,
      label: `${option.clientName} · ${option.name}`,
    }))

  const selectedId = target === 'client' ? clientId : siteId

  async function handleAdd() {
    if (!selectedId) return
    try {
      await setPriority.mutateAsync({
        supervisorId: profileId,
        ...(target === 'client'
          ? { clientId: selectedId }
          : { siteId: selectedId }),
      })
      toast.success(
        target === 'client'
          ? 'Agregamos el cliente como preferencial.'
          : 'Agregamos la sede como preferencial.',
      )
      setClientId(undefined)
      setSiteId(undefined)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos agregar la prioridad.',
      )
    }
  }

  async function handleRemove(priorityId: string, label: string) {
    try {
      await removePriority.mutateAsync(priorityId)
      toast.success(`Quitamos ${label} de los preferenciales.`)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos quitar la prioridad.',
      )
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-lg border border-border bg-surface-2 p-3 text-[12px] text-text-2">
        Los clientes y sedes preferenciales ordenan la lista del coordinador:
        primero ve «Mis sedes» y después las demás. No lo restringen: puede
        tomar cualquier turno. Si elegís un cliente entero, quedan incluidas
        todas sus sedes, también las que se creen más adelante.
      </p>

      {canEdit && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          <SegmentedControl
            aria-label="Qué agregar"
            options={TARGET_OPTIONS}
            value={target}
            onValueChange={setTarget}
            className="self-start"
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {target === 'client' ? (
              <Combobox
                aria-label="Elegir cliente preferencial"
                className="sm:w-80"
                options={clientChoices}
                value={clientId}
                onValueChange={setClientId}
                placeholder="Elegí un cliente…"
                searchPlaceholder="Buscar cliente…"
                emptyText="No hay clientes para agregar."
              />
            ) : (
              <Combobox
                aria-label="Elegir sede preferencial"
                className="sm:w-80"
                options={siteChoices}
                value={siteId}
                onValueChange={setSiteId}
                placeholder="Elegí una sede…"
                searchPlaceholder="Buscar sede o cliente…"
                emptyText="No hay sedes para agregar."
              />
            )}
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
        </div>
      )}

      {prioritiesQuery.isLoading ? (
        <Skeleton className="h-24" />
      ) : priorities.length === 0 ? (
        <EmptyState
          icon={Star}
          title="Todavía no tiene clientes ni sedes preferenciales"
          description="Mientras tanto ve todas las sedes en «Otras sedes»."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {priorities.map((priority) => {
            const isSite = priority.kind === 'site'
            const label = isSite
              ? `${priority.clientName} · ${priority.siteName ?? ''}`
              : priority.clientName
            return (
              <li
                key={priority.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-[14px]"
              >
                <Link
                  to={
                    isSite
                      ? `/admin/sedes/${priority.siteId}`
                      : `/admin/clientes/${priority.clientId}`
                  }
                  className="flex min-w-0 items-center gap-3 hover:text-primary-800"
                >
                  {isSite ? (
                    <MapPin aria-hidden="true" className="size-4 text-text-3" />
                  ) : (
                    <Building2
                      aria-hidden="true"
                      className="size-4 text-text-3"
                    />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-text">
                      {label}
                    </span>
                    <span className="block text-[11px] text-text-3">
                      {isSite ? 'Sede' : 'Cliente entero, todas sus sedes'}
                    </span>
                  </span>
                </Link>
                {canEdit && (
                  <IconButton
                    icon={X}
                    aria-label={`Quitar ${label}`}
                    disabled={removePriority.isPending}
                    onClick={() => void handleRemove(priority.id, label)}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export { SupervisorPrioritiesTab }
