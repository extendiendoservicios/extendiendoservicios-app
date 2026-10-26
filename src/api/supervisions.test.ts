import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiError } from './errors'

/**
 * `src/api/supervisions.ts` (SUP-008): mismo patrón sin red que
 * `assignments.test.ts` -- se mockea `@/lib/supabase` entero.
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
    in: () => chain,
    gte: () => chain,
    lte: () => chain,
    contains: () => chain,
    order: () => chain,
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
  fetchSupervisionsAdmin,
  fetchSupervisionDetail,
  fetchSupervisorCandidates,
  cancelSupervision,
} = await import('./supervisions')

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
})

const SUPERVISION_LIST_ROW = {
  id: 'sup1',
  shift_id: 'sh1',
  shift_date: '2026-10-05',
  client_id: 'c1',
  client_legal_name: 'Limpiadora SRL',
  site_id: 'si1',
  site_name: 'Sede Centro',
  start_time: '08:00:00',
  end_time: '12:00:00',
  supervisor_id: 'sup-emp1',
  supervisor_first_name: 'Marta',
  supervisor_last_name: 'Ríos',
  status: 'in_progress' as const,
  assigned_at: '2026-10-01T00:00:00+00:00',
  check_in_at: '2026-10-05T08:10:00+00:00',
  check_out_at: null,
  general_notes: null,
  cancel_reason: null,
  not_done_reason: null,
  criteria_snapshot: [
    { id: 'cr1', title: 'Prolijidad', description: null, position: 1 },
  ],
  ratings_count: 0,
  ratings_avg: null,
  assigned_employees_count: 2,
  workday_id: 'wd1',
  duration_minutes: 95,
  unclosed: false,
  workday_auto_closed: false,
}

describe('fetchSupervisionsAdmin', () => {
  it('arma SupervisionListRow[] a partir de v_supervisions_admin', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: [SUPERVISION_LIST_ROW], error: null }),
    )

    const rows = await fetchSupervisionsAdmin()

    expect(fromMock).toHaveBeenCalledWith('v_supervisions_admin')
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'sup1',
        clientName: 'Limpiadora SRL',
        siteName: 'Sede Centro',
        supervisorFirstName: 'Marta',
        supervisorLastName: 'Ríos',
        status: 'in_progress',
        workdayId: 'wd1',
        durationMinutes: 95,
        unclosed: false,
        workdayAutoClosed: false,
        criteriaSnapshot: [
          { id: 'cr1', title: 'Prolijidad', description: null, position: 1 },
        ],
        assignedEmployeesCount: 2,
      }),
    ])
  })

  it('devuelve una fila por supervisión aunque haya dos en el mismo turno y marca «Sin cerrar»', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          SUPERVISION_LIST_ROW,
          {
            ...SUPERVISION_LIST_ROW,
            id: 'sup2',
            supervisor_id: 'sup-emp2',
            unclosed: true,
            workday_auto_closed: true,
          },
        ],
        error: null,
      }),
    )

    const rows = await fetchSupervisionsAdmin()

    expect(rows.map((row) => [row.id, row.shiftId, row.unclosed])).toEqual([
      ['sup1', 'sh1', false],
      ['sup2', 'sh1', true],
    ])
    expect(rows[1]?.workdayAutoClosed).toBe(true)
  })

  it('con filtro de empleado, primero busca las supervisiones con calificación de ese empleado', async () => {
    fromMock
      .mockReturnValueOnce(makeChainable({ data: [{ id: 'a1' }], error: null }))
      .mockReturnValueOnce(
        makeChainable({ data: [{ supervision_id: 'sup1' }], error: null }),
      )
      .mockReturnValueOnce(
        makeChainable({ data: [SUPERVISION_LIST_ROW], error: null }),
      )

    const rows = await fetchSupervisionsAdmin({ employeeId: 'emp1' })

    expect(fromMock).toHaveBeenNthCalledWith(1, 'assignments')
    expect(fromMock).toHaveBeenNthCalledWith(2, 'ratings')
    expect(fromMock).toHaveBeenNthCalledWith(3, 'v_supervisions_admin')
    expect(rows).toHaveLength(1)
  })

  it('si el empleado no tiene asignaciones, no consulta v_supervisions_admin', async () => {
    fromMock.mockReturnValueOnce(makeChainable({ data: [], error: null }))

    const rows = await fetchSupervisionsAdmin({ employeeId: 'emp1' })

    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(rows).toEqual([])
  })

  it('traduce un error de Postgres a ApiError', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: null, error: { message: 'boom', code: '42501' } }),
    )

    await expect(fetchSupervisionsAdmin()).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.hint === 'FORBIDDEN',
    )
  })
})

describe('fetchSupervisionDetail', () => {
  it('arma el detalle con las calificaciones por asignación vigente', async () => {
    fromMock
      .mockReturnValueOnce(
        makeChainable({ data: SUPERVISION_LIST_ROW, error: null }),
      )
      .mockReturnValueOnce(
        makeChainable({
          data: [
            {
              id: 'a1',
              employee_id: 'emp1',
              removed_at: null,
              employees: {
                profile_id: 'emp1',
                profiles: { first_name: 'Ana', last_name: 'Gómez' },
              },
            },
          ],
          error: null,
        }),
      )
      .mockReturnValueOnce(
        makeChainable({
          data: [
            {
              id: 'r1',
              assignment_id: 'a1',
              score: 4,
              comment: 'Muy bien',
              created_at: '2026-10-05T13:00:00+00:00',
              updated_at: null,
              updated_by: null,
              updated_by_profile: null,
            },
          ],
          error: null,
        }),
      )

    const result = await fetchSupervisionDetail('sup1')

    expect(result.detail.id).toBe('sup1')
    expect(result.employeeRatings).toHaveLength(1)
    expect(result.employeeRatings[0]).toEqual(
      expect.objectContaining({
        assignmentId: 'a1',
        employeeFirstName: 'Ana',
        employeeLastName: 'Gómez',
      }),
    )
    expect(result.employeeRatings[0]?.rating).toEqual(
      expect.objectContaining({ score: 4, comment: 'Muy bien' }),
    )
  })
})

describe('fetchSupervisorCandidates', () => {
  it('pide v_employees con rol supervisor, activos y sin baja lógica', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          { profile_id: 'sup-emp1', first_name: 'Marta', last_name: 'Ríos' },
        ],
        error: null,
      }),
    )

    const candidates = await fetchSupervisorCandidates()

    expect(fromMock).toHaveBeenCalledWith('v_employees')
    expect(candidates).toEqual([
      { profileId: 'sup-emp1', firstName: 'Marta', lastName: 'Ríos' },
    ])
  })

  it('ordena por "Nombre Apellido", como se muestra en el selector de preferenciales', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          { profile_id: 'p1', first_name: 'Paula', last_name: 'Lemos' },
          { profile_id: 'p2', first_name: 'Noelia', last_name: 'Vera' },
          { profile_id: 'p3', first_name: 'Carlos', last_name: 'Medina' },
          { profile_id: 'p4', first_name: 'Ángela', last_name: 'Sosa' },
        ],
        error: null,
      }),
    )

    const candidates = await fetchSupervisorCandidates()

    expect(candidates.map((c) => c.firstName)).toEqual([
      'Ángela',
      'Carlos',
      'Noelia',
      'Paula',
    ])
  })
})

describe('cancelSupervision', () => {
  it('llama cancel_supervision con el motivo', async () => {
    rpcMock.mockResolvedValue({
      data: {
        id: 'sup1',
        shift_id: 'sh1',
        supervisor_id: 'sup-emp1',
        status: 'cancelled',
        assigned_at: '2026-10-05T08:00:00+00:00',
        general_notes: null,
        cancel_reason: 'Se canceló el turno',
        not_done_reason: null,
      },
      error: null,
    })

    await cancelSupervision('sup1', 'Se canceló el turno')

    expect(rpcMock).toHaveBeenCalledWith('cancel_supervision', {
      p_supervision_id: 'sup1',
      p_reason: 'Se canceló el turno',
    })
  })
})
