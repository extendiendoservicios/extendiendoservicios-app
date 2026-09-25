import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiError } from './errors'

/**
 * `src/api/shifts.ts` (SHIFT-007): mismo patrón sin red que
 * `users.test.ts` -- se mockea `@/lib/supabase` entero (`from` para
 * `v_shifts_board`/`services`, `rpc` para las cinco funciones de turnos).
 */

interface PostgrestResult<T> {
  data: T | null
  error: { message: string; code?: string; hint?: string } | null
}

function makeChainable<T>(result: PostgrestResult<T>) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    lte: () => chain,
    or: () => chain,
    single: () => Promise.resolve(result),
    order: () => Promise.resolve(result),
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
  fetchShiftsByDate,
  fetchShiftForEdit,
  fetchActiveServicesCountForMonth,
  createShift,
  generateShifts,
  updateShiftTime,
  cancelShift,
  reloadShiftTasks,
} = await import('./shifts')

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
})

const SHIFT_BOARD_ROW = {
  id: 'sh1',
  client_id: 'c1',
  client_legal_name: 'Limpiadora SRL',
  client_trade_name: 'Limpia Ya',
  site_id: 'si1',
  site_name: 'Sede Centro',
  site_city: 'CABA',
  shift_date: '2026-10-05',
  start_time: '08:00:00',
  end_time: '12:00:00',
  required_staff: 2,
  status: 'scheduled' as const,
  display_status: 'scheduled',
  assigned_count: 0,
  present_count: 0,
  finished_count: 0,
  absent_count: 0,
  delayed_count: 0,
  generated: true,
  notes: null,
}

describe('fetchShiftsByDate', () => {
  it('arma ShiftListRow[] a partir de v_shifts_board, con el nombre de fantasía primero', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: [SHIFT_BOARD_ROW], error: null }),
    )

    const rows = await fetchShiftsByDate('2026-10-05')

    expect(fromMock).toHaveBeenCalledWith('v_shifts_board')
    expect(rows).toEqual([
      {
        id: 'sh1',
        clientId: 'c1',
        clientName: 'Limpia Ya',
        siteId: 'si1',
        siteName: 'Sede Centro',
        siteCity: 'CABA',
        shiftDate: '2026-10-05',
        startTime: '08:00:00',
        endTime: '12:00:00',
        requiredStaff: 2,
        status: 'scheduled',
        displayStatus: 'scheduled',
        assignedCount: 0,
        presentCount: 0,
        finishedCount: 0,
        absentCount: 0,
        delayedCount: 0,
        generated: true,
        notes: null,
      },
    ])
  })

  it('usa la razón social cuando no hay nombre de fantasía', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [{ ...SHIFT_BOARD_ROW, client_trade_name: null }],
        error: null,
      }),
    )

    const [row] = await fetchShiftsByDate('2026-10-05')

    expect(row?.clientName).toBe('Limpiadora SRL')
  })

  it('traduce un error de Postgres a ApiError', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: { message: 'boom', code: '42501' },
      }),
    )

    await expect(fetchShiftsByDate('2026-10-05')).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.hint === 'FORBIDDEN',
    )
  })
})

describe('fetchShiftForEdit', () => {
  it('arma ShiftEditRow a partir de v_shifts_board', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: SHIFT_BOARD_ROW, error: null }),
    )

    const row = await fetchShiftForEdit('sh1')

    expect(fromMock).toHaveBeenCalledWith('v_shifts_board')
    expect(row).toEqual({
      id: 'sh1',
      clientId: 'c1',
      clientName: 'Limpia Ya',
      siteId: 'si1',
      siteName: 'Sede Centro',
      shiftDate: '2026-10-05',
      startTime: '08:00:00',
      endTime: '12:00:00',
      requiredStaff: 2,
      status: 'scheduled',
      notes: null,
    })
  })
})

describe('fetchActiveServicesCountForMonth', () => {
  it('cuenta con el rango del mes pedido', async () => {
    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({
          is: () => ({
            lte: () => ({
              or: () => Promise.resolve({ count: 3, error: null }),
            }),
          }),
        }),
      }),
    })

    const count = await fetchActiveServicesCountForMonth(2026, 2)

    expect(fromMock).toHaveBeenCalledWith('services')
    expect(count).toBe(3)
  })
})

describe('createShift', () => {
  it('llama create_shift y devuelve el id y las advertencias', async () => {
    rpcMock.mockResolvedValue({
      data: { shift: { id: 'sh1' }, warnings: ['HOLIDAY'] },
      error: null,
    })

    const result = await createShift({
      clientId: 'c1',
      siteId: 'si1',
      date: '2026-12-25',
      start: '08:00',
      end: '12:00',
      requiredStaff: 2,
    })

    expect(rpcMock).toHaveBeenCalledWith('create_shift', {
      p_client_id: 'c1',
      p_site_id: 'si1',
      p_date: '2026-12-25',
      p_start: '08:00',
      p_end: '12:00',
      p_required_staff: 2,
      p_service_id: undefined,
      p_notes: undefined,
    })
    expect(result).toEqual({ shiftId: 'sh1', warnings: ['HOLIDAY'] })
  })

  it('traduce CLIENT_NOT_ACTIVE (P0001) a ApiError con el mismo mensaje del servidor', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'El cliente no está activo.',
        hint: 'CLIENT_NOT_ACTIVE',
      },
    })

    await expect(
      createShift({
        clientId: 'c1',
        siteId: 'si1',
        date: '2026-12-25',
        start: '08:00',
        end: '12:00',
        requiredStaff: 2,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isApiError(error) &&
        error.hint === 'CLIENT_NOT_ACTIVE' &&
        error.message === 'El cliente no está activo.',
    )
  })
})

describe('generateShifts', () => {
  it('llama generate_shifts y traduce los contadores a camelCase', async () => {
    rpcMock.mockResolvedValue({
      data: { created: 40, skipped: 5, holidays_skipped: 2 },
      error: null,
    })

    const result = await generateShifts(2026, 10)

    expect(rpcMock).toHaveBeenCalledWith('generate_shifts', {
      p_year: 2026,
      p_month: 10,
    })
    expect(result).toEqual({ created: 40, skipped: 5, holidaysSkipped: 2 })
  })

  it('traduce FORBIDDEN cuando falta la capacidad generate_shifts', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'No tenés permiso para hacer esto.',
        hint: 'FORBIDDEN',
      },
    })

    await expect(generateShifts(2026, 10)).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.hint === 'FORBIDDEN',
    )
  })
})

describe('updateShiftTime', () => {
  it('llama update_shift_time con los parámetros esperados', async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null })

    await updateShiftTime('sh1', '09:00', '13:00')

    expect(rpcMock).toHaveBeenCalledWith('update_shift_time', {
      p_shift_id: 'sh1',
      p_start: '09:00',
      p_end: '13:00',
    })
  })

  it('traduce ASSIGNMENT_OVERLAP a ApiError', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'El empleado ya tiene otro turno en ese horario.',
        hint: 'ASSIGNMENT_OVERLAP',
      },
    })

    await expect(updateShiftTime('sh1', '09:00', '13:00')).rejects.toSatisfy(
      (error: unknown) =>
        isApiError(error) && error.hint === 'ASSIGNMENT_OVERLAP',
    )
  })
})

describe('cancelShift', () => {
  it('llama cancel_shift con el motivo', async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null })

    await cancelShift('sh1', 'Cliente canceló el servicio')

    expect(rpcMock).toHaveBeenCalledWith('cancel_shift', {
      p_shift_id: 'sh1',
      p_reason: 'Cliente canceló el servicio',
    })
  })

  it('traduce CANCEL_REASON_REQUIRED a ApiError', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Indicá el motivo.', hint: 'CANCEL_REASON_REQUIRED' },
    })

    await expect(cancelShift('sh1', '')).rejects.toSatisfy(
      (error: unknown) =>
        isApiError(error) && error.hint === 'CANCEL_REASON_REQUIRED',
    )
  })

  it('traduce SHIFT_COMPLETED a ApiError', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Este turno ya terminó.', hint: 'SHIFT_COMPLETED' },
    })

    await expect(cancelShift('sh1', 'motivo')).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.hint === 'SHIFT_COMPLETED',
    )
  })
})

describe('reloadShiftTasks', () => {
  it('llama reload_shift_tasks con el id del turno', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })

    await reloadShiftTasks('sh1')

    expect(rpcMock).toHaveBeenCalledWith('reload_shift_tasks', {
      p_shift_id: 'sh1',
    })
  })
})
