import { describe, expect, it } from 'vitest'
import {
  defaultDeleteFromDate,
  futureShiftsNotice,
  shiftCleanupMessage,
  statusEffectDescription,
  statusOffersShiftCleanup,
} from './statusShifts'

describe('statusShifts (D-03)', () => {
  it('la fecha por omisión es mañana, en hora de Buenos Aires', () => {
    // 23 nov 2026, 22:00 en Buenos Aires = 24 nov 01:00 UTC: sigue siendo el 23 allá.
    expect(defaultDeleteFromDate(new Date('2026-11-24T01:00:00Z'))).toBe(
      '2026-11-24',
    )
    expect(defaultDeleteFromDate(new Date('2026-11-23T15:00:00Z'))).toBe(
      '2026-11-24',
    )
  })

  it('solo pausar y finalizar ofrecen limpiar turnos', () => {
    expect(statusOffersShiftCleanup('paused')).toBe(true)
    expect(statusOffersShiftCleanup('ended')).toBe(true)
    expect(statusOffersShiftCleanup('active')).toBe(false)
  })

  it('los textos de efecto no dicen que los turnos no se tocan cuando se eliminan', () => {
    for (const status of ['paused', 'ended'] as const) {
      expect(statusEffectDescription(status, true)).not.toMatch(/no se tocan/)
      expect(statusEffectDescription(status, true)).toMatch(/Se eliminan/)
      expect(statusEffectDescription(status, false)).toMatch(
        /quedan como están/,
      )
    }
  })

  it('el aviso del administrador cuenta los turnos futuros', () => {
    expect(futureShiftsNotice(0)).toBeNull()
    expect(futureShiftsNotice(1)).toBe(
      'Queda 1 turno futuro. La dirección puede eliminarlo.',
    )
    expect(futureShiftsNotice(15)).toBe(
      'Quedan 15 turnos futuros. La dirección puede eliminarlos.',
    )
  })

  it('informa cuántos se eliminaron y cuántos quedaron por tener historia', () => {
    const base = { entity: 'service_shifts', id: 's', name: 'X' }
    expect(
      shiftCleanupMessage({
        ...base,
        deleted: { shifts: 12 },
        skippedCount: 2,
      }),
    ).toBe('Eliminamos 12 turnos. Quedaron 2 turnos por tener historia.')
    expect(
      shiftCleanupMessage({
        ...base,
        deleted: { shifts: 1 },
        skippedCount: 1,
      }),
    ).toBe('Eliminamos 1 turno. Quedó 1 turno por tener historia.')
    expect(shiftCleanupMessage({ ...base, deleted: {}, skippedCount: 0 })).toBe(
      'Eliminamos 0 turnos.',
    )
  })
})
