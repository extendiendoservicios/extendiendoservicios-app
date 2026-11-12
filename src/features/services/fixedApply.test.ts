import { describe, expect, it } from 'vitest'
import type { FixedApplyResult, FixedApplySkipped } from '@/api/services'
import { describeSkipped, summarizeFixedApply } from './fixedApply'

const BASE: FixedApplyResult = {
  fromDate: '2026-11-02',
  updatedCount: 0,
  unchangedCount: 0,
  skippedCount: 0,
  assignmentsRemoved: 0,
  assignmentsAdded: 0,
  updated: [],
  skipped: [],
}

describe('summarizeFixedApply', () => {
  it('cuenta los turnos actualizados', () => {
    expect(summarizeFixedApply({ ...BASE, updatedCount: 5 })).toBe(
      'Actualizamos 5 turnos.',
    )
    expect(summarizeFixedApply({ ...BASE, updatedCount: 1 })).toBe(
      'Actualizamos 1 turno.',
    )
  })

  it('sin cambios lo dice', () => {
    expect(summarizeFixedApply(BASE)).toBe('No actualizamos ningún turno.')
  })

  it('suma los turnos salteados', () => {
    expect(
      summarizeFixedApply({ ...BASE, updatedCount: 3, skippedCount: 2 }),
    ).toBe('Actualizamos 3 turnos; se saltearon 2 turnos.')
    expect(
      summarizeFixedApply({ ...BASE, updatedCount: 3, skippedCount: 1 }),
    ).toBe('Actualizamos 3 turnos; se salteó 1 turno.')
  })

  it('avisa los turnos donde no se pudo asignar a un fijo', () => {
    const skipped: FixedApplySkipped[] = [
      {
        scope: 'employee',
        shiftId: 'sh1',
        shiftDate: '2026-11-03',
        employeeId: 'e1',
        employeeName: 'Ana Gómez',
        code: 'ON_LEAVE',
        message: 'Tiene una licencia ese día.',
        detail: null,
      },
    ]
    expect(
      summarizeFixedApply({ ...BASE, updatedCount: 1, skipped }),
    ).toContain('en 1 turno no se pudo asignar a algún empleado fijo')
  })
})

describe('describeSkipped', () => {
  it('turno salteado: fecha y motivo', () => {
    expect(
      describeSkipped({
        scope: 'shift',
        shiftId: 'sh1',
        shiftDate: '2026-11-04',
        employeeId: null,
        employeeName: null,
        code: 'SHIFT_STARTED',
        message: 'El turno ya empezó.',
        detail: null,
      }),
    ).toBe('mié 4 nov: El turno ya empezó.')
  })

  it('empleado salteado: fecha, empleado y motivo', () => {
    expect(
      describeSkipped({
        scope: 'employee',
        shiftId: 'sh1',
        shiftDate: '2026-11-03',
        employeeId: 'e1',
        employeeName: 'Ana Gómez',
        code: 'ON_LEAVE',
        message: 'Tiene una licencia ese día.',
        detail: null,
      }),
    ).toBe('mar 3 nov · Ana Gómez: Tiene una licencia ese día.')
  })
})
