import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, isApiError } from './errors'

/**
 * `src/api/workdaysAdmin.ts` (P24.3): mismo patrón sin red que
 * `supervisions.test.ts` -- se mockea `@/lib/supabase` entero.
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
    gte: record('gte'),
    lte: record('lte'),
    order: record('order'),
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
  addWorkdayPause,
  correctWorkdayEvent,
  fetchSupervisorWorkdays,
  fetchWorkdaysByDate,
  recordWorkday,
} = await import('./workdaysAdmin')

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
  calls.length = 0
})

const WORKDAY_ROW = {
  id: 'wd1',
  supervisor_id: 'sup1',
  supervisor_first_name: 'Ana',
  supervisor_last_name: 'Pérez',
  work_date: '2026-10-22',
  started_at: '2026-10-22T11:00:00+00:00',
  ended_at: '2026-10-22T21:55:00+00:00',
  state: 'ended',
  worked_minutes: 560,
  pause_minutes: 30,
  auto_closed: true,
  auto_close_warning: true,
  corrected: false,
  pauses: [
    {
      type: 'pause',
      pause_event_id: 'e2',
      resume_event_id: 'e3',
      starts_at: '2026-10-22T15:00:00+00:00',
      ends_at: '2026-10-22T15:30:00+00:00',
      minutes: 30,
      reason: 'Almuerzo',
      corrected: false,
    },
  ],
  supervisions: [
    {
      supervision_id: 'sv1',
      shift_id: 'sh1',
      client_id: 'c1',
      client_legal_name: 'Limpiadora SRL',
      site_id: 'si1',
      site_name: 'Sede Centro',
      status: 'in_progress',
      check_in_at: '2026-10-22T12:00:00+00:00',
      check_out_at: '2026-10-22T21:55:00+00:00',
      duration_minutes: 595,
      unclosed: true,
    },
  ],
  supervisions_count: 1,
  events: [
    {
      id: 'e1',
      kind: 'start',
      recorded_at: '2026-10-22T11:00:00+00:00',
      reason: null,
      supervision_id: null,
      has_position: false,
      corrected: false,
      corrected_from: null,
      correction_reason: null,
      removed: false,
    },
  ],
}

describe('fetchSupervisorWorkdays', () => {
  it('lee v_supervisor_workdays_admin del coordinador, con el período, de la más reciente a la más antigua', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: [WORKDAY_ROW], error: null }),
    )

    const rows = await fetchSupervisorWorkdays({
      supervisorId: 'sup1',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
    })

    expect(fromMock).toHaveBeenCalledWith('v_supervisor_workdays_admin')
    expect(calls).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['supervisor_id', 'sup1'] },
        { method: 'gte', args: ['work_date', '2026-10-01'] },
        { method: 'lte', args: ['work_date', '2026-10-31'] },
        { method: 'order', args: ['work_date', { ascending: false }] },
      ]),
    )
    expect(rows).toHaveLength(1)
  })

  it('arma pausas, supervisiones y eventos, con la advertencia de cierre automático y «Sin cerrar»', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: [WORKDAY_ROW], error: null }),
    )

    const [workday] = await fetchSupervisorWorkdays({ supervisorId: 'sup1' })

    expect(workday).toEqual(
      expect.objectContaining({
        id: 'wd1',
        supervisorName: 'Ana Pérez',
        workDate: '2026-10-22',
        state: 'ended',
        workedMinutes: 560,
        pauseMinutes: 30,
        autoClosed: true,
        autoCloseWarning: true,
        corrected: false,
        supervisionsCount: 1,
      }),
    )
    expect(workday?.pauses[0]).toEqual(
      expect.objectContaining({
        pauseEventId: 'e2',
        resumeEventId: 'e3',
        minutes: 30,
        reason: 'Almuerzo',
      }),
    )
    expect(workday?.supervisions[0]).toEqual(
      expect.objectContaining({
        supervisionId: 'sv1',
        clientName: 'Limpiadora SRL',
        durationMinutes: 595,
        unclosed: true,
      }),
    )
    expect(workday?.events[0]).toEqual(
      expect.objectContaining({ id: 'e1', kind: 'start', hasPosition: false }),
    )
  })

  it('traduce el error del servidor a ApiError', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: { message: 'No tenés permiso.', hint: 'FORBIDDEN' },
      }),
    )
    await expect(
      fetchSupervisorWorkdays({ supervisorId: 'sup1' }),
    ).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.hint === 'FORBIDDEN',
    )
  })
})

describe('fetchWorkdaysByDate', () => {
  it('lee las jornadas de todos los coordinadores de la fecha, por hora de inicio', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: [WORKDAY_ROW], error: null }),
    )

    const rows = await fetchWorkdaysByDate('2026-10-21')

    expect(fromMock).toHaveBeenCalledWith('v_supervisor_workdays_admin')
    expect(calls).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['work_date', '2026-10-21'] },
        { method: 'order', args: ['started_at', { ascending: true }] },
      ]),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('wd1')
  })
})

describe('correctWorkdayEvent', () => {
  it('llama admin_correct_workday_event con la hora nueva y el motivo', async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null })

    await correctWorkdayEvent({
      eventId: 'e1',
      reason: 'Se olvidó',
      newTime: '2026-10-22T08:00:00-03:00',
    })

    expect(rpcMock).toHaveBeenCalledWith('admin_correct_workday_event', {
      p_event_id: 'e1',
      p_reason: 'Se olvidó',
      p_new_time: '2026-10-22T08:00:00-03:00',
      p_remove: false,
    })
  })

  it('con remove da de baja la pausa', async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null })

    await correctWorkdayEvent({
      eventId: 'e2',
      reason: 'No pausó',
      remove: true,
    })

    expect(rpcMock).toHaveBeenCalledWith(
      'admin_correct_workday_event',
      expect.objectContaining({ p_event_id: 'e2', p_remove: true }),
    )
  })

  it('deja pasar el message y el hint del servidor', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'La hora tiene que caer dentro del día de la jornada.',
        hint: 'AT_OUT_OF_RANGE',
      },
    })

    await expect(
      correctWorkdayEvent({ eventId: 'e1', reason: 'x', newTime: 'y' }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isApiError(error) &&
        error.hint === 'AT_OUT_OF_RANGE' &&
        error.message.startsWith('La hora tiene'),
    )
  })
})

describe('addWorkdayPause', () => {
  it('llama admin_add_workday_pause con los dos motivos', async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null })

    await addWorkdayPause({
      workdayId: 'wd1',
      startsAt: '2026-10-22T12:00:00-03:00',
      endsAt: '2026-10-22T12:30:00-03:00',
      reason: 'No la registró',
      pauseReason: 'Almuerzo',
    })

    expect(rpcMock).toHaveBeenCalledWith('admin_add_workday_pause', {
      p_workday_id: 'wd1',
      p_starts_at: '2026-10-22T12:00:00-03:00',
      p_ends_at: '2026-10-22T12:30:00-03:00',
      p_reason: 'No la registró',
      p_pause_reason: 'Almuerzo',
    })
  })
})

describe('recordWorkday', () => {
  it('llama admin_record_workday en nombre del coordinador', async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null })

    await recordWorkday({
      supervisorId: 'sup1',
      workDate: '2026-10-22',
      startedAt: '2026-10-22T08:00:00-03:00',
      endedAt: '2026-10-22T17:00:00-03:00',
      reason: 'Se olvidó de iniciarla',
    })

    expect(rpcMock).toHaveBeenCalledWith('admin_record_workday', {
      p_supervisor_id: 'sup1',
      p_work_date: '2026-10-22',
      p_started_at: '2026-10-22T08:00:00-03:00',
      p_ended_at: '2026-10-22T17:00:00-03:00',
      p_reason: 'Se olvidó de iniciarla',
    })
  })

  it('traduce WORKDAY_ALREADY_EXISTS', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'Ese día ya tiene una jornada: corregila.',
        hint: 'WORKDAY_ALREADY_EXISTS',
      },
    })

    await expect(
      recordWorkday({
        supervisorId: 'sup1',
        workDate: '2026-10-22',
        startedAt: 'x',
        reason: 'y',
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isApiError(error) && error.hint === 'WORKDAY_ALREADY_EXISTS',
    )
  })
})

describe('workdayAdminErrorMessage', () => {
  it('END_BEFORE_SUPERVISION_START tiene su mensaje fijo', async () => {
    const { workdayAdminErrorMessage } = await import('./workdaysAdmin')
    expect(
      workdayAdminErrorMessage(
        new ApiError('texto del servidor', 'END_BEFORE_SUPERVISION_START'),
        'respaldo',
      ),
    ).toBe(
      'La hora de fin queda antes del inicio de una supervisión que se cerró sola. Elegí una hora posterior o cancelá esa supervisión antes.',
    )
  })

  it('con otro código usa el mensaje del servidor y sin API el respaldo', async () => {
    const { workdayAdminErrorMessage } = await import('./workdaysAdmin')
    expect(
      workdayAdminErrorMessage(new ApiError('del servidor', 'SAME_TIME'), 'x'),
    ).toBe('del servidor')
    expect(workdayAdminErrorMessage(new TypeError('red'), 'respaldo')).toBe(
      'respaldo',
    )
  })
})
