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
  takeSupervision,
  discardSupervision,
  rateEmployee,
  completeSupervision,
  isRatingWindowClosed,
  canRateNow,
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
  it('consulta v_my_supervisions filtrando las abiertas (in_progress)', async () => {
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

describe('takeSupervision (CJ-26)', () => {
  const TAKE_RESPONSE = {
    supervision: { id: 'sv9', status: 'in_progress' },
    check_in: {
      id: 'sa1',
      supervision_id: 'sv9',
      kind: 'check_in',
      recorded_at: '2026-09-27T11:00:00Z',
      geo_status: 'valid',
      geo_unvalidated_reason: null,
      site_distance_m: 40,
      geofence_radius_m: 200,
      geo_override_at: null,
    },
    warnings: ['SUPERVISES_OWN_SHIFT'],
  }

  it('llama a take_supervision con el turno y la posición, y devuelve la hora del servidor y la validación', async () => {
    rpcMock.mockResolvedValue({ data: TAKE_RESPONSE, error: null })

    const result = await takeSupervision('sh1', {
      lat: -34.47,
      lng: -58.5,
      accuracyM: 12,
    })

    expect(rpcMock).toHaveBeenCalledWith('take_supervision', {
      p_shift_id: 'sh1',
      p_lat: -34.47,
      p_lng: -58.5,
      p_accuracy: 12,
      p_outside_reason: undefined,
    })
    expect(result.supervisionId).toBe('sv9')
    expect(result.checkIn.recordedAt).toBe('2026-09-27T11:00:00Z')
    expect(result.checkIn.geo?.status).toBe('valid')
    expect(result.warnings).toEqual(['SUPERVISES_OWN_SHIFT'])
  })

  it('manda el motivo recortado cuando está fuera de la zona', async () => {
    rpcMock.mockResolvedValue({ data: TAKE_RESPONSE, error: null })

    await takeSupervision(
      'sh1',
      { lat: -34.47, lng: -58.5, accuracyM: 12 },
      ' Estoy en la puerta ',
    )

    expect(rpcMock).toHaveBeenCalledWith(
      'take_supervision',
      expect.objectContaining({ p_outside_reason: 'Estoy en la puerta' }),
    )
  })

  it('registra igual sin coordenadas (ADR-009, CJ-21: nunca bloquea)', async () => {
    rpcMock.mockResolvedValue({ data: TAKE_RESPONSE, error: null })

    await takeSupervision('sh1', null)

    const args = rpcMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(args.p_lat).toBeUndefined()
    expect(args.p_lng).toBeUndefined()
    expect(args.p_accuracy).toBeUndefined()
  })

  it('propaga el error traducido (por ejemplo WORKDAY_PAUSED)', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'Estás en pausa: reanudá tu jornada para supervisar.',
        hint: 'WORKDAY_PAUSED',
      },
    })

    await expect(takeSupervision('sh1', null)).rejects.toMatchObject({
      hint: 'WORKDAY_PAUSED',
    })
  })
})

describe('discardSupervision (CJ-27)', () => {
  it('llama a discard_supervision y devuelve la supervisión cancelada', async () => {
    rpcMock.mockResolvedValue({
      data: {
        id: 'sv1',
        status: 'cancelled',
        not_done_reason: null,
        general_notes: null,
      },
      error: null,
    })

    const result = await discardSupervision('sv1')

    expect(rpcMock).toHaveBeenCalledWith('discard_supervision', {
      p_supervision_id: 'sv1',
    })
    expect(result.status).toBe('cancelled')
  })

  it('propaga SUPERVISION_HAS_RATINGS si ya calificó a alguien', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Ya calificaste.', hint: 'SUPERVISION_HAS_RATINGS' },
    })

    await expect(discardSupervision('sv1')).rejects.toMatchObject({
      hint: 'SUPERVISION_HAS_RATINGS',
    })
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

describe('completeSupervision (CJ-10)', () => {
  const COMPLETED = {
    id: 'sv1',
    status: 'completed',
    not_done_reason: null,
    general_notes: 'Todo bien',
  }

  it('llama a complete_supervision con la nota general y la posición del fin', async () => {
    rpcMock.mockResolvedValue({ data: COMPLETED, error: null })

    const result = await completeSupervision('sv1', ' Todo bien ', {
      lat: -34.47,
      lng: -58.5,
      accuracyM: 12,
    })

    expect(rpcMock).toHaveBeenCalledWith('complete_supervision', {
      p_supervision_id: 'sv1',
      p_general_notes: 'Todo bien',
      p_lat: -34.47,
      p_lng: -58.5,
      p_accuracy: 12,
      p_outside_reason: undefined,
    })
    expect(result?.status).toBe('completed')
  })

  it('cierra igual sin coordenadas', async () => {
    rpcMock.mockResolvedValue({ data: COMPLETED, error: null })

    await completeSupervision('sv1', undefined, null)

    const args = rpcMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(args.p_lat).toBeUndefined()
    expect(args.p_general_notes).toBeUndefined()
  })

  it('propaga RATINGS_PENDING con el mensaje del servidor (trae los nombres)', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'Falta calificar a: Ana Pérez.',
        hint: 'RATINGS_PENDING',
      },
    })

    await expect(completeSupervision('sv1', undefined, null)).rejects.toThrow(
      'Falta calificar a: Ana Pérez.',
    )
  })
})

describe('ventana de edición de la calificación (P-083, ajustada en P24.1)', () => {
  const base = {
    status: 'in_progress',
    endsAt: '2026-09-27T12:00:00Z',
    checkOutAt: null,
  } as unknown as Parameters<typeof isRatingWindowClosed>[0]

  it('no corre mientras la supervisión sigue abierta, aunque el turno ya haya terminado (CJ-06)', () => {
    const now = new Date('2026-09-27T20:00:00Z')
    expect(isRatingWindowClosed(base, now)).toBe(false)
    expect(canRateNow(base, now)).toBe(true)
  })

  it('corre desde que se registra el fin: cierra pasado el mayor entre el fin del turno y el fin registrado', () => {
    const closed = { ...base, checkOutAt: '2026-09-27T13:00:00Z' }
    expect(isRatingWindowClosed(closed, new Date('2026-09-27T12:59:00Z'))).toBe(
      false,
    )
    expect(isRatingWindowClosed(closed, new Date('2026-09-27T13:01:00Z'))).toBe(
      true,
    )
  })
})
