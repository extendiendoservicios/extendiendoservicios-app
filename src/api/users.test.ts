import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { isApiError } from './errors'

/**
 * `src/api/users.ts` (USERS-007): capa de datos de ADM-27, sin red -- se
 * mockea `@/lib/supabase` entero (PostgREST, `rpc` y `functions.invoke`).
 * Cada chain de PostgREST se mockea con el mismo estilo que
 * `ProfilePage.test.tsx`: funciones anidadas que terminan en un
 * `Promise.resolve`, sin un builder genérico reutilizable (así queda claro
 * a simple vista, por cada test, exactamente qué chain espera `users.ts`).
 */

interface PostgrestResult<T> {
  data: T | null
  error: { message: string; hint?: string } | null
}

const { fromMock, rpcMock, invokeMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  invokeMock: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
    functions: { invoke: invokeMock },
  },
}))

// Import diferido: tiene que pasar DESPUÉS de `vi.mock` (hoisting de
// vitest ya lo garantiza, pero el `await import` deja explícito el orden).
const {
  fetchUsers,
  fetchLastSignIns,
  fetchAdminCapabilities,
  setUserRoles,
  setAdminCapability,
  createAdminUser,
  deactivateUser,
  resetPassword,
} = await import('./users')

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
  invokeMock.mockReset()
})

describe('fetchUsers', () => {
  it('arma AdminUserRow[] a partir de profiles + user_roles embebido', async () => {
    const result: PostgrestResult<
      {
        id: string
        first_name: string
        last_name: string
        is_active: boolean
        deleted_at: string | null
        user_roles: { role: string }[]
      }[]
    > = {
      data: [
        {
          id: 'p1',
          first_name: 'Ana',
          last_name: 'Gómez',
          is_active: true,
          deleted_at: null,
          user_roles: [{ role: 'admin' }],
        },
        {
          id: 'p2',
          first_name: 'Beto',
          last_name: 'Ruiz',
          is_active: false,
          deleted_at: '2026-09-01T00:00:00Z',
          user_roles: [],
        },
      ],
      error: null,
    }
    fromMock.mockReturnValue({
      select: () => ({
        order: () => ({
          order: () => Promise.resolve(result),
        }),
      }),
    })

    const users = await fetchUsers()

    expect(fromMock).toHaveBeenCalledWith('profiles')
    expect(users).toEqual([
      {
        profileId: 'p1',
        firstName: 'Ana',
        lastName: 'Gómez',
        isActive: true,
        deletedAt: null,
        roles: ['admin'],
      },
      {
        profileId: 'p2',
        firstName: 'Beto',
        lastName: 'Ruiz',
        isActive: false,
        deletedAt: '2026-09-01T00:00:00Z',
        roles: [],
      },
    ])
  })

  it('traduce un error de PostgREST a ApiError con su hint', async () => {
    fromMock.mockReturnValue({
      select: () => ({
        order: () => ({
          order: () =>
            Promise.resolve({
              data: null,
              error: {
                message: 'No tenés permiso para hacer esto.',
                hint: 'FORBIDDEN',
              },
            }),
        }),
      }),
    })

    await expect(fetchUsers()).rejects.toMatchObject({
      message: 'No tenés permiso para hacer esto.',
      hint: 'FORBIDDEN',
    })
  })
})

describe('fetchLastSignIns', () => {
  it('se queda con el evento más reciente de cada actor_id', async () => {
    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () =>
              Promise.resolve({
                data: [
                  { actor_id: 'p1', created_at: '2026-09-20T10:00:00Z' },
                  { actor_id: 'p1', created_at: '2026-09-10T10:00:00Z' },
                  { actor_id: 'p2', created_at: '2026-09-15T10:00:00Z' },
                  { actor_id: null, created_at: '2026-09-01T10:00:00Z' },
                ],
                error: null,
              }),
          }),
        }),
      }),
    })

    const lastSignIns = await fetchLastSignIns()

    expect(lastSignIns.get('p1')).toBe('2026-09-20T10:00:00Z')
    expect(lastSignIns.get('p2')).toBe('2026-09-15T10:00:00Z')
    expect(lastSignIns.size).toBe(2)
  })

  it('devuelve un mapa vacío sin lanzar cuando RLS no deja ver nada (no-owner)', async () => {
    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    })

    await expect(fetchLastSignIns()).resolves.toEqual(new Map())
  })
})

describe('fetchAdminCapabilities', () => {
  it('completa en false las capacidades sin fila', async () => {
    fromMock.mockReturnValue({
      select: () => ({
        eq: () =>
          Promise.resolve({
            data: [{ capability: 'manage_users', enabled: true }],
            error: null,
          }),
      }),
    })

    const capabilities = await fetchAdminCapabilities('p1')

    expect(capabilities.manage_users).toBe(true)
    expect(capabilities.cancel_shifts).toBe(false)
    expect(Object.keys(capabilities)).toHaveLength(7)
  })
})

describe('setUserRoles', () => {
  it('llama a la RPC con p_profile_id/p_roles y devuelve el resultado', async () => {
    rpcMock.mockResolvedValue({ data: ['admin'], error: null })

    const roles = await setUserRoles('p1', ['admin'])

    expect(rpcMock).toHaveBeenCalledWith('set_user_roles', {
      p_profile_id: 'p1',
      p_roles: ['admin'],
    })
    expect(roles).toEqual(['admin'])
  })

  it('traduce LAST_OWNER a ApiError', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'No se puede quitar al último dueño.',
        hint: 'LAST_OWNER',
      },
    })

    await expect(setUserRoles('p1', ['admin'])).rejects.toMatchObject({
      hint: 'LAST_OWNER',
    })
  })
})

describe('setAdminCapability', () => {
  it('llama a la RPC con los tres parámetros', async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null })

    await setAdminCapability('p1', 'cancel_shifts', false)

    expect(rpcMock).toHaveBeenCalledWith('set_admin_capability', {
      p_profile_id: 'p1',
      p_capability: 'cancel_shifts',
      p_enabled: false,
    })
  })
})

describe('createAdminUser (Edge Function admin-users)', () => {
  it('manda action: create_user y devuelve profileId', async () => {
    invokeMock.mockResolvedValue({
      data: { data: { profile_id: 'p9' } },
      error: null,
    })

    const result = await createAdminUser({
      email: 'nueva.admin@extendiendoservicios.example',
      password: 'contraseña-larga',
      firstName: 'Nueva',
      lastName: 'Admin',
      roles: ['admin'],
    })

    expect(invokeMock).toHaveBeenCalledWith('admin-users', {
      body: {
        action: 'create_user',
        email: 'nueva.admin@extendiendoservicios.example',
        password: 'contraseña-larga',
        first_name: 'Nueva',
        last_name: 'Admin',
        roles: ['admin'],
      },
    })
    expect(result).toEqual({ profileId: 'p9' })
  })

  it('traduce un FunctionsHttpError con EMAIL_IN_USE a ApiError', async () => {
    const response = new Response(
      JSON.stringify({
        error: { message: 'Ese email ya está en uso.', hint: 'EMAIL_IN_USE' },
      }),
      { status: 409 },
    )
    invokeMock.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(response),
    })

    const promise = createAdminUser({
      email: 'repetido@extendiendoservicios.example',
      password: 'contraseña-larga',
      firstName: 'Nueva',
      lastName: 'Admin',
      roles: ['admin'],
    })

    await expect(promise).rejects.toSatisfy((error: unknown) => {
      return (
        isApiError(error) &&
        error.message === 'Ese email ya está en uso.' &&
        error.hint === 'EMAIL_IN_USE'
      )
    })
  })

  it('cae en un mensaje genérico si el error no es un FunctionsHttpError', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: new Error('la red se cortó'),
    })

    await expect(
      createAdminUser({
        email: 'x@extendiendoservicios.example',
        password: 'contraseña-larga',
        firstName: 'X',
        lastName: 'Y',
        roles: ['admin'],
      }),
    ).rejects.toMatchObject({
      message: 'Ocurrió un error inesperado. Probá de nuevo en un momento.',
      hint: null,
    })
  })
})

describe('deactivateUser', () => {
  it('manda profile_id y reason', async () => {
    invokeMock.mockResolvedValue({
      data: { data: { profile_id: 'p1' } },
      error: null,
    })

    await deactivateUser('p1', 'Renunció')

    expect(invokeMock).toHaveBeenCalledWith('admin-users', {
      body: { action: 'deactivate_user', profile_id: 'p1', reason: 'Renunció' },
    })
  })
})

describe('resetPassword', () => {
  it('manda profile_id y new_password', async () => {
    invokeMock.mockResolvedValue({
      data: { data: { profile_id: 'p1' } },
      error: null,
    })

    await resetPassword('p1', 'contraseña-nueva')

    expect(invokeMock).toHaveBeenCalledWith('admin-users', {
      body: {
        action: 'reset_password',
        profile_id: 'p1',
        new_password: 'contraseña-nueva',
      },
    })
  })
})
