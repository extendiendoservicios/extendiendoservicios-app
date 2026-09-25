import { describe, expect, it } from 'vitest'
import {
  assignEmployeeSchema,
  assignmentTimeSchema,
  shiftDetailsFormValuesToInput,
  shiftDetailsSchema,
} from './schemas'

describe('assignmentTimeSchema', () => {
  it('acepta sin franja propia (hereda la del turno, P-046)', () => {
    const result = assignmentTimeSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('acepta con las dos horas cargadas', () => {
    const result = assignmentTimeSchema.safeParse({
      startTime: '09:00',
      endTime: '13:00',
    })
    expect(result.success).toBe(true)
  })

  it('rechaza si falta una de las dos horas', () => {
    const result = assignmentTimeSchema.safeParse({ startTime: '09:00' })
    expect(result.success).toBe(false)
  })

  it('rechaza fin anterior o igual al inicio', () => {
    const result = assignmentTimeSchema.safeParse({
      startTime: '13:00',
      endTime: '13:00',
    })
    expect(result.success).toBe(false)
  })
})

describe('assignEmployeeSchema', () => {
  it('exige el empleado', () => {
    const result = assignEmployeeSchema.safeParse({ employeeId: '' })
    expect(result.success).toBe(false)
  })

  it('acepta empleado sin franja propia', () => {
    const result = assignEmployeeSchema.safeParse({ employeeId: 'emp1' })
    expect(result.success).toBe(true)
  })
})

describe('shiftDetailsSchema', () => {
  it('rechaza dotación fuera de 1 a 10', () => {
    const result = shiftDetailsSchema.safeParse({ requiredStaff: '11' })
    expect(result.success).toBe(false)
  })

  it('acepta dotación válida sin notas', () => {
    const result = shiftDetailsSchema.safeParse({ requiredStaff: '3' })
    expect(result.success).toBe(true)
  })

  it('shiftDetailsFormValuesToInput normaliza notas vacías a null', () => {
    const input = shiftDetailsFormValuesToInput({
      requiredStaff: '3',
      notes: '   ',
    })
    expect(input).toEqual({ requiredStaff: 3, notes: null })
  })
})
