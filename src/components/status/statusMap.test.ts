import { describe, expect, it } from 'vitest'
import { getTableRowVariant, TABLE_ROW_CLASS_NAME } from './statusMap'

describe('getTableRowVariant (AJ-02, AJ-07)', () => {
  it('on_the_way pinta la fila en celeste pastel (info)', () => {
    expect(getTableRowVariant({ assignmentStatuses: ['on_the_way'] })).toBe(
      'info',
    )
    expect(TABLE_ROW_CLASS_NAME.info).toBe('bg-info-bg')
  })

  it('late pinta la fila en amarillo pastel (warn)', () => {
    expect(getTableRowVariant({ assignmentStatuses: ['late'] })).toBe('warn')
  })

  it('crit gana sobre warn y warn sobre info', () => {
    expect(
      getTableRowVariant({ assignmentStatuses: ['on_the_way', 'no_record'] }),
    ).toBe('crit')
    expect(
      getTableRowVariant({ assignmentStatuses: ['on_the_way', 'late'] }),
    ).toBe('warn')
  })
})
