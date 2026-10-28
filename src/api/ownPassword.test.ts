import { FunctionsHttpError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { changeOwnPassword } from './ownPassword'
import { ApiError } from './errors'

/**
 * P26.3 (CR-04/CR-13): el cambio propio va por `admin-users`, nunca por
 * `auth.updateUser`.
 */
const { invokeMock, updateUserMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  updateUserMock: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: invokeMock },
    auth: { updateUser: updateUserMock },
  },
}))

function httpError(body: unknown, status = 400): FunctionsHttpError {
  return new FunctionsHttpError(new Response(JSON.stringify(body), { status }))
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return error as ApiError
  }
  throw new Error('Se esperaba un rechazo.')
}

beforeEach(() => {
  invokeMock.mockReset()
  updateUserMock.mockReset()
})

describe('changeOwnPassword', () => {
  it('invoca admin-users con la acción, la contraseña y el origen', async () => {
    invokeMock.mockResolvedValue({
      data: { data: { profile_id: 'user-1' } },
      error: null,
    })

    await expect(
      changeOwnPassword('contraseña-larga-1', 'recovery'),
    ).resolves.toBeUndefined()

    expect(invokeMock).toHaveBeenCalledWith('admin-users', {
      body: {
        action: 'change_own_password',
        new_password: 'contraseña-larga-1',
        origin: 'recovery',
      },
    })
    expect(updateUserMock).not.toHaveBeenCalled()
  })

  it('VALIDATION_ERROR: muestra el motivo en español que devuelve la función', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: httpError({
        error: {
          message: 'La contraseña nueva tiene que ser distinta de la actual.',
          hint: 'VALIDATION_ERROR',
        },
      }),
    })

    const error = await rejection(changeOwnPassword('abcdefgh', 'profile'))

    expect(error.hint).toBe('VALIDATION_ERROR')
    expect(error.message).toBe(
      'La contraseña nueva tiene que ser distinta de la actual.',
    )
    expect(updateUserMock).not.toHaveBeenCalled()
  })

  it('CREDENTIALS_NOT_CONFIGURED: avisa que no se puede cambiar por ahora', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: httpError(
        {
          error: {
            message: 'Falta CREDENTIALS_KEY',
            hint: 'CREDENTIALS_NOT_CONFIGURED',
          },
        },
        500,
      ),
    })

    const error = await rejection(changeOwnPassword('abcdefgh', 'profile'))

    expect(error.hint).toBe('CREDENTIALS_NOT_CONFIGURED')
    expect(error.message).toBe(
      'Por el momento no se puede cambiar la contraseña. Avisale a la administración.',
    )
    expect(error.message).not.toContain('CREDENTIALS_KEY')
    expect(updateUserMock).not.toHaveBeenCalled()
  })

  it('error de red sin cuerpo: mensaje genérico y sin fallback a auth.updateUser', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: new Error('Failed to fetch'),
    })

    const error = await rejection(changeOwnPassword('abcdefgh', 'profile'))

    expect(error.message).toBe(
      'Ocurrió un error inesperado. Probá de nuevo en un momento.',
    )
    expect(updateUserMock).not.toHaveBeenCalled()
  })

  it('respuesta 200 con { error }: también lanza ApiError', async () => {
    invokeMock.mockResolvedValue({
      data: { error: { message: 'x', hint: 'FORBIDDEN' } },
      error: null,
    })

    const error = await rejection(changeOwnPassword('abcdefgh', 'profile'))

    expect(error.hint).toBe('FORBIDDEN')
  })
})
