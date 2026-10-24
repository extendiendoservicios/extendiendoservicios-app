import { describe, expect, it } from 'vitest'
import type { PresenceRow } from '@/api/geo'
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

  it('las sedes llevan su círculo con el radio vigente y sin color de alarma (B-14)', () => {
    const model = buildPresenceMarkers([siteRow({ siteRadiusM: 220 }), row()], {
      showFinished: false,
    })
    expect(model.sitesOnMap).toBe(1)
    const site = model.markers[0]
    expect(site?.id).toBe('site-site1')
    expect(site?.radiusM).toBe(220)
    expect(site?.circleVariant).toBe('primary')
    expect(site?.variant).toBe('primary')
  })

  it('el pin de sede usa la forma `site`', () => {
    const model = buildPresenceMarkers([siteRow(), row()], {
      showFinished: false,
    })
    expect(model.markers[0]?.shape).toBe('site')
  })

  it('una sede sin nadie no se dibuja', () => {
    const model = buildPresenceMarkers([siteRow()], { showFinished: false })
    expect(model.markers).toEqual([])
    expect(model.sitesOnMap).toBe(0)
  })

  it('una sede en su franja horaria se dibuja aunque nadie haya fichado', () => {
    const model = buildPresenceMarkers([siteRow()], {
      showFinished: false,
      siteIdsInWindow: new Set(['site1']),
    })
    expect(model.sitesOnMap).toBe(1)
    expect(model.peopleOnMap).toBe(0)
  })

  it('una sede fuera de su franja y sin nadie en curso no se dibuja', () => {
    const model = buildPresenceMarkers([siteRow()], {
      showFinished: false,
      siteIdsInWindow: new Set(['otra']),
    })
    expect(model.sitesOnMap).toBe(0)
  })

  it('una sede de otra gente no aparece si su propia gente no está', () => {
    const model = buildPresenceMarkers(
      [siteRow({ recordId: 'site2' }), row({ siteId: 'site1' })],
      { showFinished: false },
    )
    expect(model.markers.map((marker) => marker.id)).toEqual(['employee-a1'])
  })

  it('una sede con solo finalizados aparece únicamente con «Mostrar finalizados»', () => {
    const rows = [
      siteRow(),
      row({ inProgress: false, checkOutAt: '2026-10-14T15:00:00Z' }),
    ]
    expect(buildPresenceMarkers(rows, { showFinished: false }).sitesOnMap).toBe(
      0,
    )
    expect(buildPresenceMarkers(rows, { showFinished: true }).sitesOnMap).toBe(
      1,
    )
  })

  it('quien trabaja sin ubicación también hace que se muestre su sede', () => {
    const model = buildPresenceMarkers(
      [siteRow(), row({ latitude: null, longitude: null })],
      { showFinished: false },
    )
    expect(model.sitesOnMap).toBe(1)
    expect(model.peopleOnMap).toBe(0)
  })

  it('una supervisión en curso ya no activa la sede: el coordinador sale de su estado', () => {
    const model = buildPresenceMarkers(
      [siteRow(), row({ kind: 'supervisor', recordId: 'sv1' })],
      { showFinished: false },
    )
    expect(model.sitesOnMap).toBe(0)
  })

  it('las sedes van primero y los puntos de personas encima', () => {
    const model = buildPresenceMarkers([row(), siteRow()], {
      showFinished: false,
    })
    expect(model.markers.map((marker) => marker.id)).toEqual([
      'site-site1',
      'employee-a1',
    ])
  })

  it('una sede sin coordenadas no se dibuja', () => {
    const model = buildPresenceMarkers(
      [siteRow({ siteLatitude: null, siteLongitude: null })],
      { showFinished: false },
    )
    expect(model.markers).toEqual([])
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
