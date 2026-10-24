import { describe, expect, it } from 'vitest'
import {
  buildCoordinatorMarkers,
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
