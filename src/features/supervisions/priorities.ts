import type { SupervisorPriority } from '@/api/supervisorPriorities'

/**
 * Filtros de las prioridades de coordinadores (CJ-24), sin React. Una sola
 * consulta trae todas las vigentes; cada ficha se queda con las suyas.
 */

/** Prioridades de un coordinador, ordenadas por cliente y después por sede (el cliente entero primero). */
export function prioritiesOfSupervisor(
  priorities: SupervisorPriority[],
  supervisorId: string,
): SupervisorPriority[] {
  return priorities
    .filter((priority) => priority.supervisorId === supervisorId)
    .sort(
      (a, b) =>
        a.clientName.localeCompare(b.clientName, 'es') ||
        Number(a.kind === 'site') - Number(b.kind === 'site') ||
        (a.siteName ?? '').localeCompare(b.siteName ?? '', 'es'),
    )
}

/** Un coordinador preferencial de un cliente o de una sede, con su alcance. */
export interface PreferredSupervisor {
  priorityId: string
  supervisorId: string
  supervisorName: string
  /**
   * `client`: la prioridad es del cliente entero; `site`: de una sede.
   * Para la ficha de una sede, `inherited` marca los que le llegan por el
   * cliente (no se quitan desde la sede).
   */
  scope: 'client' | 'site'
  siteName: string | null
  inherited: boolean
}

function byName(a: PreferredSupervisor, b: PreferredSupervisor): number {
  return a.supervisorName.localeCompare(b.supervisorName, 'es')
}

/**
 * Ficha del cliente: los que lo tienen como preferencial entero y los que
 * tienen alguna de sus sedes.
 */
export function preferredSupervisorsOfClient(
  priorities: SupervisorPriority[],
  clientId: string,
): PreferredSupervisor[] {
  return priorities
    .filter((priority) => priority.clientId === clientId)
    .map((priority) => ({
      priorityId: priority.id,
      supervisorId: priority.supervisorId,
      supervisorName: priority.supervisorName,
      scope: priority.kind,
      siteName: priority.siteName,
      inherited: false,
    }))
    .sort(
      (a, b) =>
        Number(a.scope === 'site') - Number(b.scope === 'site') || byName(a, b),
    )
}

/**
 * Ficha de la sede: los de la sede misma y los que le llegan porque su
 * cliente es preferencial (CJ-24: «cubre todas sus sedes, también las que
 * se creen después»).
 */
export function preferredSupervisorsOfSite(
  priorities: SupervisorPriority[],
  siteId: string,
  clientId: string,
): PreferredSupervisor[] {
  return priorities
    .filter(
      (priority) =>
        priority.siteId === siteId ||
        (priority.kind === 'client' && priority.clientId === clientId),
    )
    .map((priority) => ({
      priorityId: priority.id,
      supervisorId: priority.supervisorId,
      supervisorName: priority.supervisorName,
      scope: priority.kind,
      siteName: priority.siteName,
      inherited: priority.kind === 'client',
    }))
    .sort((a, b) => Number(a.inherited) - Number(b.inherited) || byName(a, b))
}
