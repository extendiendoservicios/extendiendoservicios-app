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
    neq: () => chain,
    is: () => chain,
    gte: () => chain,
    lte: () => chain,
    in: () => chain,
    or: () => chain,
    order: () => chain,
    range: () => chain,
    single: () => chain,
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
  fetchShiftDetail,
  fetchAssignCandidates,
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
  it('pide de a páginas hasta traer el mes entero (max_rows = 1000)', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      ...SHIFT_BOARD_ROW,
      id: `sh-${i}`,
    }))
    fromMock
      .mockReturnValueOnce(makeChainable({ data: fullPage, error: null }))
      .mockReturnValueOnce(
        makeChainable({
          data: [{ ...SHIFT_BOARD_ROW, id: 'sh-1000' }],
          error: null,
        }),
      )

    const result = await fetchShiftsBoardByRange('2026-10-01', '2026-10-31')

    expect(fromMock).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(1001)
    expect(result[1000]?.id).toBe('sh-1000')
  })

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

describe('fetchShiftDetail', () => {
  const SHIFT_DETAIL_ROW = {
    id: 'sh1',
    client_id: 'c1',
    site_id: 'si1',
    shift_date: '2026-10-05',
    start_time: '08:00:00',
    end_time: '12:00:00',
    required_staff: 2,
    status: 'assigned' as const,
    notes: 'Llevar insumos',
    generated: true,
    service_id: 'sv1',
    starts_at: '2026-10-05T11:00:00+00:00',
    client: { id: 'c1', legal_name: 'Limpiadora SRL', trade_name: 'Limpia Ya' },
    site: { id: 'si1', name: 'Sede Centro', city: 'CABA' },
    assignments: [
      {
        id: 'a1',
        employee_id: 'emp1',
        start_time: null,
        end_time: null,
        status: 'expected' as const,
        notes: null,
        removed_at: null,
        employees: {
          profile_id: 'emp1',
          profiles: { first_name: 'Ana', last_name: 'Gómez' },
        },
      },
      {
        id: 'a2',
        employee_id: 'emp2',
        start_time: '09:00:00',
        end_time: '11:00:00',
        status: 'present' as const,
        notes: null,
        removed_at: '2026-10-01T00:00:00+00:00',
        employees: {
          profile_id: 'emp2',
          profiles: { first_name: 'Luis', last_name: 'Pérez' },
        },
      },
    ],
    shift_tasks: [
      {
        id: 't2',
        title: 'Vaciar cestos',
        description: null,
        is_required: false,
        status: 'pending' as const,
        position: 2,
        not_done_reason: null,
      },
      {
        id: 't1',
        title: 'Barrer',
        description: null,
        is_required: true,
        status: 'done' as const,
        position: 1,
        not_done_reason: null,
      },
    ],
    supervisions: [
      {
        id: 'sup1',
        supervisor_id: 'sup-emp1',
        status: 'assigned' as const,
        assigned_at: '2026-10-01T00:00:00+00:00',
        general_notes: null,
        not_done_reason: null,
        employees: {
          profile_id: 'sup-emp1',
          profiles: { first_name: 'Marta', last_name: 'Ríos' },
        },
      },
    ],
  }

  it('arma el detalle: solo asignaciones vigentes y tareas ordenadas por posición', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: SHIFT_DETAIL_ROW, error: null }),
    )

    const detail = await fetchShiftDetail('sh1')

    expect(fromMock).toHaveBeenCalledWith('shifts')
    expect(detail.clientName).toBe('Limpia Ya')
    expect(detail.fromService).toBe(true)
    expect(detail.assignments).toHaveLength(1)
    expect(detail.assignments[0]).toEqual(
      expect.objectContaining({
        id: 'a1',
        employeeFirstName: 'Ana',
        employeeLastName: 'Gómez',
      }),
    )
    expect(detail.tasks.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(detail.supervisions[0]).toEqual(
      expect.objectContaining({
        supervisorFirstName: 'Marta',
        supervisorLastName: 'Ríos',
      }),
    )
  })

  it('traduce un error de Postgres a ApiError', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: null, error: { message: 'boom', code: '42501' } }),
    )

    await expect(fetchShiftDetail('sh1')).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.hint === 'FORBIDDEN',
    )
  })
})

describe('fetchAssignCandidates', () => {
  const BASE_PARAMS = {
    shiftId: 'sh1',
    clientId: 'c1',
    shiftDate: '2026-10-05', // lunes
    startTime: '08:00:00',
    endTime: '12:00:00',
    excludeEmployeeIds: [] as string[],
  }

  it('ordena habilitados y disponibles primero, y marca las advertencias', async () => {
    fromMock
      .mockReturnValueOnce(
        makeChainable({
          data: [
            { profile_id: 'emp1', first_name: 'Ana', last_name: 'Gómez' },
            { profile_id: 'emp2', first_name: 'Luis', last_name: 'Pérez' },
          ],
          error: null,
        }),
      )
      // Habilitaciones: emp2 tiene una lista que NO incluye este cliente.
      .mockReturnValueOnce(
        makeChainable({
          data: [{ employee_id: 'emp2', client_id: 'c-otro' }],
          error: null,
        }),
      )
      // Disponibilidad: nadie declaró franjas -- sin restricción para nadie.
      .mockReturnValueOnce(makeChainable({ data: [], error: null }))
      // Licencias: ninguna vigente para la fecha del turno.
      .mockReturnValueOnce(makeChainable({ data: [], error: null }))
      // Otra asignación el mismo día: emp1 ya está en otro turno.
      .mockReturnValueOnce(
        makeChainable({
          data: [
            {
              employee_id: 'emp1',
              shift_id: 'sh-otro',
              start_time: null,
              end_time: null,
              shift: {
                start_time: '14:00:00',
                end_time: '18:00:00',
                site: { name: 'Sede Norte' },
              },
            },
          ],
          error: null,
        }),
      )

    const candidates = await fetchAssignCandidates(BASE_PARAMS)

    expect(candidates.map((c) => c.employeeId)).toEqual(['emp1', 'emp2'])
    expect(candidates[0]).toEqual(
      expect.objectContaining({
        employeeId: 'emp1',
        enabledForClient: true,
        availableThatDay: true,
        onLeave: false,
      }),
    )
    expect(candidates[0]?.conflicts).toEqual([
      {
        shiftId: 'sh-otro',
        siteName: 'Sede Norte',
        startTime: '14:00:00',
        endTime: '18:00:00',
        overlaps: false,
      },
    ])
    expect(candidates[1]).toEqual(
      expect.objectContaining({ employeeId: 'emp2', enabledForClient: false }),
    )
  })

  it('marca la superposición y manda a ese candidato al final', async () => {
    fromMock
      .mockReturnValueOnce(
        makeChainable({
          data: [
            { profile_id: 'emp1', first_name: 'Ana', last_name: 'Gómez' },
            { profile_id: 'emp2', first_name: 'Luis', last_name: 'Pérez' },
          ],
          error: null,
        }),
      )
      // emp2 no está habilitado para el cliente (queda en el grupo del medio).
      .mockReturnValueOnce(
        makeChainable({
          data: [{ employee_id: 'emp2', client_id: 'c-otro' }],
          error: null,
        }),
      )
      .mockReturnValueOnce(makeChainable({ data: [], error: null }))
      .mockReturnValueOnce(makeChainable({ data: [], error: null }))
      // emp1 ya trabaja de 10 a 14: se pisa con el turno de 8 a 12.
      .mockReturnValueOnce(
        makeChainable({
          data: [
            {
              employee_id: 'emp1',
              shift_id: 'sh-otro',
              start_time: '10:00:00',
              end_time: '14:00:00',
              shift: {
                start_time: '10:00:00',
                end_time: '18:00:00',
                site: { name: 'Sede Norte' },
              },
            },
          ],
          error: null,
        }),
      )

    const candidates = await fetchAssignCandidates(BASE_PARAMS)

    expect(candidates.map((c) => c.employeeId)).toEqual(['emp2', 'emp1'])
    expect(candidates[1]?.conflicts[0]?.overlaps).toBe(true)
  })

  it('excluye a quienes ya están asignados a este turno, sin consultar el resto', async () => {
    fromMock.mockReturnValueOnce(
      makeChainable({
        data: [{ profile_id: 'emp1', first_name: 'Ana', last_name: 'Gómez' }],
        error: null,
      }),
    )

    const candidates = await fetchAssignCandidates({
      ...BASE_PARAMS,
      excludeEmployeeIds: ['emp1'],
    })

    expect(candidates).toEqual([])
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it('traduce un error de Postgres a ApiError', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: null, error: { message: 'boom', code: '42501' } }),
    )

    await expect(fetchAssignCandidates(BASE_PARAMS)).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.hint === 'FORBIDDEN',
    )
  })
})
