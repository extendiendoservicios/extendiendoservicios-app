import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `src/api/mySupervisions.ts` (MOB-SUP-002 a MOB-SUP-005, MOB-SUP-012):
 * mismo patrón sin red que `src/api/myDay.test.ts` -- se mockea
 * `@/lib/supabase` entero, sin depender de una instancia real.
 */

interface PostgrestResult<T> {
  data: T | null
  error: { message: string; code?: string; hint?: string } | null
}

function makeChainable<T>(result: PostgrestResult<T>) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    lte: () => chain,
    in: () => chain,
    or: () => chain,
    order: () => chain,
    maybeSingle: () => Promise.resolve(result),
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

// Fecha fija: evita que `todayInBuenosAires()` (hora real) haga que
// `isToday`/los rangos de fecha cambien entre corridas del test.
vi.mock('@/features/employees/employeeLeaveStatus', () => ({
  todayInBuenosAires: () => '2026-09-27',
}))

const {
  fetchMySupervisionsUpcoming,
  fetchMySupervisionsPending,
  fetchMySupervisionsHistory,
  fetchMySupervisionById,
  fetchVigentRatingCriteria,
  supervisionCheckIn,
  supervisionCheckOut,
  rateEmployee,
  completeSupervision,
  markSupervisionNotDone,
} = await import('./mySupervisions')

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
})

const MY_SUPERVISION_ROW = {
  id: 'sv1',
  shift_id: 'sh1',
  shift_date: '2026-09-27',
  client_id: 'c1',
  client_legal_name: 'Limpiadora SRL',
  site_id: 'si1',
  site_name: 'Sede Centro',
  site_address: 'Av. Siempre Viva 123',
  start_time: '08:00:00',
  end_time: '12:00:00',
  starts_at: '2026-09-27T11:00:00Z',
  ends_at: '2026-09-27T15:00:00Z',
  status: 'assigned' as const,
  assigned_at: '2026-09-20T10:00:00Z',
  not_done_reason: null,
  cancel_reason: null,
  general_notes: null,
  criteria_snapshot: null,
  check_in_at: null,
  check_out_at: null,
  assigned_employees: [
    {
      employee_id: 'e1',
      first_name: 'Ana',
      last_name: 'Gómez',
      status: 'expected',
      check_in_at: null,
    },
  ],
  site_city: 'San Isidro',
  site_latitude: -34.47,
  site_longitude: -58.5,
  site_contact_name: 'Marcela',
  site_contact_phone: '1122334455',
  site_access_instructions: 'Timbre 3B',
  site_building_hours: '08:00 a 20:00',
  site_phone_restricted: false,
  site_photos_not_allowed: false,
  site_restrictions_notes: null,
}

describe('fetchMySupervisionsUpcoming', () => {
  it('arma MySupervision[] a partir de v_my_supervisions, con isToday calculado', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: [MY_SUPERVISION_ROW], error: null }),
    )

    const rows = await fetchMySupervisionsUpcoming()

    expect(fromMock).toHaveBeenCalledWith('v_my_supervisions')
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'sv1',
        clientName: 'Limpiadora SRL',
        siteName: 'Sede Centro',
        isToday: true,
        status: 'assigned',
        assignedEmployees: [
          {
            employeeId: 'e1',
            firstName: 'Ana',
            lastName: 'Gómez',
            status: 'expected',
            checkInAt: null,
          },
        ],
        criteriaSnapshot: null,
      }),
    ])
  })

  it('propaga el error traducido si la consulta falla', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: null, error: { message: 'boom', code: '500' } }),
    )

    await expect(fetchMySupervisionsUpcoming()).rejects.toThrow()
  })
})

describe('fetchMySupervisionsPending', () => {
  it('consulta v_my_supervisions filtrando assigned/in_progress', async () => {
    fromMock.mockReturnValue(makeChainable({ data: [], error: null }))

    await fetchMySupervisionsPending()

    expect(fromMock).toHaveBeenCalledWith('v_my_supervisions')
  })
})

describe('fetchMySupervisionsHistory', () => {
  it('consulta v_my_supervisions filtrando completed/not_done', async () => {
    fromMock.mockReturnValue(makeChainable({ data: [], error: null }))

    await fetchMySupervisionsHistory()

    expect(fromMock).toHaveBeenCalledWith('v_my_supervisions')
  })
})

describe('fetchMySupervisionById', () => {
  it('devuelve null si no encuentra la fila', async () => {
    fromMock.mockReturnValue(makeChainable({ data: null, error: null }))

    const result = await fetchMySupervisionById('sv1')

    expect(result).toBeNull()
  })

  it('mapea la fila con los criterios guardados al iniciar (criteria_snapshot)', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: {
          ...MY_SUPERVISION_ROW,
          status: 'in_progress',
          check_in_at: '2026-09-27T11:05:00Z',
          criteria_snapshot: [
            { id: 'cr1', title: 'Orden', description: null, position: 1 },
          ],
        },
        error: null,
      }),
    )

    const result = await fetchMySupervisionById('sv1')

    expect(result?.criteriaSnapshot).toEqual([
      { id: 'cr1', title: 'Orden', description: null, position: 1 },
    ])
    expect(result?.checkInAt).toBe('2026-09-27T11:05:00Z')
  })
})

describe('fetchVigentRatingCriteria', () => {
  it('trae rating_criteria ordenados por position', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          { id: 'cr2', title: 'Puntualidad', description: null, position: 2 },
          { id: 'cr1', title: 'Orden', description: 'Guía', position: 1 },
        ],
        error: null,
      }),
    )

    const criteria = await fetchVigentRatingCriteria()

    expect(fromMock).toHaveBeenCalledWith('rating_criteria')
    expect(criteria).toEqual([
      { id: 'cr2', title: 'Puntualidad', description: null, position: 2 },
      { id: 'cr1', title: 'Orden', description: 'Guía', position: 1 },
    ])
  })
})

describe('supervisionCheckIn', () => {
  it('llama a la RPC con las coordenadas cuando hay consentimiento', async () => {
    rpcMock.mockResolvedValue({
      data: {
        id: 'sa1',
        supervision_id: 'sv1',
        kind: 'check_in',
        recorded_at: '2026-09-27T11:00:00Z',
      },
      error: null,
    })

    const result = await supervisionCheckIn('sv1', {
      lat: -34.47,
      lng: -58.5,
      accuracyM: 12,
    })

    expect(rpcMock).toHaveBeenCalledWith('supervision_check_in', {
      p_supervision_id: 'sv1',
      p_lat: -34.47,
      p_lng: -58.5,
      p_accuracy: 12,
    })
    expect(result).toEqual({
      id: 'sa1',
      supervisionId: 'sv1',
      kind: 'check_in',
      recordedAt: '2026-09-27T11:00:00Z',
    })
  })

  it('registra igual sin coordenadas (ADR-009: nunca bloquea)', async () => {
    rpcMock.mockResolvedValue({
      data: {
        id: 'sa1',
        supervision_id: 'sv1',
        kind: 'check_in',
        recorded_at: '2026-09-27T11:00:00Z',
      },
      error: null,
    })

    await supervisionCheckIn('sv1', null)

    expect(rpcMock).toHaveBeenCalledWith('supervision_check_in', {
      p_supervision_id: 'sv1',
      p_lat: undefined,
      p_lng: undefined,
      p_accuracy: undefined,
    })
  })

  it('propaga el error traducido de la RPC (por ejemplo NOT_TODAY)', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Este turno no es de hoy.', hint: 'NOT_TODAY' },
    })

    await expect(supervisionCheckIn('sv1', null)).rejects.toThrow(
      'Este turno no es de hoy.',
    )
  })
})

describe('supervisionCheckOut', () => {
  it('llama a la RPC de fin con las coordenadas', async () => {
    rpcMock.mockResolvedValue({
      data: {
        id: 'sa2',
        supervision_id: 'sv1',
        kind: 'check_out',
        recorded_at: '2026-09-27T15:00:00Z',
      },
      error: null,
    })

    const result = await supervisionCheckOut('sv1', null)

    expect(rpcMock).toHaveBeenCalledWith('supervision_check_out', {
      p_supervision_id: 'sv1',
      p_lat: undefined,
      p_lng: undefined,
      p_accuracy: undefined,
    })
    expect(result.kind).toBe('check_out')
  })
})

// Accesos preparados para P15.5 (SUP-05, SUP-06): se prueban acá porque ya
// están implementados en este archivo, aunque sin pantalla propia todavía
// (ver el comentario grande de `mySupervisions.ts`).
describe('rateEmployee', () => {
  it('llama a rate_employee con el puntaje y el comentario', async () => {
    rpcMock.mockResolvedValue({
      data: {
        id: 'r1',
        supervision_id: 'sv1',
        assignment_id: 'as1',
        score: 4,
        comment: 'Bien',
      },
      error: null,
    })

    const result = await rateEmployee('sv1', 'as1', 4, 'Bien')

    expect(rpcMock).toHaveBeenCalledWith('rate_employee', {
      p_supervision_id: 'sv1',
      p_assignment_id: 'as1',
      p_score: 4,
      p_comment: 'Bien',
    })
    expect(result.score).toBe(4)
  })
})

describe('completeSupervision', () => {
  it('llama a complete_supervision con la nota general', async () => {
    rpcMock.mockResolvedValue({
      data: {
        id: 'sv1',
        status: 'completed',
        not_done_reason: null,
        general_notes: 'Todo bien',
      },
      error: null,
    })

    const result = await completeSupervision('sv1', 'Todo bien')

    expect(rpcMock).toHaveBeenCalledWith('complete_supervision', {
      p_supervision_id: 'sv1',
      p_general_notes: 'Todo bien',
    })
    expect(result?.status).toBe('completed')
  })
})

describe('markSupervisionNotDone', () => {
  it('llama a mark_supervision_not_done con el motivo', async () => {
    rpcMock.mockResolvedValue({
      data: {
        id: 'sv1',
        status: 'not_done',
        not_done_reason: 'Sede cerrada',
        general_notes: null,
      },
      error: null,
    })

    const result = await markSupervisionNotDone('sv1', 'Sede cerrada')

    expect(rpcMock).toHaveBeenCalledWith('mark_supervision_not_done', {
      p_supervision_id: 'sv1',
      p_reason: 'Sede cerrada',
    })
    expect(result?.notDoneReason).toBe('Sede cerrada')
  })
})
