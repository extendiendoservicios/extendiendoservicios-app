import { describe, expect, it } from 'vitest'
import {
  argentinaDateTimeToIso,
  buildCountHeaderSchema,
  buildCountInput,
  buildCountLines,
  describeLaterMovements,
  isRetroactive,
  laterMovementsBySupply,
  nowInArgentina,
  systemQtyAt,
} from './count'
import { testMovementLine } from './movementFixtures'

// 2026-10-26 14:30 en Argentina (UTC-3) = 17:30 UTC.
const NOW = new Date('2026-10-26T17:30:00Z')

const baseHeader = {
  date: '2026-10-26',
  time: '10:00',
  reviewerKind: 'person' as const,
  reviewerId: 'u1',
  reviewerName: '',
  notes: '',
}

describe('fecha y hora del control (IS-31)', () => {
  it('el «ahora» por defecto es de Argentina, no de la zona del navegador', () => {
    expect(nowInArgentina(NOW)).toEqual({ date: '2026-10-26', time: '14:30' })
    // 01:00 UTC del 27 sigue siendo 22:00 del 26 en Argentina.
    expect(nowInArgentina(new Date('2026-10-27T01:00:00Z'))).toEqual({
      date: '2026-10-26',
      time: '22:00',
    })
  })

  it('arma el instante con el huso de Argentina', () => {
    expect(argentinaDateTimeToIso('2026-10-26', '10:00')).toBe(
      '2026-10-26T10:00:00-03:00',
    )
  })

  it('acepta el momento actual y uno pasado', () => {
    const schema = buildCountHeaderSchema(NOW)
    expect(schema.safeParse({ ...baseHeader, time: '14:30' }).success).toBe(
      true,
    )
    expect(schema.safeParse(baseHeader).success).toBe(true)
  })

  it('rechaza una fecha y hora futuras', () => {
    const result = buildCountHeaderSchema(NOW).safeParse({
      ...baseHeader,
      time: '14:31',
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(
      'La fecha y la hora del control no pueden ser futuras.',
    )
  })

  it('rechaza una fecha de hace más de 30 días y acepta el límite (IS-36)', () => {
    const schema = buildCountHeaderSchema(NOW)
    // 30 días atrás a la misma hora que NOW (14:30): está en el límite.
    expect(
      schema.safeParse({ ...baseHeader, date: '2026-09-26', time: '14:30' })
        .success,
    ).toBe(true)
    const result = schema.safeParse({
      ...baseHeader,
      date: '2026-09-26',
      time: '14:29',
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(
      'El control no puede ser de hace más de 30 días. Elegí una fecha más reciente.',
    )
    expect(
      schema.safeParse({ ...baseHeader, date: '1900-01-01', time: '10:00' })
        .success,
    ).toBe(false)
  })

  it('pide día y hora', () => {
    const result = buildCountHeaderSchema(NOW).safeParse({
      ...baseHeader,
      date: '',
      time: '',
    })
    expect(result.success).toBe(false)
    const messages = result.error?.issues.map((issue) => issue.message)
    expect(messages).toContain('Indicá el día del control.')
    expect(messages).toContain('Indicá la hora del control.')
  })

  it('un control es retroactivo si es de hace más de un minuto', () => {
    expect(isRetroactive('2026-10-26T14:30:00-03:00', NOW)).toBe(false)
    expect(isRetroactive('2026-10-26T14:29:30-03:00', NOW)).toBe(false)
    expect(isRetroactive('2026-10-26T10:00:00-03:00', NOW)).toBe(true)
  })
})

describe('revisor: una persona de la app o un nombre escrito (IS-16)', () => {
  const schema = buildCountHeaderSchema(NOW)

  it('con persona, pide elegirla', () => {
    const result = schema.safeParse({ ...baseHeader, reviewerId: '' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(
      'Elegí la persona que revisó.',
    )
  })

  it('con nombre escrito, pide el nombre y no la persona', () => {
    const empty = schema.safeParse({
      ...baseHeader,
      reviewerKind: 'name',
      reviewerId: '',
      reviewerName: '   ',
    })
    expect(empty.success).toBe(false)
    expect(empty.error?.issues[0]?.message).toBe(
      'Escribí el nombre de quien revisó.',
    )
    expect(
      schema.safeParse({
        ...baseHeader,
        reviewerKind: 'name',
        reviewerId: '',
        reviewerName: 'Marta (proveedor)',
      }).success,
    ).toBe(true)
  })

  it('manda el revisor como persona o como nombre, nunca los dos', () => {
    const lines = [{ supplyId: 's1', countedQty: 4 }]
    const person = buildCountInput(
      { ...baseHeader, reviewerName: 'Quedó escrito de antes' },
      lines,
    )
    expect(person.reviewerId).toBe('u1')
    expect(person.reviewerName).toBeNull()

    const name = buildCountInput(
      {
        ...baseHeader,
        reviewerKind: 'name',
        reviewerId: 'u1',
        reviewerName: '  Marta  ',
      },
      lines,
    )
    expect(name.reviewerId).toBeNull()
    expect(name.reviewerName).toBe('Marta')
  })

  it('arma la fecha del conteo, las observaciones y las líneas', () => {
    const input = buildCountInput(
      { ...baseHeader, notes: ' Depósito del fondo ' },
      [{ supplyId: 's1', countedQty: 0 }],
    )
    expect(input.countedAt).toBe('2026-10-26T10:00:00-03:00')
    expect(input.notes).toBe('Depósito del fondo')
    expect(input.lines).toEqual([{ supplyId: 's1', countedQty: 0 }])
  })
})

describe('filas en blanco del control (IS-31)', () => {
  it('las filas en blanco no se mandan: significan «no tocar»', () => {
    const { lines, errors } = buildCountLines({
      s1: '12',
      s2: '',
      s3: '   ',
      s4: '0',
    })
    expect(lines).toEqual([
      { supplyId: 's1', countedQty: 12 },
      { supplyId: 's4', countedQty: 0 },
    ])
    expect(errors.size).toBe(0)
  })

  it('el cero es un conteo válido', () => {
    expect(buildCountLines({ s1: '0' }).lines).toEqual([
      { supplyId: 's1', countedQty: 0 },
    ])
  })

  it('un valor que no es un entero de cero en adelante queda como error de esa fila', () => {
    const { lines, errors } = buildCountLines({
      s1: '3,5',
      s2: '-2',
      s3: 'doce',
      s4: '7',
    })
    expect(lines).toEqual([{ supplyId: 's4', countedQty: 7 }])
    expect(Array.from(errors.keys())).toEqual(['s1', 's2', 's3'])
  })

  it('sin ninguna fila cargada no hay líneas', () => {
    expect(buildCountLines({}).lines).toEqual([])
  })
})

describe('movimientos posteriores a la hora del control (IS-31)', () => {
  const countedAt = '2026-10-26T10:00:00-03:00'

  it('cuenta los movimientos del artículo posteriores a esa hora y lo que movieron', () => {
    const later = laterMovementsBySupply(
      [
        // Antes del control: no cuenta.
        testMovementLine({
          movementId: 'a',
          lineId: 'a1',
          recordedAt: '2026-10-26T12:00:00Z',
          qtyDelta: 5,
        }),
        // Después del control: dos movimientos del mismo artículo.
        testMovementLine({
          movementId: 'b',
          lineId: 'b1',
          recordedAt: '2026-10-26T14:00:00Z',
          kind: 'withdrawal',
          qtyDelta: -3,
        }),
        testMovementLine({
          movementId: 'c',
          lineId: 'c1',
          recordedAt: '2026-10-26T16:00:00Z',
          kind: 'entry',
          qtyDelta: 10,
        }),
        // Otro artículo.
        testMovementLine({
          movementId: 'd',
          lineId: 'd1',
          supplyId: 's2',
          recordedAt: '2026-10-26T15:00:00Z',
          qtyDelta: -1,
        }),
      ],
      countedAt,
    )
    expect(later.get('s1')).toEqual({ count: 2, netDelta: 7 })
    expect(later.get('s2')).toEqual({ count: 1, netDelta: -1 })
    expect(later.has('s3')).toBe(false)
  })

  it('un movimiento con varias líneas del mismo artículo cuenta una vez', () => {
    const later = laterMovementsBySupply(
      [
        testMovementLine({
          movementId: 'b',
          lineId: 'b1',
          recordedAt: '2026-10-26T14:00:00Z',
          qtyDelta: -1,
        }),
        testMovementLine({
          movementId: 'b',
          lineId: 'b2',
          recordedAt: '2026-10-26T14:00:00Z',
          qtyDelta: -1,
        }),
      ],
      countedAt,
    )
    expect(later.get('s1')?.count).toBe(1)
  })

  it('el aviso dice cuántos movimientos tuvo y que se tienen en cuenta', () => {
    expect(describeLaterMovements(2)).toBe(
      'Tuvo 2 movimientos después de esa hora; se tienen en cuenta.',
    )
    expect(describeLaterMovements(1)).toBe(
      'Tuvo 1 movimiento después de esa hora; se tiene en cuenta.',
    )
  })

  it('el stock a esa hora es el actual menos lo movido después', () => {
    expect(systemQtyAt({ stockQty: 12 }, { count: 2, netDelta: 7 })).toBe(5)
    expect(systemQtyAt({ stockQty: 12 }, undefined)).toBe(12)
  })
})
