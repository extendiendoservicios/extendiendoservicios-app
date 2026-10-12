import { describe, expect, it } from 'vitest'
import {
  serviceFormSchema,
  serviceFormValuesToInput,
  weeksOfMonthFromFormValues,
  weeksOfMonthSchema,
  weeksOfMonthToFormValues,
} from './schemas'

/**
 * SERVICE-001: esquema zod de ADM-25, replica las restricciones de
 * `0007_services_shifts_assignments.sql` (días de la semana, rango
 * horario, dotación 1..10) y la decisión de Mike (P10.0, 25 sep 2026):
 * "Trabaja los feriados" viene marcado por defecto.
 */

const baseValues = {
  clientId: 'c1',
  siteId: 'si1',
  name: 'Limpieza mañana',
  weekdays: ['1', '2', '3', '4', '5'],
  startTime: '08:00',
  endTime: '12:00',
  requiredStaff: '2',
  validFrom: '2026-01-01',
  validTo: '',
  worksOnHolidays: true,
  minHoursMonth: '',
  maxHoursMonth: '',
  status: 'active' as const,
  notes: '',
}

describe('serviceFormSchema: «A terminar» (AJ2-10)', () => {
  it('no pide hora de fin con «A terminar» y manda fin null', () => {
    const values = { ...baseValues, endTime: '', openEnded: true }
    const result = serviceFormSchema.safeParse(values)
    expect(result.success).toBe(true)
    if (result.success) {
      const input = serviceFormValuesToInput(result.data)
      expect(input.openEnded).toBe(true)
      expect(input.endTime).toBeNull()
    }
  })

  it('sin «A terminar» exige el fin y que sea posterior al inicio', () => {
    expect(
      serviceFormSchema.safeParse({ ...baseValues, endTime: '' }).success,
    ).toBe(false)
    expect(
      serviceFormSchema.safeParse({
        ...baseValues,
        startTime: '12:00',
        endTime: '08:00',
      }).success,
    ).toBe(false)
  })
})

describe('serviceFormSchema', () => {
  it('acepta un alta completa', () => {
    const result = serviceFormSchema.safeParse(baseValues)
    expect(result.success).toBe(true)
  })

  it('rechaza sin ningún día de la semana elegido', () => {
    const result = serviceFormSchema.safeParse({ ...baseValues, weekdays: [] })
    expect(result.success).toBe(false)
  })

  it('rechaza cuando la hora de fin no es posterior a la de inicio', () => {
    const result = serviceFormSchema.safeParse({
      ...baseValues,
      startTime: '12:00',
      endTime: '08:00',
    })
    expect(result.success).toBe(false)
  })

  it('rechaza una dotación fuera de 1..10', () => {
    const result = serviceFormSchema.safeParse({
      ...baseValues,
      requiredStaff: '11',
    })
    expect(result.success).toBe(false)
  })

  it('rechaza una dotación con letras', () => {
    const result = serviceFormSchema.safeParse({
      ...baseValues,
      requiredStaff: 'dos',
    })
    expect(result.success).toBe(false)
  })

  it('rechaza "hasta" anterior a "desde"', () => {
    const result = serviceFormSchema.safeParse({
      ...baseValues,
      validFrom: '2026-06-01',
      validTo: '2026-01-01',
    })
    expect(result.success).toBe(false)
  })

  it('acepta sin fecha "hasta" (vigencia sin fin)', () => {
    const result = serviceFormSchema.safeParse({ ...baseValues, validTo: '' })
    expect(result.success).toBe(true)
  })

  it('rechaza horas máximas menores que las mínimas', () => {
    const result = serviceFormSchema.safeParse({
      ...baseValues,
      minHoursMonth: '80',
      maxHoursMonth: '40',
    })
    expect(result.success).toBe(false)
  })

  it('rechaza sin elegir cliente', () => {
    const result = serviceFormSchema.safeParse({ ...baseValues, clientId: '' })
    expect(result.success).toBe(false)
  })

  it('rechaza sin elegir sede', () => {
    const result = serviceFormSchema.safeParse({ ...baseValues, siteId: '' })
    expect(result.success).toBe(false)
  })
})

describe('serviceFormValuesToInput', () => {
  it('ordena y quita repetidos de los días de la semana, y convierte los números', () => {
    const parsed = serviceFormSchema.parse({
      ...baseValues,
      weekdays: ['5', '1', '1', '3'],
      requiredStaff: '3',
      minHoursMonth: '40',
      maxHoursMonth: '80',
    })
    const input = serviceFormValuesToInput(parsed)
    expect(input.weekdays).toEqual([1, 3, 5])
    expect(input.requiredStaff).toBe(3)
    expect(input.minHoursMonth).toBe(40)
    expect(input.maxHoursMonth).toBe(80)
  })

  it('vacíos opcionales se guardan como null', () => {
    const parsed = serviceFormSchema.parse(baseValues)
    const input = serviceFormValuesToInput(parsed)
    expect(input.validTo).toBeNull()
    expect(input.minHoursMonth).toBeNull()
    expect(input.maxHoursMonth).toBeNull()
    expect(input.notes).toBeNull()
  })

  it('conserva "trabaja los feriados" marcado por defecto (P10.0)', () => {
    const parsed = serviceFormSchema.parse(baseValues)
    const input = serviceFormValuesToInput(parsed)
    expect(input.worksOnHolidays).toBe(true)
  })
})

describe('serviceFormSchema: repetición mensual (AJ3-05)', () => {
  it('sin elegir nada se repite todas las semanas (null)', () => {
    const result = serviceFormSchema.safeParse(baseValues)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(serviceFormValuesToInput(result.data).weeksOfMonth).toBeNull()
    }
  })

  it('«Todas las semanas» manda null aunque haya casillas tildadas', () => {
    const result = serviceFormSchema.safeParse({
      ...baseValues,
      weeksMode: 'all',
      weeksOfMonth: ['1'],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(serviceFormValuesToInput(result.data).weeksOfMonth).toBeNull()
    }
  })

  it('«Solo algunas semanas» exige al menos una', () => {
    const result = serviceFormSchema.safeParse({
      ...baseValues,
      weeksMode: 'some',
      weeksOfMonth: [],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['weeksOfMonth'])
      expect(result.error.issues[0]?.message).toBe(
        'Elegí al menos una semana del mes.',
      )
    }
  })

  it('manda las semanas como números ordenados', () => {
    const result = serviceFormSchema.safeParse({
      ...baseValues,
      weeksMode: 'some',
      weeksOfMonth: ['5', '1', '2'],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(serviceFormValuesToInput(result.data).weeksOfMonth).toEqual([
        1, 2, 5,
      ])
    }
  })

  it('weeksOfMonthSchema replica el check: no vacío, sin repetidos, 1 a 5', () => {
    expect(weeksOfMonthSchema.safeParse([1, 5]).success).toBe(true)
    expect(weeksOfMonthSchema.safeParse([]).success).toBe(false)
    expect(weeksOfMonthSchema.safeParse([1, 1]).success).toBe(false)
    expect(weeksOfMonthSchema.safeParse([0]).success).toBe(false)
    expect(weeksOfMonthSchema.safeParse([6]).success).toBe(false)
  })

  it('mapea desde y hacia la columna', () => {
    expect(weeksOfMonthToFormValues(null)).toEqual({
      weeksMode: 'all',
      weeksOfMonth: [],
    })
    expect(weeksOfMonthToFormValues([2, 5])).toEqual({
      weeksMode: 'some',
      weeksOfMonth: ['2', '5'],
    })
    expect(
      weeksOfMonthFromFormValues(weeksOfMonthToFormValues([2, 5])),
    ).toEqual([2, 5])
  })
})
