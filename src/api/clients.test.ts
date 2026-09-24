import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiError } from './errors'

/**
 * `src/api/clients.ts` (CLIENT-001): mismo patrón sin red que
 * `users.test.ts`/`settings.test.ts` -- se mockea `@/lib/supabase` entero.
 * `makeChainable` arma un mock "thenable" (tiene `.then`, así `await query`
 * funciona igual que el builder real de `supabase-js`) que además expone
 * `.single()` como una promesa aparte, para las escrituras que encadenan
 * `.select('*').eq(...).single()`.
 */

interface PostgrestResult<T> {
  data: T | null
  error: { message: string; code?: string; hint?: string } | null
}

function makeChainable<T>(result: PostgrestResult<T>) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    is: () => chain,
    eq: () => chain,
    neq: () => chain,
    order: () => chain,
    or: () => chain,
    single: () => Promise.resolve(result),
    then: (
      resolve: (value: PostgrestResult<T>) => void,
      reject?: (reason: unknown) => void,
    ) => Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabase: { from: fromMock },
}))

const {
  createClient,
  updateClient,
  setClientStatus,
  fetchClientDetail,
  fetchClients,
  createClientContact,
  setPrimaryClientContact,
  deactivateClientContact,
} = await import('./clients')

beforeEach(() => {
  fromMock.mockReset()
})

const CLIENT_ROW = {
  id: 'c1',
  legal_name: 'Limpiadora SRL',
  trade_name: 'Limpia Ya',
  cuit: '20123456786',
  admin_address: 'Av. Siempre Viva 123',
  latitude: -34.6,
  longitude: -58.4,
  status: 'active' as const,
  notes: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: null,
}

describe('fetchClientDetail', () => {
  it('mapea la fila de clients a camelCase', async () => {
    fromMock.mockReturnValue(makeChainable({ data: CLIENT_ROW, error: null }))
    const result = await fetchClientDetail('c1')
    expect(result).toEqual({
      id: 'c1',
      legalName: 'Limpiadora SRL',
      tradeName: 'Limpia Ya',
      cuit: '20123456786',
      adminAddress: 'Av. Siempre Viva 123',
      latitude: -34.6,
      longitude: -58.4,
      status: 'active',
      notes: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: null,
    })
  })
})

describe('createClient', () => {
  it('inserta y devuelve el cliente creado', async () => {
    fromMock.mockReturnValue(makeChainable({ data: CLIENT_ROW, error: null }))
    const result = await createClient(
      {
        legalName: 'Limpiadora SRL',
        tradeName: 'Limpia Ya',
        cuit: '20123456786',
        adminAddress: 'Av. Siempre Viva 123',
        latitude: -34.6,
        longitude: -58.4,
        status: 'active',
        notes: null,
      },
      'owner-1',
    )
    expect(result.id).toBe('c1')
  })

  it('CUIT repetido -> ApiError con hint CUIT_IN_USE y mensaje en español', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: {
          message:
            'duplicate key value violates unique constraint "clients_cuit_key"',
          code: '23505',
        },
      }),
    )
    await expect(
      createClient(
        {
          legalName: 'Limpiadora SRL',
          tradeName: null,
          cuit: '20123456786',
          adminAddress: null,
          latitude: null,
          longitude: null,
          status: 'active',
          notes: null,
        },
        'owner-1',
      ),
    ).rejects.toMatchObject({
      message: 'Ese CUIT ya está registrado.',
      hint: 'CUIT_IN_USE',
    })
  })

  it('otra violación de unicidad -> ApiError genérico DUPLICATE', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: {
          message: 'duplicate key value violates unique constraint "otra"',
          code: '23505',
        },
      }),
    )
    try {
      await createClient(
        {
          legalName: 'Limpiadora SRL',
          tradeName: null,
          cuit: null,
          adminAddress: null,
          latitude: null,
          longitude: null,
          status: 'active',
          notes: null,
        },
        'owner-1',
      )
      expect.unreachable()
    } catch (error) {
      expect(isApiError(error)).toBe(true)
      if (isApiError(error)) {
        expect(error.hint).toBe('DUPLICATE')
      }
    }
  })
})

describe('updateClient', () => {
  it('actualiza y devuelve el cliente', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: { ...CLIENT_ROW, status: 'suspended' as const },
        error: null,
      }),
    )
    const result = await updateClient(
      'c1',
      {
        legalName: 'Limpiadora SRL',
        tradeName: null,
        cuit: null,
        adminAddress: null,
        latitude: null,
        longitude: null,
        status: 'suspended',
        notes: null,
      },
      'owner-1',
    )
    expect(result.status).toBe('suspended')
  })
})

describe('setClientStatus', () => {
  it('solo cambia el estado', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: { ...CLIENT_ROW, status: 'closed' as const },
        error: null,
      }),
    )
    const result = await setClientStatus('c1', 'closed', 'owner-1')
    expect(result.status).toBe('closed')
  })
})

describe('fetchClients', () => {
  it('mapea v_clients a ClientListRow[]', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          {
            id: 'c1',
            legal_name: 'Limpiadora SRL',
            trade_name: 'Limpia Ya',
            cuit: '20123456786',
            status: 'active' as const,
            sites_count: 3,
            active_services_count: 2,
          },
        ],
        error: null,
      }),
    )
    const result = await fetchClients()
    expect(result).toEqual([
      {
        id: 'c1',
        legalName: 'Limpiadora SRL',
        tradeName: 'Limpia Ya',
        cuit: '20123456786',
        status: 'active',
        sitesCount: 3,
        activeServicesCount: 2,
      },
    ])
  })
})

describe('createClientContact', () => {
  it('inserta un contacto', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: {
          id: 'ct1',
          client_id: 'c1',
          name: 'Ana',
          role_title: null,
          phone: null,
          email: null,
          is_primary: false,
        },
        error: null,
      }),
    )
    const result = await createClientContact(
      'c1',
      {
        name: 'Ana',
        roleTitle: null,
        phone: null,
        email: null,
        isPrimary: false,
      },
      'owner-1',
    )
    expect(result).toEqual({
      id: 'ct1',
      clientId: 'c1',
      name: 'Ana',
      roleTitle: null,
      phone: null,
      email: null,
      isPrimary: false,
    })
  })
})

describe('setPrimaryClientContact', () => {
  it('primero le saca el principal al anterior y después se lo pone al nuevo', async () => {
    const okResult = { data: [], error: null }
    fromMock
      .mockReturnValueOnce(makeChainable(okResult))
      .mockReturnValueOnce(makeChainable(okResult))
    await setPrimaryClientContact('c1', 'ct2', 'owner-1')
    expect(fromMock).toHaveBeenCalledTimes(2)
    expect(fromMock).toHaveBeenNthCalledWith(1, 'client_contacts')
    expect(fromMock).toHaveBeenNthCalledWith(2, 'client_contacts')
  })
})

describe('deactivateClientContact', () => {
  it('marca deleted_at sin lanzar si no hay error', async () => {
    fromMock.mockReturnValue(makeChainable({ data: [], error: null }))
    await expect(
      deactivateClientContact('ct1', 'owner-1'),
    ).resolves.toBeUndefined()
  })
})
