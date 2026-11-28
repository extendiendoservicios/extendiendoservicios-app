import type { AgendaItem } from '@/api/agenda'

/** Ítem de la Agenda para las pruebas de componentes (solo lo que se pisa cambia). */
export function makeAgendaItem(
  overrides: Partial<AgendaItem> = {},
): AgendaItem {
  return {
    id: 'item-1',
    kind: 'evento',
    month: '2026-11-01',
    day: '2026-11-13',
    slot: null,
    position: 0,
    workType: null,
    timeText: null,
    place: null,
    clientPerson: null,
    people: null,
    placeName: null,
    clientName: null,
    address: null,
    daysHours: null,
    budget: null,
    observation: null,
    body: null,
    resolved: false,
    borderColor: null,
    fillColor: null,
    fillBeforeResolved: null,
    clientId: null,
    ...overrides,
  }
}
