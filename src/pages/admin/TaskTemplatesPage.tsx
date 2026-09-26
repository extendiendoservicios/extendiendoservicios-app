import { useSearchParams } from 'react-router'
import { ClipboardList } from 'lucide-react'
import { Field, FieldLabel } from '@/components/ui/field'
import { EmptyState } from '@/components/EmptyState'
import { Combobox } from '@/components/Combobox'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  useClientsQuery,
  useClientSitesQuery,
} from '@/features/clients/queries'
import { canEditChecklists } from '@/features/checklists/permissions'
import { ClientTemplateEditor } from '@/features/checklists/components/ClientTemplateEditor'
import { SiteTemplateEditor } from '@/features/checklists/components/SiteTemplateEditor'

const CLIENT_TEMPLATE_VALUE = ''

/**
 * ADM-26 "Plantillas de tareas" (TASK-004, TASK-005, `05` línea 85):
 * selector de cliente y, dentro de él, ámbito "Plantilla del cliente" o
 * una sede puntual ("usa la del cliente" o plantilla propia). Sin
 * `edit_checklists` (`canEditChecklists`), la pantalla queda de solo
 * lectura -- sigue en el menú (`ADMIN_NAV_OPERATION`), a diferencia de las
 * pantallas exclusivas del dueño, porque `06` sección 9 da lectura a
 * cualquier O/A ("Plantillas por cliente | ... | O, A").
 *
 * `?cliente=`/`?sede=` en la URL (mismo criterio que `?pestana=` de
 * `ClientDetailPage`): así los enlaces de ADM-21 y ADM-22 ("Ir a plantillas
 * de tareas") llegan con el cliente y, si corresponde, la sede ya
 * elegidos.
 */
export default function TaskTemplatesPage() {
  const auth = useAuth()
  const canEdit = canEditChecklists(auth)
  const [searchParams, setSearchParams] = useSearchParams()

  const clientId = searchParams.get('cliente') ?? ''
  const siteId = searchParams.get('sede') || null

  const clientsQuery = useClientsQuery({})
  const sitesQuery = useClientSitesQuery(clientId || undefined)

  function handleClientChange(value: string) {
    const next = new URLSearchParams()
    if (value) {
      next.set('cliente', value)
    }
    setSearchParams(next, { replace: true })
  }

  function handleScopeChange(value: string) {
    const next = new URLSearchParams(searchParams)
    if (value === CLIENT_TEMPLATE_VALUE) {
      next.delete('sede')
    } else {
      next.set('sede', value)
    }
    setSearchParams(next, { replace: true })
  }

  const clientOptions = (clientsQuery.data ?? []).map((client) => ({
    value: client.id,
    label:
      (client.tradeName ?? client.legalName) +
      (client.status !== 'active'
        ? ` (${client.status === 'suspended' ? 'suspendido' : 'baja'})`
        : ''),
  }))

  const scopeOptions = [
    { value: CLIENT_TEMPLATE_VALUE, label: 'Plantilla del cliente' },
    ...(sitesQuery.data ?? []).map((site) => ({
      value: site.id,
      label: site.name + (site.status !== 'active' ? ' (inactiva)' : ''),
    })),
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 sm:grid-cols-2">
        <Field>
          <FieldLabel>Cliente</FieldLabel>
          <Combobox
            aria-label="Cliente"
            options={clientOptions}
            value={clientId || undefined}
            onValueChange={handleClientChange}
            placeholder="Elegí un cliente"
            searchPlaceholder="Buscar cliente…"
          />
        </Field>

        {clientId && (
          <Field>
            <FieldLabel>Ámbito</FieldLabel>
            <Combobox
              aria-label="Ámbito de la plantilla"
              options={scopeOptions}
              value={siteId ?? CLIENT_TEMPLATE_VALUE}
              onValueChange={handleScopeChange}
              placeholder="Elegí un ámbito"
              searchPlaceholder="Buscar sede…"
            />
          </Field>
        )}
      </div>

      {!canEdit && (
        <p className="text-[11.5px] text-text-3">
          No tenés el permiso para editar plantillas de tareas: podés verlas,
          pero no cambiarlas. Pedíselo a la dueña.
        </p>
      )}

      {!clientId ? (
        <EmptyState
          icon={ClipboardList}
          title="Elegí un cliente"
          description="Elegí un cliente para ver o editar su plantilla de tareas."
        />
      ) : siteId == null ? (
        <ClientTemplateEditor clientId={clientId} canEdit={canEdit} />
      ) : (
        <SiteTemplateEditor
          clientId={clientId}
          siteId={siteId}
          canEdit={canEdit}
        />
      )}
    </div>
  )
}
