import { describe, expect, it } from 'vitest'
import type { FixedPatternRow, WeekBoardBlock } from '@/api/employeeFixed'
import {
  addBlock,
  blocksFromPattern,
  blocksOfWeekday,
  duplicateBlock,
  editBoardTime,
  formatBoardWeeks,
  MAX_BOARD_BLOCKS,
  MAX_LABEL_LENGTH,
  moveBlock,
  removeBlock,
  SCREEN_WEEKDAYS,
  screenIndexToWeekday,
  updateBlock,
  weekdayAtPoint,
  weekdayToScreenIndex,
} from './weekBoard'

function pattern(over: Partial<FixedPatternRow> = {}): FixedPatternRow {
  return {
    serviceId: 'sv1',
    serviceName: 'Limpieza',
    clientId: 'c1',
    clientName: 'Cliente',
    siteId: 'si1',
    siteName: 'Sede Central',
    calendarColor: 3,
    weekdays: [1, 3],
    weeksOfMonth: null,
    startTime: '08:00:00',
    endTime: '12:30:00',
    openEnded: false,
    validFrom: '2026-01-01',
    validTo: null,
    ...over,
  }
}

function block(over: Partial<WeekBoardBlock> = {}): WeekBoardBlock {
  return {
    id: 'b1',
    weekday: 1,
    start: '08:00',
    end: '12:00',
    label: 'SEDE',
    colorIndex: 2,
    serviceId: null,
    ...over,
  }
}

describe('conversión de weekday (0 = domingo en la base, lunes primero en pantalla)', () => {
  it('ordena la pantalla de lunes a domingo', () => {
    expect([...SCREEN_WEEKDAYS]).toEqual([1, 2, 3, 4, 5, 6, 0])
  })

  it('pasa de weekday de la base a posición de pantalla y de vuelta', () => {
    expect(weekdayToScreenIndex(1)).toBe(0)
    expect(weekdayToScreenIndex(6)).toBe(5)
    expect(weekdayToScreenIndex(0)).toBe(6)
    for (let index = 0; index < 7; index += 1) {
      expect(weekdayToScreenIndex(screenIndexToWeekday(index))).toBe(index)
    }
  })
})

describe('blocksFromPattern', () => {
  it('arma un bloque por servicio y por día, con el color del cliente', () => {
    const blocks = blocksFromPattern([pattern()])
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({
      weekday: 1,
      start: '08:00',
      end: '12:30',
      label: 'SEDE CENTRAL',
      colorIndex: 3,
      serviceId: 'sv1',
    })
    expect(blocks.map((b) => b.weekday)).toEqual([1, 3])
    expect(new Set(blocks.map((b) => b.id)).size).toBe(2)
  })

  it('mantiene el domingo (0) al final del orden de pantalla', () => {
    const blocks = blocksFromPattern([pattern({ weekdays: [0, 6, 2] })])
    expect(blocks.map((b) => b.weekday)).toEqual([2, 6, 0])
  })

  it('agrega las semanas del mes al nombre cuando no son todas', () => {
    const blocks = blocksFromPattern([
      pattern({ weekdays: [2], weeksOfMonth: [3, 1] }),
    ])
    expect(blocks[0]?.label).toBe('SEDE CENTRAL (1.ª y 3.ª)')
  })

  it('un turno abierto queda sin hora de fin', () => {
    const blocks = blocksFromPattern([pattern({ openEnded: true })])
    expect(blocks[0]?.end).toBeNull()
  })

  it('no pasa de 60 bloques ni de 80 caracteres en el nombre', () => {
    const many = blocksFromPattern(
      Array.from({ length: 12 }, (_, i) =>
        pattern({
          serviceId: `sv${i}`,
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          siteName: 'X'.repeat(120),
        }),
      ),
    )
    expect(many).toHaveLength(MAX_BOARD_BLOCKS)
    expect(many[0]?.label.length).toBe(MAX_LABEL_LENGTH)
  })
})

describe('formatBoardWeeks', () => {
  it('formatea una, dos y tres semanas, y la última', () => {
    expect(formatBoardWeeks([2])).toBe('2.ª')
    expect(formatBoardWeeks([1, 3])).toBe('1.ª y 3.ª')
    expect(formatBoardWeeks([1, 2, 4])).toBe('1.ª, 2.ª y 4.ª')
    expect(formatBoardWeeks([5])).toBe('última')
  })
})

describe('operaciones de la pizarra', () => {
  it('agrega un bloque nuevo con valores por defecto y respeta el tope', () => {
    const next = addBlock([], 3)
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ weekday: 3, start: '08:00', end: '12:00' })
    const full = Array.from({ length: MAX_BOARD_BLOCKS }, (_, i) =>
      block({ id: `b${i}` }),
    )
    expect(addBlock(full, 1)).toBe(full)
    expect(duplicateBlock(full, 'b1')).toBe(full)
  })

  it('duplica con otro identificador, en el mismo día', () => {
    const next = duplicateBlock([block()], 'b1')
    expect(next).toHaveLength(2)
    expect(next[1]).toMatchObject({ weekday: 1, label: 'SEDE' })
    expect(next[1]?.id).not.toBe('b1')
  })

  it('mueve de día, edita y borra sin tocar el resto', () => {
    const base = [block(), block({ id: 'b2', weekday: 2 })]
    expect(moveBlock(base, 'b1', 5)[0]?.weekday).toBe(5)
    expect(updateBlock(base, 'b2', { colorIndex: 7 })[1]?.colorIndex).toBe(7)
    expect(
      updateBlock(base, 'b1', { label: 'Y'.repeat(100) })[0]?.label,
    ).toHaveLength(MAX_LABEL_LENGTH)
    expect(removeBlock(base, 'b1').map((b) => b.id)).toEqual(['b2'])
  })

  it('ordena los bloques de un día por hora de inicio', () => {
    const base = [
      block({ id: 'tarde', start: '14:00' }),
      block({ id: 'manana', start: '07:00' }),
      block({ id: 'otro', weekday: 2 }),
    ]
    expect(blocksOfWeekday(base, 1).map((b) => b.id)).toEqual([
      'manana',
      'tarde',
    ])
  })
})

describe('editBoardTime', () => {
  it('acepta HH:MM y rechaza otros formatos', () => {
    expect(editBoardTime('start', '09:30')).toEqual({
      ok: true,
      patch: { start: '09:30' },
    })
    expect(editBoardTime('start', '').ok).toBe(false)
    expect(editBoardTime('end', '24:00').ok).toBe(false)
  })

  it('el fin vacío significa sin hora de fin', () => {
    expect(editBoardTime('end', '')).toEqual({ ok: true, patch: { end: null } })
  })
})

describe('weekdayAtPoint', () => {
  const rects = [
    { weekday: 1, left: 0, right: 100, top: 0, bottom: 200 },
    { weekday: 0, left: 100, right: 200, top: 0, bottom: 200 },
  ]
  it('devuelve la columna del punto o null', () => {
    expect(weekdayAtPoint(rects, 50, 50)).toBe(1)
    expect(weekdayAtPoint(rects, 150, 50)).toBe(0)
    expect(weekdayAtPoint(rects, 500, 50)).toBeNull()
  })
})
