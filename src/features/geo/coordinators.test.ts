import { describe, expect, it } from 'vitest'
import {
  buildCoordinatorMarkers,
  coordinatorPositionNote,
  coordinatorStatusDetail,
  coordinatorWorkdayPath,
  countByStatus,
  SUPERVISOR_STATUS_VARIANTS,
} from './coordinators'
import { makeStatusRow } from './coordinatorFixtures'

describe('estados de los coordinadores en el mapa (CJ-33)', () => {
  it('cada estado tiene su propio color', () => {
    const variants = Object.values(SUPERVISOR_STATUS_VARIANTS)
    expect(new Set(variants).size).toBe(variants.length)
  })

  it('un punto en forma de rombo en la última posición, con el color de su estado', () => {
    const model = buildCoordinatorMarkers(
      [
        makeStatusRow({ supervisorId: 'a', status: 'supervising' }),
        makeStatusRow({ supervisorId: 'b', status: 'paused' }),
        makeStatusRow({ supervisorId: 'c', status: 'finished' }),
      ],
      true,
    )
    expect(model.markers.map((marker) => marker.id)).toEqual([
      'coordinator-a',
      'coordinator-b',
      'coordinator-c',
    ])
    expect(model.markers.map((marker) => marker.variant)).toEqual([
      'primary',
      'warning',
      'dark',
    ])
    expect(model.markers.every((marker) => marker.shape === 'supervisor')).toBe(
      true,
    )
    expect(model.markers[0]?.position).toEqual({
      lat: -34.6037,
      lng: -58.3816,
    })
  })

  it('sin posición en el último evento va a «Sin ubicación» solo si la jornada está abierta, ordenado por estado', () => {
    const model = buildCoordinatorMarkers(
      [
        makeStatusRow({
          supervisorId: 'a',
          status: 'in_activity',
          latitude: null,
          longitude: null,
        }),
        makeStatusRow({
          supervisorId: 'n',
          status: 'not_started',
          latitude: null,
          longitude: null,
          workdayId: null,
        }),
        makeStatusRow({
          supervisorId: 'f',
          status: 'finished',
          latitude: null,
          longitude: null,
        }),
        makeStatusRow({
          supervisorId: 'b',
          status: 'paused',
          latitude: null,
          longitude: null,
        }),
      ],
      true,
    )
    expect(model.markers).toEqual([])
    expect(model.withoutLocation.map((row) => row.supervisorId)).toEqual([
      'a',
      'b',
    ])
  })

  it('con el filtro «Coordinadores» apagado no dibuja ni lista a nadie', () => {
    const model = buildCoordinatorMarkers(
      [
        makeStatusRow(),
        makeStatusRow({ supervisorId: 'x', latitude: null, longitude: null }),
      ],
      false,
    )
    expect(model).toEqual({ markers: [], withoutLocation: [] })
  })

  it('el detalle del estado suma cliente y sede si supervisa, y el motivo si está en pausa', () => {
    expect(
      coordinatorStatusDetail(
        makeStatusRow({
          status: 'supervising',
          clientName: 'Logística Central',
          siteName: 'Munro',
        }),
      ),
    ).toBe('Supervisando: Logística Central · Munro')
    expect(
      coordinatorStatusDetail(
        makeStatusRow({ status: 'paused', pauseReason: 'Almuerzo' }),
      ),
    ).toBe('En pausa: Almuerzo')
    expect(coordinatorStatusDetail(makeStatusRow({ status: 'paused' }))).toBe(
      'En pausa',
    )
    expect(coordinatorStatusDetail(makeStatusRow({ status: 'finished' }))).toBe(
      'Finalizada',
    )
  })

  it('cuenta los coordinadores por estado y arma el enlace a la jornada', () => {
    const counts = countByStatus([
      makeStatusRow({ status: 'paused' }),
      makeStatusRow({ status: 'paused' }),
      makeStatusRow({ status: 'finished' }),
    ])
    expect(counts.paused).toBe(2)
    expect(counts.finished).toBe(1)
    expect(counts.supervising).toBe(0)
    expect(coordinatorWorkdayPath('sv1')).toBe(
      '/admin/empleados/sv1?pestana=jornadas',
    )
  })
})

describe('última posición conocida del coordinador (D-11)', () => {
  it('no avisa hora si la posición es la del último evento', () => {
    expect(coordinatorPositionNote(makeStatusRow())).toBeNull()
  })

  it('avisa la hora de la posición si es anterior al último evento', () => {
    const row = makeStatusRow({
      lastEventAt: '2026-10-23T13:30:00Z',
      positionAt: '2026-10-23T12:42:00Z',
    })
    // 12:42 UTC = 09:42 en Buenos Aires.
    expect(coordinatorPositionNote(row)).toBe('Ubicación de las 09:42')
    const model = buildCoordinatorMarkers([row], true)
    expect(model.markers).toHaveLength(1)
    expect(model.markers[0]?.label).toContain('Ubicación de las 09:42')
    expect(model.withoutLocation).toHaveLength(0)
  })

  it('«Sin ubicación» solo si no tuvo ninguna posición en el día', () => {
    const row = makeStatusRow({
      latitude: null,
      longitude: null,
      positionAt: null,
    })
    expect(coordinatorPositionNote(row)).toBeNull()
    const model = buildCoordinatorMarkers([row], true)
    expect(model.markers).toHaveLength(0)
    expect(model.withoutLocation).toHaveLength(1)
  })
})
