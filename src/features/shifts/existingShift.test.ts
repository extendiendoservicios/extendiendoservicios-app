import { describe, expect, it } from 'vitest'
import { parseConflictDetail } from '@/api/errors'
import {
  assignedText,
  editShiftPath,
  existingShiftFromConflict,
  whenText,
  whereText,
} from './existingShift'

describe('existingShift (OH-10)', () => {
  it('arma el turno existente desde el detalle de SHIFT_DATE_TAKEN', () => {
    const info = existingShiftFromConflict(
      parseConflictDetail({
        shift_id: 'sh9',
        conflict_shift_id: 'sh9',
        client_name: 'Limpia Ya',
        site_name: 'Sede Centro',
        service_name: null,
        shift_date: '2026-08-13',
        start_time: '08:00:00',
        end_time: '12:00:00',
        open_ended: false,
        assigned: [
          { employee_id: 'e1', employee_name: 'Ana Gómez' },
          { employee_id: 'e2', employee_name: 'Luis Paz' },
        ],
      }),
    )
    expect(info).toMatchObject({
      shiftId: 'sh9',
      serviceName: null,
      assigned: ['Ana Gómez', 'Luis Paz'],
    })
    expect(info && whenText(info)).toBe('jue 13 ago · 08:00–12:00')
    expect(info && whereText(info)).toBe('Limpia Ya · Sede Centro')
  })

  it('sin id del turno no hay nada para mostrar', () => {
    expect(existingShiftFromConflict(null)).toBeNull()
    expect(existingShiftFromConflict(parseConflictDetail({}))).toBeNull()
  })

  it('dice quién está asignado, en singular y en plural, o que no hay nadie', () => {
    expect(assignedText([])).toBe('Sin personas asignadas')
    expect(assignedText(['Ana Gómez'])).toBe('Asignado: Ana Gómez')
    expect(assignedText(['Ana Gómez', 'Luis Paz'])).toBe(
      'Asignados: Ana Gómez, Luis Paz',
    )
  })

  it('la ruta de edición es la de ADM-07', () => {
    expect(editShiftPath('sh9')).toBe('/admin/turnos/sh9/editar')
  })
})
