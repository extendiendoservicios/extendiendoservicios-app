import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `src/api/myWorkdays.ts` (P24.2, CJ-12 a CJ-17): mismo patrón sin red que
 * `mySupervisions.test.ts` -- se mockea `@/lib/supabase` entero.
 */

interface PostgrestResult<T> {
  data: T | null
  error: { message: string; code?: string; hint?: string } | null
}

const calls: { method: string; args: unknown[] }[] = []

function makeChainable<T>(result: PostgrestResult<T>) {
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args })
      return chain
    }
  const chain: Record<string, unknown> = {
    select: record('select'),
    eq: record('eq'),
    order: record('order'),
    limit: record('limit'),
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

vi.mock('@/features/employees/employeeLeaveStatus', () => ({
  todayInBuenosAires: () => '2026-10-23',
}))

const {
  fetchTodayWorkday,
  fetchMyWorkdaysHistory,
  startWorkday,
  pauseWorkday,
  resumeWorkday,
  endWorkday,
  reopenWorkday,
} = await import('./myWorkdays')

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
  calls.length = 0
})

const WORKDAY_ROW = {
  id: 'wd1',
  work_date: '2026-10-23',
  state: 'paused',
  started_at: '2026-10-23T11:00:00Z',
  ended_at: null,
  worked_minutes: 125,
  pause_minutes: 30,
  auto_closed: false,
  auto_close_warning: false,
  corrected: false,
  supervisions_count: 1,
  pauses: [
    {
      type: 'pause',
      pause_event_id: 'e2',
      resume_event_id: null,
      starts_at: '2026-10-23T14:00:00Z',
      ends_at: null,
      minutes: 30,
      reason: 'Almuerzo',
      corrected: false,
    },
  ],
  supervisions: [
    {
      supervision_id: 'sv1',
      shift_id: 'sh1',
      client_legal_name: 'Limpiadora SRL',
      site_name: 'Sede Centro',
      status: 'completed',
      check_in_at: '2026-10-23T12:00:00Z',
      check_out_at: '2026-10-23T13:00:00Z',
      duration_minutes: 60,
      unclosed: false,
    },
  ],
  events: [
    {
      id: 'e1',
      kind: 'start',
      recorded_at: '2026-10-23T11:00:00Z',
      reason: null,
      supervision_id: null,
      has_position: false,
      removed: false,
    },
  ],
}

describe('fetchTodayWorkday', () => {
  it('lee v_my_workdays del día de hoy y mapea pausas, supervisiones y eventos', async () => {
    fromMock.mockReturnValue(makeChainable({ data: WORKDAY_ROW, error: null }))

    const workday = await fetchTodayWorkday()

    expect(fromMock).toHaveBeenCalledWith('v_my_workdays')
    expect(calls).toContainEqual({
      method: 'eq',
      args: ['work_date', '2026-10-23'],
    })
    expect(workday).toMatchObject({
      id: 'wd1',
      state: 'paused',
      workedMinutes: 125,
      pauseMinutes: 30,
      autoCloseWarning: false,
    })
    expect(workday?.pauses).toEqual([
      {
        type: 'pause',
        startsAt: '2026-10-23T14:00:00Z',
        endsAt: null,
        minutes: 30,
        reason: 'Almuerzo',
      },
    ])
    expect(workday?.supervisions[0]).toMatchObject({
      supervisionId: 'sv1',
      clientName: 'Limpiadora SRL',
      durationMinutes: 60,
      unclosed: false,
    })
    expect(workday?.events).toHaveLength(1)
  })

  it('devuelve null si todavía no inició la jornada', async () => {
    fromMock.mockReturnValue(makeChainable({ data: null, error: null }))
    expect(await fetchTodayWorkday()).toBeNull()
  })

  it('propaga el error traducido', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: { message: 'x', code: '42501' },
      }),
    )
    await expect(fetchTodayWorkday()).rejects.toMatchObject({
      hint: 'FORBIDDEN',
    })
  })
})

describe('fetchMyWorkdaysHistory', () => {
  it('pide las jornadas más recientes primero', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: [WORKDAY_ROW], error: null }),
    )

    const workdays = await fetchMyWorkdaysHistory()

    expect(calls).toContainEqual({
      method: 'order',
      args: ['work_date', { ascending: false }],
    })
    expect(workdays).toHaveLength(1)
  })
})

describe('RPC de la jornada', () => {
  const STATE = {
    workday_id: 'wd1',
    state: 'running',
    started_at: '2026-10-23T11:00:00Z',
    ended_at: null,
    minutes: 0,
    paused_since: null,
    pause_reason: null,
    auto_closed: false,
    corrected: false,
  }
  const COORDS = { lat: -34.47, lng: -58.5, accuracyM: 12 }

  it('start_workday manda la posición y devuelve el estado con la hora del servidor', async () => {
    rpcMock.mockResolvedValue({ data: STATE, error: null })

    const result = await startWorkday(COORDS)

    expect(rpcMock).toHaveBeenCalledWith('start_workday', {
      p_lat: -34.47,
      p_lng: -58.5,
      p_accuracy: 12,
    })
    expect(result).toMatchObject({
      workdayId: 'wd1',
      state: 'running',
      startedAt: '2026-10-23T11:00:00Z',
    })
  })

  it('registra igual sin coordenadas (CJ-21)', async () => {
    rpcMock.mockResolvedValue({ data: STATE, error: null })

    await startWorkday(null)

    const args = rpcMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(args.p_lat).toBeUndefined()
    expect(args.p_lng).toBeUndefined()
    expect(args.p_accuracy).toBeUndefined()
  })

  it('pause_workday manda el motivo recortado; vacío no se manda (es opcional, CJ-16)', async () => {
    rpcMock.mockResolvedValue({
      data: {
        ...STATE,
        state: 'paused',
        paused_since: 'x',
        pause_reason: 'Almuerzo',
      },
      error: null,
    })

    const result = await pauseWorkday('  Almuerzo ', null)
    expect(rpcMock).toHaveBeenLastCalledWith(
      'pause_workday',
      expect.objectContaining({ p_reason: 'Almuerzo' }),
    )
    expect(result.pauseReason).toBe('Almuerzo')

    await pauseWorkday('   ', null)
    const args = rpcMock.mock.calls[1]?.[1] as Record<string, unknown>
    expect(args.p_reason).toBeUndefined()
  })

  it.each([
    ['resume_workday', resumeWorkday],
    ['end_workday', endWorkday],
    ['reopen_workday', reopenWorkday],
  ])('%s llama a la RPC con la posición', async (name, fn) => {
    rpcMock.mockResolvedValue({ data: STATE, error: null })

    await fn(COORDS)

    expect(rpcMock).toHaveBeenCalledWith(name, {
      p_lat: -34.47,
      p_lng: -58.5,
      p_accuracy: 12,
    })
  })

  it('propaga el hint del error (por ejemplo SUPERVISION_OPEN, CJ-29)', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'Tenés una supervisión abierta.',
        hint: 'SUPERVISION_OPEN',
      },
    })

    await expect(endWorkday(null)).rejects.toMatchObject({
      hint: 'SUPERVISION_OPEN',
    })
  })
})
