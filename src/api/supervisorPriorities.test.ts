import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiError } from './errors'

/**
 * `src/api/supervisorPriorities.ts` (P24.3): mismo patrón sin red que
 * `supervisions.test.ts`.
 */

interface PostgrestResult<T> {
  data: T | null
  error: { message: string; code?: string; hint?: string } | null
}

function makeChainable<T>(result: PostgrestResult<T>) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    is: () => chain,
    order: () => chain,
    then: (
      resolve: (value: PostgrestResult<T>) => void,
      reject?: (reason: unknown) => void,
    ) => Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

const { fromMock, rpcMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { from: fromMock, rpc: rpcMock },
}))

const {
  fetchSiteOptions,
  fetchSupervisorPriorities,
  removeSupervisorPriority,
  setSupervisorPriority,
} = await import('./supervisorPriorities')

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
})

describe('fetchSupervisorPriorities', () => {
  it('arma las de cliente entero y las de sede, con el nombre del cliente', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          {
            id: 'p1',
            supervisor_id: 'sup1',
            client_id: 'c1',
            site_id: null,
            created_at: '2026-10-23T10:00:00Z',
            employees: { profiles: { first_name: 'Ana', last_name: 'Pérez' } },
            client: { legal_name: 'Limpiadora SRL', trade_name: 'Limpiadora' },
            site: null,
          },
          {
            id: 'p2',
            supervisor_id: 'sup1',
            client_id: null,
            site_id: 's1',
            created_at: '2026-10-23T11:00:00Z',
            employees: { profiles: { first_name: 'Ana', last_name: 'Pérez' } },
            client: null,
            site: {
              name: 'Sede Centro',
              client_id: 'c2',
              clients: { legal_name: 'Otro SA', trade_name: null },
            },
          },
        ],
        error: null,
      }),
    )

    const result = await fetchSupervisorPriorities()

    expect(fromMock).toHaveBeenCalledWith('supervisor_priorities')
    expect(result).toEqual([
      expect.objectContaining({
        id: 'p1',
        kind: 'client',
        clientId: 'c1',
        clientName: 'Limpiadora',
        supervisorName: 'Ana Pérez',
        siteId: null,
      }),
      expect.objectContaining({
        id: 'p2',
        kind: 'site',
        clientId: 'c2',
        clientName: 'Otro SA',
        siteId: 's1',
        siteName: 'Sede Centro',
      }),
    ])
  })
})

describe('fetchSiteOptions', () => {
  it('ordena por cliente y sede', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          {
            id: 's2',
            name: 'Zona Norte',
            client_id: 'c1',
            clients: { legal_name: 'Beta SA', trade_name: null },
          },
          {
            id: 's1',
            name: 'Centro',
            client_id: 'c2',
            clients: { legal_name: 'Alfa SRL', trade_name: null },
          },
        ],
        error: null,
      }),
    )

    const result = await fetchSiteOptions()

    expect(result.map((site) => `${site.clientName} / ${site.name}`)).toEqual([
      'Alfa SRL / Centro',
      'Beta SA / Zona Norte',
    ])
  })
})

describe('setSupervisorPriority', () => {
  it('manda el cliente o la sede, no los dos', async () => {
    rpcMock.mockResolvedValue({ data: { id: 'p1' }, error: null })

    await setSupervisorPriority({ supervisorId: 'sup1', clientId: 'c1' })
    expect(rpcMock).toHaveBeenLastCalledWith('set_supervisor_priority', {
      p_supervisor_id: 'sup1',
      p_client_id: 'c1',
      p_site_id: undefined,
    })

    await setSupervisorPriority({ supervisorId: 'sup1', siteId: 's1' })
    expect(rpcMock).toHaveBeenLastCalledWith('set_supervisor_priority', {
      p_supervisor_id: 'sup1',
      p_client_id: undefined,
      p_site_id: 's1',
    })
  })

  it('deja pasar PRIORITY_ALREADY_EXISTS con el mensaje del servidor', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'Ese coordinador ya tiene esa prioridad.',
        hint: 'PRIORITY_ALREADY_EXISTS',
      },
    })

    await expect(
      setSupervisorPriority({ supervisorId: 'sup1', clientId: 'c1' }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isApiError(error) &&
        error.hint === 'PRIORITY_ALREADY_EXISTS' &&
        error.message === 'Ese coordinador ya tiene esa prioridad.',
    )
  })
})

describe('removeSupervisorPriority', () => {
  it('llama remove_supervisor_priority', async () => {
    rpcMock.mockResolvedValue({ data: { id: 'p1' }, error: null })

    await removeSupervisorPriority('p1')

    expect(rpcMock).toHaveBeenCalledWith('remove_supervisor_priority', {
      p_priority_id: 'p1',
    })
  })
})
