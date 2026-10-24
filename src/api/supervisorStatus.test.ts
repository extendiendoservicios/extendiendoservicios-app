import { describe, expect, it } from 'vitest'
import { mapSupervisorStatusRow } from './supervisorStatus'

const raw = {
  supervisor_id: 'sv1',
  first_name: 'Sofía',
  last_name: 'Ruiz',
  status: 'supervising',
  workday_id: 'w1',
  work_date: '2026-10-23',
  started_at: '2026-10-23T11:00:00Z',
  ended_at: null,
  last_event_at: '2026-10-23T12:30:00Z',
  latitude: '-34.6037',
  longitude: -58.3816,
  accuracy_m: 14.5,
  worked_minutes: 90,
  pause_reason: null,
  supervision_id: 'sup1',
  client_id: 'c1',
  client_legal_name: 'Logística Central',
  site_id: 'site1',
  site_name: 'Munro',
  auto_closed: false,
  corrected: null,
  on_leave: false,
}

describe('mapSupervisorStatusRow (v_supervisor_status)', () => {
  it('pasa a camelCase y normaliza las coordenadas numéricas', () => {
    expect(mapSupervisorStatusRow(raw)).toMatchObject({
      supervisorId: 'sv1',
      status: 'supervising',
      latitude: -34.6037,
      longitude: -58.3816,
      workedMinutes: 90,
      clientName: 'Logística Central',
      corrected: false,
    })
  })

  it('sin posición queda en null, para la lista «Sin ubicación»', () => {
    expect(
      mapSupervisorStatusRow({ ...raw, latitude: null, longitude: null }),
    ).toMatchObject({ latitude: null, longitude: null })
  })

  it('descarta filas sin coordinador o con un estado desconocido', () => {
    expect(mapSupervisorStatusRow({ ...raw, supervisor_id: null })).toBeNull()
    expect(mapSupervisorStatusRow({ ...raw, status: 'assigned' })).toBeNull()
  })
})
