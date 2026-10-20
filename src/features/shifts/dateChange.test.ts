import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/errors'
import {
  canEditShiftDate,
  dateWarningLines,
  shiftDateErrorMessage,
} from './dateChange'

describe('canEditShiftDate', () => {
  it('solo antes de que el turno empiece', () => {
    expect(canEditShiftDate('scheduled')).toBe(true)
    expect(canEditShiftDate('assigned')).toBe(true)
    expect(canEditShiftDate('in_progress')).toBe(false)
    expect(canEditShiftDate('completed')).toBe(false)
    expect(canEditShiftDate('cancelled')).toBe(false)
  })
})

describe('dateWarningLines', () => {
  it('sin advertencias no devuelve nada', () => {
    expect(
      dateWarningLines({ holiday: false, outsideAvailability: [] }),
    ).toEqual([])
  })

  it('arma las líneas de feriado y de disponibilidad con los nombres', () => {
    expect(
      dateWarningLines({
        holiday: true,
        outsideAvailability: [
          { employeeId: 'e1', employeeName: 'Ana Gómez' },
          { employeeId: 'e2', employeeName: 'Luis Díaz' },
        ],
      }),
    ).toEqual([
      'La fecha nueva es feriado.',
      'Ana Gómez, Luis Díaz están fuera de su disponibilidad declarada en esa fecha y franja.',
    ])
  })
})

describe('shiftDateErrorMessage', () => {
  it('mapea los códigos de la fecha y deja pasar el mensaje del resto', () => {
    expect(
      shiftDateErrorMessage(new ApiError('x', 'SHIFT_DATE_TAKEN'), 'f'),
    ).toContain('otro turno ese día')
    expect(
      shiftDateErrorMessage(
        new ApiError('Ana está de licencia.', 'ON_LEAVE'),
        'f',
      ),
    ).toBe('Ana está de licencia.')
    expect(
      shiftDateErrorMessage(
        new ApiError('Ana queda superpuesta.', 'ASSIGNMENT_OVERLAP'),
        'f',
      ),
    ).toBe('Ana queda superpuesta.')
    expect(shiftDateErrorMessage(new Error('red'), 'fallback')).toBe('fallback')
  })
})
