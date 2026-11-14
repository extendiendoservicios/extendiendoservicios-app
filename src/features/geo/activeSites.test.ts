import { describe, expect, it } from 'vitest'
import type { ActiveSiteRow } from '@/api/geo'
import { parseActiveSiteServices } from '@/api/geo'
import {
  activeSiteServiceLabel,
  activeSitesCounterLabel,
  buildActiveSiteMarkers,
} from './activeSites'

function site(overrides: Partial<ActiveSiteRow> = {}): ActiveSiteRow {
  return {
    clientId: 'c1',
    clientLegalName: 'Cliente S.A.',
    clientTradeName: 'Cliente',
    clientCalendarColor: 2,
    siteId: 's1',
    siteName: 'Planta',
    siteCity: 'Pergamino',
    latitude: -33.9,
    longitude: -60.5,
    services: [],
    ...overrides,
  }
}

describe('modo «Todos los clientes» del mapa (OG-01)', () => {
  it('un pin por sede con el color del cliente y el contador', () => {
    const model = buildActiveSiteMarkers([
      site(),
      site({ siteId: 's2', siteName: 'Depósito' }),
      site({ clientId: 'c2', siteId: 's3', clientCalendarColor: 0 }),
    ])
    expect(model.markers).toHaveLength(3)
    expect(model.markers[0]?.color).toBe('#e07b22')
    expect(model.markers[2]?.color).toBe('#3f6fd8')
    expect(activeSitesCounterLabel(model)).toBe('2 clientes · 3 sedes')
  })

  it('usa el singular', () => {
    expect(activeSitesCounterLabel(buildActiveSiteMarkers([site()]))).toBe(
      '1 cliente · 1 sede',
    )
  })

  it('arma el texto de cada servicio con días y horario', () => {
    const [service] = parseActiveSiteServices([
      {
        id: 'x',
        name: 'Limpieza',
        weekdays: [1, 2, 3, 4, 5],
        weeks_of_month: null,
        start_time: '08:00:00',
        end_time: '12:00:00',
        open_ended: false,
      },
    ])
    expect(service && activeSiteServiceLabel(service)).toBe(
      'Limpieza · lun a vie · 08:00–12:00',
    )
  })

  it('tolera un services que no es lista', () => {
    expect(parseActiveSiteServices(null)).toEqual([])
  })
})
