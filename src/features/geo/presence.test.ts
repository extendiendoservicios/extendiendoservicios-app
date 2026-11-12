import { describe, expect, it } from 'vitest'
import type { PresenceRow, SiteDayStatusRow } from '@/api/geo'
import {
  buildPresenceMarkers,
  presenceClientName,
  presencePersonName,
  presenceVariant,
} from './presence'
import { makeStatusRow } from './coordinatorFixtures'

function row(overrides: Partial<PresenceRow> = {}): PresenceRow {
  return {
    kind: 'employee',
    recordId: 'a1',
    personId: 'p1',
    personFirstName: 'Ana',
    personLastName: 'Gómez',
    shiftId: 's1',
    clientId: 'c1',
    clientLegalName: 'Cliente SA',
    clientTradeName: 'Cliente',
    siteId: 'site1',
    siteName: 'Sede Uno',
    shiftDate: '2026-10-14',
    startTime: '08:00:00',
    endTime: '12:00:00',
    checkInAt: '2026-10-14T11:03:00Z',
    checkOutAt: null,
    inProgress: true,
    latitude: -34.6037,
    longitude: -58.3816,
    accuracyM: 12,
    geoStatus: 'valid',
    geoReason: null,
    distanceM: 20,
    geofenceRadiusM: 150,
    geoOverridden: false,
    siteLatitude: -34.6037,
    siteLongitude: -58.3816,
    siteRadiusM: 150,
    ...overrides,
  }
}

function siteStatus(
  overrides: Partial<SiteDayStatusRow> = {},
): SiteDayStatusRow {
  return {
    siteId: 'site1',
    clientId: 'c1',
    clientLegalName: 'Cliente SA',
    clientTradeName: 'Cliente',
    siteName: 'Sede Uno',
    latitude: -34.6037,
    longitude: -58.3816,
    radiusM: 150,
    upcomingCount: 0,
    inProgressCount: 1,
    finishedCount: 0,
    shiftsCount: 1,
    dayState: 'in_progress',
    nextStartsAt: null,
    lastEndsAt: null,
    ...overrides,
  }
}

function siteRow(overrides: Partial<PresenceRow> = {}): PresenceRow {
  return row({
    kind: 'site',
    recordId: 'site1',
    personId: null,
    personFirstName: null,
    personLastName: null,
    shiftId: null,
    startTime: null,
    endTime: null,
    checkInAt: null,
    inProgress: false,
    latitude: null,
    longitude: null,
    accuracyM: null,
    geoStatus: null,
    distanceM: null,
    ...overrides,
  })
}

describe('presenceVariant (B-03, B-09)', () => {
  it('verde si está validado, rojo si está fuera de zona, gris si no se pudo validar', () => {
    expect(presenceVariant({ geoStatus: 'valid', geoOverridden: false })).toBe(
      'success',
    )
    expect(
      presenceVariant({ geoStatus: 'outside', geoOverridden: false }),
    ).toBe('danger')
    expect(
      presenceVariant({ geoStatus: 'unvalidated', geoOverridden: false }),
    ).toBe('neutral')
    expect(presenceVariant({ geoStatus: null, geoOverridden: false })).toBe(
      'neutral',
    )
  })

  it('con override de la administración va en verde aunque haya quedado en rojo o gris', () => {
    expect(presenceVariant({ geoStatus: 'outside', geoOverridden: true })).toBe(
      'success',
    )
    expect(
      presenceVariant({ geoStatus: 'unvalidated', geoOverridden: true }),
    ).toBe('success')
  })
})

describe('buildPresenceMarkers', () => {
  it('dibuja a los empleados en curso con el color de su validación', () => {
    const model = buildPresenceMarkers(
      [
        row({ recordId: 'a1', geoStatus: 'valid' }),
        row({ recordId: 'a2', geoStatus: 'outside' }),
        row({
          recordId: 'a3',
          geoStatus: 'unvalidated',
          geoReason: 'low_accuracy',
        }),
      ],
      { showFinished: false },
    )
    expect(model.peopleOnMap).toBe(3)
    expect(model.markers.map((marker) => marker.variant)).toEqual([
      'success',
      'danger',
      'neutral',
    ])
    expect(model.markers.every((marker) => marker.shape === 'dot')).toBe(true)
  })

  it('ignora las filas de supervisión de v_presence_today: el coordinador sale de v_supervisor_status (sin doble punto)', () => {
    const model = buildPresenceMarkers(
      [row({ kind: 'supervisor', recordId: 'sv1' })],
      {
        showFinished: false,
        coordinators: [makeStatusRow({ supervisorId: 'sv1' })],
      },
    )
    expect(model.markers.map((marker) => marker.id)).toEqual([
      'coordinator-sv1',
    ])
    expect(model.peopleOnMap).toBe(0)
    expect(model.coordinatorsOnMap).toBe(1)
    expect(model.withoutLocation).toEqual([])
  })

  it('suma a los coordinadores después de los empleados, y el filtro los apaga', () => {
    const options = {
      showFinished: false,
      coordinators: [
        makeStatusRow({ supervisorId: 'a', status: 'supervising' as const }),
        makeStatusRow({
          supervisorId: 'b',
          status: 'paused' as const,
          latitude: null,
          longitude: null,
        }),
      ],
    }
    const on = buildPresenceMarkers([row()], options)
    expect(on.markers.map((marker) => marker.id)).toEqual([
      'employee-a1',
      'coordinator-a',
    ])
    expect(on.coordinatorsWithoutLocation.map((r) => r.supervisorId)).toEqual([
      'b',
    ])
    const off = buildPresenceMarkers([row()], {
      ...options,
      showCoordinators: false,
    })
    expect(off.markers.map((marker) => marker.id)).toEqual(['employee-a1'])
    expect(off.coordinatorsWithoutLocation).toEqual([])
  })

  it('oculta a los finalizados salvo con «Mostrar finalizados de hoy»', () => {
    const rows = [
      row({ recordId: 'en-curso' }),
      row({
        recordId: 'finalizado',
        inProgress: false,
        checkOutAt: '2026-10-14T15:00:00Z',
      }),
    ]
    expect(
      buildPresenceMarkers(rows, { showFinished: false }).markers.map(
        (marker) => marker.id,
      ),
    ).toEqual(['employee-en-curso'])
    expect(
      buildPresenceMarkers(rows, { showFinished: true }).markers.map(
        (marker) => marker.id,
      ),
    ).toEqual(['employee-en-curso', 'employee-finalizado'])
  })

  it('quien trabaja sin ubicación va a la lista y no al mapa (B-13)', () => {
    const model = buildPresenceMarkers(
      [
        row({ recordId: 'con' }),
        row({
          recordId: 'sin',
          latitude: null,
          longitude: null,
          accuracyM: null,
          geoStatus: 'unvalidated',
          geoReason: 'no_location',
        }),
      ],
      { showFinished: false },
    )
    expect(model.peopleOnMap).toBe(1)
    expect(model.withoutLocation.map((r) => r.recordId)).toEqual(['sin'])
  })

  it('un finalizado sin ubicación no cuenta como «trabajando sin ubicación»', () => {
    const model = buildPresenceMarkers(
      [
        row({
          recordId: 'sin-fin',
          inProgress: false,
          latitude: null,
          longitude: null,
        }),
      ],
      { showFinished: true },
    )
    expect(model.withoutLocation).toEqual([])
    expect(model.peopleOnMap).toBe(0)
  })

  it('las sedes llevan su círculo con el radio vigente (B-14)', () => {
    const model = buildPresenceMarkers([], {
      showFinished: false,
      sites: [siteStatus({ radiusM: 220 })],
    })
    expect(model.sitesOnMap).toBe(1)
    const site = model.markers[0]
    expect(site?.id).toBe('site-site1')
    expect(site?.radiusM).toBe(220)
  })

  it('OF-13: por comenzar en amarillo con reloj, en curso con el color de siempre y finalizada en gris con tilde', () => {
    const model = buildPresenceMarkers([], {
      showFinished: true,
      sites: [
        siteStatus({ siteId: 'u', dayState: 'upcoming' }),
        siteStatus({ siteId: 'p', dayState: 'in_progress' }),
        siteStatus({ siteId: 'f', dayState: 'finished' }),
      ],
    })
    const byId = Object.fromEntries(model.markers.map((m) => [m.id, m]))
    expect(byId['site-u']).toMatchObject({
      variant: 'warning',
      circleVariant: 'warning',
      shape: 'site-upcoming',
    })
    expect(byId['site-p']).toMatchObject({ variant: 'primary', shape: 'site' })
    expect(byId['site-f']).toMatchObject({
      variant: 'neutral',
      shape: 'site-finished',
    })
  })

  it('OF-13: por omisión se ven por comenzar y en curso, y no las finalizadas', () => {
    const sites = [
      siteStatus({ siteId: 'u', dayState: 'upcoming' }),
      siteStatus({ siteId: 'p', dayState: 'in_progress' }),
      siteStatus({ siteId: 'f', dayState: 'finished' }),
    ]
    const model = buildPresenceMarkers([], { showFinished: false, sites })
    expect(model.markers.map((m) => m.id)).toEqual(['site-u', 'site-p'])
  })

  it('OF-13: cada conmutador apaga su estado', () => {
    const sites = [
      siteStatus({ siteId: 'u', dayState: 'upcoming' }),
      siteStatus({ siteId: 'p', dayState: 'in_progress' }),
      siteStatus({ siteId: 'f', dayState: 'finished' }),
    ]
    const ids = (options: {
      showUpcoming?: boolean
      showInProgress?: boolean
    }) =>
      buildPresenceMarkers([], {
        showFinished: true,
        sites,
        ...options,
      }).markers.map((m) => m.id)
    expect(ids({ showUpcoming: false })).toEqual(['site-p', 'site-f'])
    expect(ids({ showInProgress: false })).toEqual(['site-u', 'site-f'])
  })

  it('«En curso» apagado oculta también a los empleados en curso, y «Finalizados» a los que ya cerraron', () => {
    const rows = [
      row({ recordId: 'curso' }),
      row({ recordId: 'fin', inProgress: false }),
    ]
    expect(
      buildPresenceMarkers(rows, {
        showFinished: true,
        showInProgress: false,
      }).markers.map((m) => m.id),
    ).toEqual(['employee-fin'])
    expect(
      buildPresenceMarkers(rows, { showFinished: false }).markers.map(
        (m) => m.id,
      ),
    ).toEqual(['employee-curso'])
  })

  it('una sede sin coordenadas no se dibuja', () => {
    const model = buildPresenceMarkers([], {
      showFinished: false,
      sites: [siteStatus({ latitude: null, longitude: null })],
    })
    expect(model.markers).toEqual([])
  })

  it('las filas `site` de v_presence_today ya no dibujan sedes', () => {
    const model = buildPresenceMarkers([siteRow()], { showFinished: true })
    expect(model.markers).toEqual([])
  })

  it('las sedes van primero y los puntos de personas encima', () => {
    const model = buildPresenceMarkers([row()], {
      showFinished: false,
      sites: [siteStatus()],
    })
    expect(model.markers.map((marker) => marker.id)).toEqual([
      'site-site1',
      'employee-a1',
    ])
  })

  it('guarda la fila en `data` para armar el popup', () => {
    const source = row({ recordId: 'x' })
    const model = buildPresenceMarkers([source], { showFinished: false })
    expect(model.markers[0]?.data).toBe(source)
  })
})

describe('nombres', () => {
  it('une nombre y apellido, o avisa que falta', () => {
    expect(presencePersonName(row())).toBe('Ana Gómez')
    expect(
      presencePersonName(row({ personFirstName: null, personLastName: null })),
    ).toBe('Sin nombre')
  })

  it('prefiere el nombre de fantasía del cliente', () => {
    expect(presenceClientName(row())).toBe('Cliente')
    expect(presenceClientName(row({ clientTradeName: null }))).toBe(
      'Cliente SA',
    )
  })
})
