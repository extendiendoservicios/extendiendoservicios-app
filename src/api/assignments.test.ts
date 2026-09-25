import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiError } from './errors'

/**
 * `src/api/assignments.ts` (ASSIGN-007): mismo patrón sin red que
 * `shifts.test.ts` -- se mockea `@/lib/supabase` entero.
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
    gte: () => chain,
    lte: () => chain,
    in: () => chain,
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
  fetchShiftsBoardByRange,
  fetchAssignmentsBoardByRange,
  assignEmployee,
  removeAssignment,
  updateAssignmentTime,
  updateShiftDetails,
} = await import('./assignments')

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
  display_status: 'uncovered',
  assigned_count: 0,
  present_count: 0,
  finished_count: 0,
  absent_count: 0,
  delayed_count: 0,
  generated: true,
  notes: null,
}

describe('fetchShiftsBoardByRange', () => {
  it('arma ShiftListRow[] a partir de v_shifts_board entre dos fechas', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: [SHIFT_BOARD_ROW], error: null }),
    )

    const rows = await fetchShiftsBoardByRange('2026-10-01', '2026-10-31')

    expect(fromMock).toHaveBeenCalledWith('v_shifts_board')
    expect(rows).toEqual([
      expect.objectContaining({ id: 'sh1', displayStatus: 'uncovered' }),
    ])
  })

  it('con filtro de empleado, primero busca los ids asignados y después filtra por ellos', async () => {
    fromMock
      .mockReturnValueOnce(
        makeChainable({
          data: [{ shift_id: 'sh1', shift_date: '2026-10-05' }],
          error: null,
        }),
      )
      .mockReturnValueOnce(
        makeChainable({ data: [SHIFT_BOARD_ROW], error: null }),
      )

    const rows = await fetchShiftsBoardByRange('2026-10-01', '2026-10-31', {
      employeeId: 'emp1',
    })

    expect(fromMock).toHaveBeenNthCalledWith(1, 'assignments')
    expect(fromMock).toHaveBeenNthCalledWith(2, 'v_shifts_board')
    expect(rows).toHaveLength(1)
  })

  it('si el empleado no tiene asignaciones en el rango, no consulta v_shifts_board', async () => {
    fromMock.mockReturnValueOnce(makeChainable({ data: [], error: null }))

    const rows = await fetchShiftsBoardByRange('2026-10-01', '2026-10-31', {
      employeeId: 'emp1',
    })

    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(rows).toEqual([])
  })

  it('traduce un error de Postgres a ApiError', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: null, error: { message: 'boom', code: '42501' } }),
    )

    await expect(
      fetchShiftsBoardByRange('2026-10-01', '2026-10-31'),
    ).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.hint === 'FORBIDDEN',
    )
  })
})

describe('fetchAssignmentsBoardByRange', () => {
  const ASSIGNMENT_BOARD_ROW = {
    id: 'a1',
    shift_id: 'sh1',
    shift_date: '2026-10-05',
    shift_status: 'assigned' as const,
    employee_id: 'emp1',
    employee_first_name: 'Ana',
    employee_last_name: 'Gómez',
    site_id: 'si1',
    site_name: 'Sede Centro',
    client_legal_name: 'Limpiadora SRL',
    effective_start_time: '08:00:00',
    effective_end_time: '12:00:00',
    status: 'expected' as const,
    notes: null,
  }

  it('arma AssignmentBoardRow[] a partir de v_assignments_board', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: [ASSIGNMENT_BOARD_ROW], error: null }),
    )

    const rows = await fetchAssignmentsBoardByRange('2026-10-05', '2026-10-11')

    expect(fromMock).toHaveBeenCalledWith('v_assignments_board')
    expect(rows).toEqual([
      {
        id: 'a1',
        shiftId: 'sh1',
        shiftDate: '2026-10-05',
        shiftStatus: 'assigned',
        employeeId: 'emp1',
        employeeFirstName: 'Ana',
        employeeLastName: 'Gómez',
        siteId: 'si1',
        siteName: 'Sede Centro',
        clientName: 'Limpiadora SRL',
        startTime: '08:00:00',
        endTime: '12:00:00',
        status: 'expected',
        notes: null,
      },
    ])
  })
})

describe('assignEmployee', () => {
  it('llama assign_employee y devuelve la asignación con las advertencias', async () => {
    rpcMock.mockResolvedValue({
      data: {
        assignment: {
          id: 'a1',
          shift_id: 'sh1',
          employee_id: 'emp1',
          start_time: null,
          end_time: null,
          status: 'expected',
          notes: null,
        },
        warnings: ['ON_LEAVE'],
      },
      error: null,
    })

    const result = await assignEmployee({ shiftId: 'sh1', employeeId: 'emp1' })

    expect(rpcMock).toHaveBeenCalledWith('assign_employee', {
      p_shift_id: 'sh1',
      p_employee_id: 'emp1',
      p_start: undefined,
      p_end: undefined,
    })
    expect(result).toEqual({
      assignment: {
        id: 'a1',
        shiftId: 'sh1',
        employeeId: 'emp1',
        startTime: null,
        endTime: null,
        status: 'expected',
        notes: null,
      },
      warnings: ['ON_LEAVE'],
    })
  })

  it('traduce SHIFT_FULL a ApiError con el mismo mensaje del servidor', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'El turno ya tiene la dotación completa.',
        hint: 'SHIFT_FULL',
      },
    })

    await expect(
      assignEmployee({ shiftId: 'sh1', employeeId: 'emp1' }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isApiError(error) &&
        error.hint === 'SHIFT_FULL' &&
        error.message === 'El turno ya tiene la dotación completa.',
    )
  })
})

describe('removeAssignment', () => {
  it('llama remove_assignment con el motivo', async () => {
    rpcMock.mockResolvedValue({
      data: {
        id: 'a1',
        shift_id: 'sh1',
        employee_id: 'emp1',
        start_time: null,
        end_time: null,
        status: 'expected',
        notes: null,
      },
      error: null,
    })

    await removeAssignment('a1', 'El cliente pidió un cambio')

    expect(rpcMock).toHaveBeenCalledWith('remove_assignment', {
      p_assignment_id: 'a1',
      p_reason: 'El cliente pidió un cambio',
    })
  })

  it('traduce ASSIGNMENT_STARTED a ApiError', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'La asignación ya empezó: se cierra, no se puede quitar.',
        hint: 'ASSIGNMENT_STARTED',
      },
    })

    await expect(removeAssignment('a1', 'motivo')).rejects.toSatisfy(
      (error: unknown) =>
        isApiError(error) && error.hint === 'ASSIGNMENT_STARTED',
    )
  })
})

describe('updateAssignmentTime', () => {
  it('llama update_assignment_time con la franja propia', async () => {
    rpcMock.mockResolvedValue({
      data: {
        id: 'a1',
        shift_id: 'sh1',
        employee_id: 'emp1',
        start_time: '09:00:00',
        end_time: '13:00:00',
        status: 'expected',
        notes: null,
      },
      error: null,
    })

    await updateAssignmentTime('a1', '09:00', '13:00')

    expect(rpcMock).toHaveBeenCalledWith('update_assignment_time', {
      p_assignment_id: 'a1',
      p_start: '09:00',
      p_end: '13:00',
    })
  })

  it('traduce ASSIGNMENT_TIME_OUT_OF_SHIFT a ApiError', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message:
          'La franja de la asignación tiene que estar dentro de la del turno.',
        hint: 'ASSIGNMENT_TIME_OUT_OF_SHIFT',
      },
    })

    await expect(
      updateAssignmentTime('a1', '05:00', '13:00'),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isApiError(error) && error.hint === 'ASSIGNMENT_TIME_OUT_OF_SHIFT',
    )
  })
})

describe('updateShiftDetails', () => {
  it('llama update_shift_details y traduce la fila a camelCase', async () => {
    rpcMock.mockResolvedValue({
      data: {
        id: 'sh1',
        required_staff: 3,
        notes: 'Llevar insumos',
        status: 'scheduled',
      },
      error: null,
    })

    const result = await updateShiftDetails('sh1', 3, 'Llevar insumos')

    expect(rpcMock).toHaveBeenCalledWith('update_shift_details', {
      p_shift_id: 'sh1',
      p_required_staff: 3,
      p_notes: 'Llevar insumos',
    })
    expect(result).toEqual({
      id: 'sh1',
      requiredStaff: 3,
      notes: 'Llevar insumos',
      status: 'scheduled',
    })
  })

  it('traduce REQUIRED_STAFF_BELOW_ASSIGNED a ApiError', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message:
          'No podés bajar la dotación por debajo de la cantidad de personas ya asignadas.',
        hint: 'REQUIRED_STAFF_BELOW_ASSIGNED',
      },
    })

    await expect(updateShiftDetails('sh1', 1)).rejects.toSatisfy(
      (error: unknown) =>
        isApiError(error) && error.hint === 'REQUIRED_STAFF_BELOW_ASSIGNED',
    )
  })
})
