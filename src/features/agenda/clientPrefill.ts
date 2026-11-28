/**
 * «Crear cliente» desde un bloque de Nuevos (AG-09): la Agenda abre el alta de
 * cliente (`/admin/clientes/nuevo`) pasando estos datos por `location.state`.
 * El formulario los precarga y, al crear el cliente, vincula el bloque con
 * `mark_agenda_item_client` y vuelve a la Agenda.
 */
export interface AgendaClientPrefill {
  /** Bloque de Nuevos de origen. */
  agendaItemId: string
  /** Razón social sugerida (cliente del bloque o, si no hay, nombre del lugar). */
  legalName: string
  adminAddress: string
  notes: string
  /** Dirección de la Agenda (con el mes) a la que volver después de crear el cliente. */
  returnTo: string
}

export const AGENDA_PATH = '/admin/agenda'

/** Arma el estado de navegación. */
export function buildClientPrefillState(prefill: AgendaClientPrefill): {
  agendaPrefill: AgendaClientPrefill
} {
  return { agendaPrefill: prefill }
}

/** Lee el estado de navegación con cuidado: `null` si no es de la Agenda. */
export function readAgendaClientPrefill(
  state: unknown,
): AgendaClientPrefill | null {
  if (state == null || typeof state !== 'object') {
    return null
  }
  const raw = (state as { agendaPrefill?: unknown }).agendaPrefill
  if (raw == null || typeof raw !== 'object') {
    return null
  }
  const value = raw as Record<string, unknown>
  if (typeof value.agendaItemId !== 'string' || value.agendaItemId === '') {
    return null
  }
  const text = (key: string) =>
    typeof value[key] === 'string' ? value[key] : ''
  return {
    agendaItemId: value.agendaItemId,
    legalName: text('legalName'),
    adminAddress: text('adminAddress'),
    notes: text('notes'),
    returnTo: text('returnTo').startsWith(AGENDA_PATH)
      ? text('returnTo')
      : AGENDA_PATH,
  }
}
