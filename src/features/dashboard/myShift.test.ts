import { describe, expect, it } from 'vitest'
import { myShiftAction } from './myShift'

const base = {
  checkInAt: null,
  checkOutAt: null,
  status: 'expected' as const,
  noCheckout: false,
}

describe('myShiftAction (OG-07)', () => {
  it('sin inicio: registrar inicio', () => {
    expect(myShiftAction(base)).toBe('start')
  })

  it('con inicio y sin fin: registrar fin', () => {
    expect(
      myShiftAction({ ...base, checkInAt: '2026-09-30T08:00:00-03:00' }),
    ).toBe('end')
  })

  it('terminado: nada', () => {
    expect(
      myShiftAction({
        ...base,
        checkInAt: '2026-09-30T08:00:00-03:00',
        checkOutAt: '2026-09-30T12:00:00-03:00',
      }),
    ).toBe('none')
  })

  it('ausencia avisada: nada', () => {
    expect(myShiftAction({ ...base, status: 'absence_notified' })).toBe('none')
  })

  it('«Sin salida»: no se ficha desde el celular', () => {
    expect(
      myShiftAction({
        ...base,
        checkInAt: '2026-09-30T08:00:00-03:00',
        noCheckout: true,
      }),
    ).toBe('none')
  })
})
