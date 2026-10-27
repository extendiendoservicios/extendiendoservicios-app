import { describe, expect, it } from 'vitest'
import { withdrawalSchema, withdrawalValuesToInput } from './schemas'
import {
  findInsufficientLines,
  isPersonOnShift,
  orderShiftsForPerson,
} from './withdrawal'

const valid = {
  personId: 'p1',
  place: 'shift' as const,
  shiftId: 't1',
  siteId: '',
  note: '',
  lines: [{ supplyId: 's1', qty: '3' }],
}

function messages(values: unknown): string[] {
  const result = withdrawalSchema.safeParse(values)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

describe('withdrawalSchema: retiro en nombre de otra persona (IS-11, IS-12)', () => {
  it('con persona, turno y artículos es válido, sin observación', () => {
    expect(withdrawalSchema.safeParse(valid).success).toBe(true)
  })

  it('pide quién retira', () => {
    expect(messages({ ...valid, personId: '' })).toContain(
      'Elegí quién retira.',
    )
  })

  it('con turno, pide el turno', () => {
    expect(messages({ ...valid, shiftId: '' })).toContain(
      'Elegí el turno para el que retira.',
    )
  })

  it('con sede, pide la sede y una observación obligatoria', () => {
    const site = { ...valid, place: 'site' as const, shiftId: '' }
    const found = messages(site)
    expect(found).toContain('Elegí la sede para la que retira.')
    expect(found.join(' ')).toContain('escribí una observación')
    expect(
      withdrawalSchema.safeParse({
        ...site,
        siteId: 'si1',
        note: 'Reposición de la semana',
      }).success,
    ).toBe(true)
  })

  it('pide al menos un artículo, con cantidad entera mayor a cero y sin repetirse', () => {
    expect(messages({ ...valid, lines: [] })).toContain(
      'Agregá al menos un artículo.',
    )
    expect(
      messages({ ...valid, lines: [{ supplyId: 's1', qty: '0' }] }),
    ).toContain('La cantidad tiene que ser mayor a cero.')
    expect(
      messages({ ...valid, lines: [{ supplyId: 's1', qty: '1,5' }] }),
    ).toContain('La cantidad tiene que ser un número entero.')
    expect(
      messages({
        ...valid,
        lines: [
          { supplyId: 's1', qty: '1' },
          { supplyId: 's1', qty: '2' },
        ],
      }),
    ).toContain('Un artículo no puede repetirse en el mismo retiro.')
  })

  it('manda el turno o la sede, nunca los dos, y la persona elegida', () => {
    expect(withdrawalValuesToInput({ ...valid, siteId: 'si-viejo' })).toEqual({
      personId: 'p1',
      shiftId: 't1',
      siteId: null,
      note: null,
      lines: [{ supplyId: 's1', qty: 3 }],
    })
    expect(
      withdrawalValuesToInput({
        ...valid,
        place: 'site',
        shiftId: 't-viejo',
        siteId: 'si1',
        note: ' Reposición ',
      }),
    ).toMatchObject({ shiftId: null, siteId: 'si1', note: 'Reposición' })
  })
})

describe('findInsufficientLines (IS-13)', () => {
  const items = new Map([
    ['s1', { stockQty: 5 }],
    ['s2', { stockQty: 0 }],
  ])

  it('marca las líneas que superan el stock disponible', () => {
    expect(
      findInsufficientLines(
        [
          { supplyId: 's1', qty: '5' },
          { supplyId: 's1', qty: '6' },
          { supplyId: 's2', qty: '1' },
        ],
        items,
      ),
    ).toEqual([
      { index: 1, supplyId: 's1', available: 5 },
      { index: 2, supplyId: 's2', available: 0 },
    ])
  })

  it('ignora las cantidades que todavía no son un número', () => {
    expect(
      findInsufficientLines([{ supplyId: 's1', qty: 'x' }], items),
    ).toEqual([])
  })
})

describe('orderShiftsForPerson: turnos de la persona primero (IS-35)', () => {
  const shift = (
    shiftId: string,
    assignedEmployeeIds: string[],
    supervisorIds: string[],
  ) => ({
    shiftId,
    shiftDate: '2026-10-26',
    startTime: '08:00:00',
    shiftStatus: 'scheduled',
    assignedEmployeeIds,
    supervisorIds,
  })
  const shifts = [
    shift('a', ['e2'], []),
    shift('b', ['e1'], ['s1']),
    shift('c', [], ['s1']),
    shift('d', ['e1', 'e2'], []),
  ]

  it('sin persona elegida deja el orden y no marca nada', () => {
    const ordered = orderShiftsForPerson(shifts, '', false)
    expect(ordered.map((entry) => entry.shift.shiftId)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
    expect(ordered.some((entry) => entry.ofPerson)).toBe(false)
  })

  it('un empleado ve primero los turnos en los que está asignado, sin perder el resto', () => {
    const ordered = orderShiftsForPerson(shifts, 'e1', false)
    expect(ordered.map((entry) => entry.shift.shiftId)).toEqual([
      'b',
      'd',
      'a',
      'c',
    ])
    expect(ordered.map((entry) => entry.ofPerson)).toEqual([
      true,
      true,
      false,
      false,
    ])
  })

  it('un coordinador ve primero los turnos que coordina', () => {
    const ordered = orderShiftsForPerson(shifts, 's1', true)
    expect(ordered.map((entry) => entry.shift.shiftId)).toEqual([
      'b',
      'c',
      'a',
      'd',
    ])
  })

  it('el id de un empleado no cuenta como coordinador ni al revés', () => {
    expect(isPersonOnShift(shifts[1]!, 'e1', true)).toBe(false)
    expect(isPersonOnShift(shifts[1]!, 's1', false)).toBe(false)
  })
})
