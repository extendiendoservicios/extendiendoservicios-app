import { describe, expect, it } from 'vitest'

import {
  fromPostgrestError,
  parseConflictDetail,
  UNKNOWN_ERROR_MESSAGE,
} from './errors'

describe('fromPostgrestError', () => {
  it('deja pasar tal cual el mensaje de una RPC propia (hint en mayúsculas)', () => {
    const error = fromPostgrestError({
      code: 'P0001',
      message: 'No podés quitarle el rol al último dueño.',
      hint: 'LAST_OWNER',
    })
    expect(error.message).toBe('No podés quitarle el rol al último dueño.')
    expect(error.hint).toBe('LAST_OWNER')
  })

  it('traduce una restricción de Postgres y nunca muestra el texto en inglés', () => {
    const error = fromPostgrestError({
      code: '23514',
      message: 'new row for relation "holidays" violates check constraint',
      hint: null,
    })
    expect(error.message).not.toMatch(/violates|relation/)
    expect(error.hint).toBe('VALIDATION_ERROR')
  })

  it('traduce un permiso denegado por RLS', () => {
    const error = fromPostgrestError({
      code: '42501',
      message:
        'new row violates row-level security policy for table "holidays"',
      hint: null,
    })
    expect(error.message).toBe('No tenés permiso para hacer esto.')
    expect(error.hint).toBe('FORBIDDEN')
  })

  it('usa el mensaje genérico si el código no se conoce', () => {
    const error = fromPostgrestError({
      code: 'XX000',
      message: 'internal error',
      hint: 'Some English hint from Postgres.',
    })
    expect(error.message).toBe(UNKNOWN_ERROR_MESSAGE)
    expect(error.hint).toBeNull()
  })
})

describe('detalle del choque (OF-08)', () => {
  it('lleva el detail de la asignación solapada al ApiError', () => {
    const error = fromPostgrestError({
      code: 'P0001',
      message:
        'Acosta ya está en YPF RUTA (YPF RUTA TURNO TARDE) el lun 9/11 de 15:00 a 17:00.',
      hint: 'ASSIGNMENT_OVERLAP',
      details: JSON.stringify({
        conflict_shift_id: 'sh-1',
        conflict_assignment_id: 'as-1',
        site_name: 'YPF RUTA',
        service_name: 'YPF RUTA TURNO TARDE',
        shift_date: '2026-11-09',
        start_time: '15:00:00',
        end_time: '17:00:00',
        open_ended: false,
      }),
    })
    expect(error.hint).toBe('ASSIGNMENT_OVERLAP')
    expect(error.message).toContain('Acosta ya está en YPF RUTA')
    expect(error.detail?.conflictShiftId).toBe('sh-1')
    expect(error.detail?.siteName).toBe('YPF RUTA')
    expect(error.detail?.leaves).toEqual([])
  })

  it('trae las licencias con ON_LEAVE', () => {
    const detail = parseConflictDetail({
      leaves: [
        {
          leave_id: 'l1',
          reason: 'Vacaciones',
          starts_on: '2026-11-03',
          ends_on: '2026-11-10',
        },
      ],
    })
    expect(detail?.conflictShiftId).toBeNull()
    expect(detail?.leaves[0]).toEqual({
      leaveId: 'l1',
      reason: 'Vacaciones',
      startsOn: '2026-11-03',
      endsOn: '2026-11-10',
    })
  })

  it('devuelve null si el detail no es un objeto JSON', () => {
    expect(parseConflictDetail('texto suelto')).toBeNull()
    expect(parseConflictDetail(null)).toBeNull()
    expect(parseConflictDetail('[1,2]')).toBeNull()
    expect(
      fromPostgrestError({
        code: 'P0001',
        message: 'x',
        hint: 'SHIFT_FULL',
        details: 'no es json',
      }).detail,
    ).toBeNull()
  })
})
