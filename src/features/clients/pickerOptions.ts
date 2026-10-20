/**
 * Opciones de cliente y sede para elegir al CREAR algo nuevo (turno, servicio,
 * P19.11d): un cliente suspendido o dado de baja, o una sede inactiva, no se
 * ofrecen, porque la base los rechaza (`CLIENT_NOT_ACTIVE`, `SITE_NOT_ACTIVE`).
 * En los filtros de listados sí siguen apareciendo (no usan esto).
 *
 * `keepId`: al editar algo que ya existe, se conserva la opción vigente aunque
 * esté inactiva, para que el formulario la muestre en vez de quedar en blanco.
 */

interface ClientLike {
  id: string
  tradeName?: string | null
  legalName: string
  status?: string | null
}

interface SiteLike {
  id: string
  name: string
  status?: string | null
}

interface PickerOption {
  value: string
  label: string
}

function isInactive(status: string | null | undefined): boolean {
  return status != null && status !== 'active'
}

export function newClientPickerOptions(
  clients: readonly ClientLike[],
  keepId?: string,
): PickerOption[] {
  return clients
    .filter((client) => !isInactive(client.status) || client.id === keepId)
    .map((client) => ({
      value: client.id,
      label:
        (client.tradeName ?? client.legalName) +
        (isInactive(client.status)
          ? ` (${client.status === 'suspended' ? 'suspendido' : 'baja'})`
          : ''),
    }))
}

export function newSitePickerOptions(
  sites: readonly SiteLike[],
  keepId?: string,
): PickerOption[] {
  return sites
    .filter((site) => !isInactive(site.status) || site.id === keepId)
    .map((site) => ({
      value: site.id,
      label: site.name + (isInactive(site.status) ? ' (inactiva)' : ''),
    }))
}
