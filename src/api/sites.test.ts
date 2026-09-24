import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiError } from './errors'

/**
 * `src/api/sites.ts` (SITE-001): mismo patrón sin red que
 * `clients.test.ts` -- se mockea `@/lib/supabase` entero. `makeChainable`
 * arma un mock "thenable" (tiene `.then`, así `await query` funciona igual
 * que el builder real de `supabase-js`) que además expone `.single()` como
 * una promesa aparte, para las escrituras que encadenan `.select(...).
 * eq(...).single()`.
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
    order: () => chain,
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
  createSite,
  updateSite,
  setSiteStatus,
  fetchSiteDetail,
  fetchSitesForMap,
  fetchClientFilterOptions,
} = await import('./sites')

beforeEach(() => {
  fromMock.mockReset()
})

const SITE_ROW = {
  id: 's1',
  client_id: 'c1',
  name: 'Sede Centro',
  address: 'Av. Siempre Viva 123',
  city: 'CABA',
  latitude: -34.6,
  longitude: -58.4,
  contact_name: 'Ana',
  contact_phone: '1122334455',
  access_instructions: 'Tocar timbre 3B',
  building_hours: 'Lun a vie 7 a 20',
  phone_restricted: false,
  photos_not_allowed: true,
  restrictions_notes: null,
  status: 'active' as const,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: null,
  clients: {
    legal_name: 'Limpiadora SRL',
    trade_name: 'Limpia Ya',
    status: 'active' as const,
  },
}

describe('fetchSiteDetail', () => {
  it('mapea la fila de sites (con el cliente embebido) a camelCase', async () => {
    fromMock.mockReturnValue(makeChainable({ data: SITE_ROW, error: null }))
    const result = await fetchSiteDetail('s1')
    expect(result).toEqual({
      id: 's1',
      clientId: 'c1',
      clientName: 'Limpia Ya',
      clientStatus: 'active',
      name: 'Sede Centro',
      address: 'Av. Siempre Viva 123',
      city: 'CABA',
      latitude: -34.6,
      longitude: -58.4,
      contactName: 'Ana',
      contactPhone: '1122334455',
      accessInstructions: 'Tocar timbre 3B',
      buildingHours: 'Lun a vie 7 a 20',
      phoneRestricted: false,
      photosNotAllowed: true,
      restrictionsNotes: null,
      status: 'active',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: null,
    })
  })

  it('sin nombre de fantasía, usa la razón social', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: {
          ...SITE_ROW,
          clients: { ...SITE_ROW.clients, trade_name: null },
        },
        error: null,
      }),
    )
    const result = await fetchSiteDetail('s1')
    expect(result.clientName).toBe('Limpiadora SRL')
  })
})

describe('createSite', () => {
  it('inserta y devuelve la sede creada', async () => {
    fromMock.mockReturnValue(makeChainable({ data: SITE_ROW, error: null }))
    const result = await createSite(
      'c1',
      {
        name: 'Sede Centro',
        address: 'Av. Siempre Viva 123',
        city: 'CABA',
        latitude: -34.6,
        longitude: -58.4,
        contactName: 'Ana',
        contactPhone: '1122334455',
        accessInstructions: 'Tocar timbre 3B',
        buildingHours: 'Lun a vie 7 a 20',
        phoneRestricted: false,
        photosNotAllowed: true,
        restrictionsNotes: null,
        status: 'active',
      },
      'owner-1',
    )
    expect(result.id).toBe('s1')
  })

  it('nombre repetido en el cliente -> ApiError con hint SITE_NAME_IN_USE', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: {
          message:
            'duplicate key value violates unique constraint "sites_client_id_name_key"',
          code: '23505',
        },
      }),
    )
    await expect(
      createSite(
        'c1',
        {
          name: 'Sede Centro',
          address: 'Av. Siempre Viva 123',
          city: null,
          latitude: null,
          longitude: null,
          contactName: null,
          contactPhone: null,
          accessInstructions: null,
          buildingHours: null,
          phoneRestricted: false,
          photosNotAllowed: false,
          restrictionsNotes: null,
          status: 'active',
        },
        'owner-1',
      ),
    ).rejects.toMatchObject({
      message: 'Ya hay una sede con ese nombre para este cliente.',
      hint: 'SITE_NAME_IN_USE',
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
      await createSite(
        'c1',
        {
          name: 'Sede Centro',
          address: 'Av. Siempre Viva 123',
          city: null,
          latitude: null,
          longitude: null,
          contactName: null,
          contactPhone: null,
          accessInstructions: null,
          buildingHours: null,
          phoneRestricted: false,
          photosNotAllowed: false,
          restrictionsNotes: null,
          status: 'active',
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

describe('updateSite', () => {
  it('actualiza y devuelve la sede', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: { ...SITE_ROW, status: 'inactive' as const },
        error: null,
      }),
    )
    const result = await updateSite(
      's1',
      {
        name: 'Sede Centro',
        address: 'Av. Siempre Viva 123',
        city: null,
        latitude: null,
        longitude: null,
        contactName: null,
        contactPhone: null,
        accessInstructions: null,
        buildingHours: null,
        phoneRestricted: false,
        photosNotAllowed: false,
        restrictionsNotes: null,
        status: 'inactive',
      },
      'owner-1',
    )
    expect(result.status).toBe('inactive')
  })
})

describe('setSiteStatus', () => {
  it('solo cambia el estado', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: { ...SITE_ROW, status: 'inactive' as const },
        error: null,
      }),
    )
    const result = await setSiteStatus('s1', 'inactive', 'owner-1')
    expect(result.status).toBe('inactive')
  })
})

describe('fetchSitesForMap', () => {
  it('mapea las sedes con su cliente, incluidas las que no tienen coordenadas', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          {
            id: 's1',
            name: 'Sede Centro',
            address: 'Av. Siempre Viva 123',
            city: 'CABA',
            latitude: -34.6,
            longitude: -58.4,
            status: 'active' as const,
            client_id: 'c1',
            clients: { legal_name: 'Limpiadora SRL', trade_name: 'Limpia Ya' },
          },
          {
            id: 's2',
            name: 'Sede Sin Ubicación',
            address: 'Otra calle 456',
            city: null,
            latitude: null,
            longitude: null,
            status: 'active' as const,
            client_id: 'c1',
            clients: { legal_name: 'Limpiadora SRL', trade_name: null },
          },
        ],
        error: null,
      }),
    )
    const result = await fetchSitesForMap()
    expect(result).toEqual([
      {
        id: 's1',
        name: 'Sede Centro',
        address: 'Av. Siempre Viva 123',
        city: 'CABA',
        latitude: -34.6,
        longitude: -58.4,
        status: 'active',
        clientId: 'c1',
        clientName: 'Limpia Ya',
      },
      {
        id: 's2',
        name: 'Sede Sin Ubicación',
        address: 'Otra calle 456',
        city: null,
        latitude: null,
        longitude: null,
        status: 'active',
        clientId: 'c1',
        clientName: 'Limpiadora SRL',
      },
    ])
  })
})

describe('fetchClientFilterOptions', () => {
  it('usa el nombre de fantasía cuando existe, si no la razón social', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          { id: 'c1', legal_name: 'Limpiadora SRL', trade_name: 'Limpia Ya' },
          { id: 'c2', legal_name: 'Otro Cliente SA', trade_name: null },
        ],
        error: null,
      }),
    )
    const result = await fetchClientFilterOptions()
    expect(result).toEqual([
      { id: 'c1', name: 'Limpia Ya' },
      { id: 'c2', name: 'Otro Cliente SA' },
    ])
  })
})
