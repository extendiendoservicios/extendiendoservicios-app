import { describe, expect, it } from 'vitest'

import { fromPostgrestError, UNKNOWN_ERROR_MESSAGE } from './errors'

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
