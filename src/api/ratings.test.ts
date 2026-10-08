import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiError } from './errors'

/**
 * `src/api/ratings.ts` (SUP-008): mismo patrón sin red que
 * `assignments.test.ts` -- se mockea `@/lib/supabase` entero.
 */

interface PostgrestResult<T> {
  data: T | null
  error: { message: string; code?: string; hint?: string } | null
}

function makeChainable<T>(result: PostgrestResult<T>) {
  const chain: Record<string, unknown> = {
    select: () => chain,
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

const { fetchEmployeeRatingsSummary, fetchRatings, rateEmployee } =
  await import('./ratings')

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
})

const RATING_ROW = {
  id: 'r1',
  supervision_id: 'sup1',
  assignment_id: 'a1',
  score: 4,
  comment: 'Muy prolija',
  created_at: '2026-10-05T13:00:00+00:00',
  assignment: {
    employee_id: 'emp1',
    employees: {
      profile_id: 'emp1',
      profiles: { first_name: 'Ana', last_name: 'Gómez' },
    },
    shift: {
      shift_date: '2026-10-05',
      site_id: 'si1',
      sites: { name: 'Sede Centro' },
    },
  },
  supervision: {
    supervisor_id: 'sup-emp1',
    employees: {
      profile_id: 'sup-emp1',
      profiles: { first_name: 'Marta', last_name: 'Ríos' },
    },
  },
}

describe('fetchRatings', () => {
  it('arma RatingListRow[] a partir de ratings con assignment y supervision embebidos', async () => {
    fromMock.mockReturnValue(makeChainable({ data: [RATING_ROW], error: null }))

    const rows = await fetchRatings()

    expect(fromMock).toHaveBeenCalledWith('ratings')
    expect(rows).toEqual([
      {
        id: 'r1',
        supervisionId: 'sup1',
        assignmentId: 'a1',
        employeeId: 'emp1',
        employeeFirstName: 'Ana',
        employeeLastName: 'Gómez',
        shiftDate: '2026-10-05',
        siteId: 'si1',
        siteName: 'Sede Centro',
        supervisorId: 'sup-emp1',
        supervisorFirstName: 'Marta',
        supervisorLastName: 'Ríos',
        score: 4,
        comment: 'Muy prolija',
        createdAt: '2026-10-05T13:00:00+00:00',
      },
    ])
  })

  it('filtra en el cliente por empleado, supervisor, sede y rango de fechas', async () => {
    fromMock.mockReturnValue(makeChainable({ data: [RATING_ROW], error: null }))

    expect(await fetchRatings({ employeeId: 'emp-otro' })).toEqual([])
    expect(await fetchRatings({ supervisorId: 'sup-otro' })).toEqual([])
    expect(await fetchRatings({ siteId: 'si-otro' })).toEqual([])
    expect(await fetchRatings({ dateFrom: '2026-10-06' })).toEqual([])
    expect(await fetchRatings({ dateTo: '2026-10-04' })).toEqual([])
    expect(await fetchRatings({ employeeId: 'emp1' })).toHaveLength(1)
  })

  it('traduce un error de Postgres a ApiError', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: null, error: { message: 'boom', code: '42501' } }),
    )

    await expect(fetchRatings()).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.hint === 'FORBIDDEN',
    )
  })
})

describe('rateEmployee', () => {
  it('llama rate_employee y devuelve la calificación en camelCase', async () => {
    rpcMock.mockResolvedValue({
      data: {
        id: 'r1',
        supervision_id: 'sup1',
        assignment_id: 'a1',
        score: 4,
        comment: 'Muy prolija',
        created_at: '2026-10-05T13:00:00+00:00',
        updated_at: null,
      },
      error: null,
    })

    const result = await rateEmployee({
      supervisionId: 'sup1',
      assignmentId: 'a1',
      score: 4,
      comment: 'Muy prolija',
    })

    expect(rpcMock).toHaveBeenCalledWith('rate_employee', {
      p_supervision_id: 'sup1',
      p_assignment_id: 'a1',
      p_score: 4,
      p_comment: 'Muy prolija',
    })
    expect(result).toEqual(
      expect.objectContaining({ id: 'r1', score: 4, comment: 'Muy prolija' }),
    )
  })

  it('traduce SELF_RATING_NOT_ALLOWED a ApiError con el mismo mensaje del servidor', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'No podés calificarte a vos mismo.',
        hint: 'SELF_RATING_NOT_ALLOWED',
      },
    })

    await expect(
      rateEmployee({ supervisionId: 'sup1', assignmentId: 'a1', score: 3 }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isApiError(error) && error.hint === 'SELF_RATING_NOT_ALLOWED',
    )
  })

  it('traduce RATING_WINDOW_CLOSED a ApiError', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'El plazo para editar esta calificación terminó.',
        hint: 'RATING_WINDOW_CLOSED',
      },
    })

    await expect(
      rateEmployee({ supervisionId: 'sup1', assignmentId: 'a1', score: 3 }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isApiError(error) && error.hint === 'RATING_WINDOW_CLOSED',
    )
  })
})

describe('fetchEmployeeRatingsSummary (AJ-04, AJ-05)', () => {
  it('trae el promedio de todos los empleados en una sola consulta a v_employee_ratings', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          { employee_id: 'e1', ratings_count: 12, ratings_avg: 4.33 },
          { employee_id: 'e2', ratings_count: 1, ratings_avg: '5.00' },
          { employee_id: null, ratings_count: 3, ratings_avg: 2 },
        ],
        error: null,
      }),
    )

    const summaries = await fetchEmployeeRatingsSummary()

    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(fromMock).toHaveBeenCalledWith('v_employee_ratings')
    expect(summaries.get('e1')).toEqual({ average: 4.33, count: 12 })
    expect(summaries.get('e2')).toEqual({ average: 5, count: 1 })
    expect(summaries.size).toBe(2)
  })

  it('traduce un error de la consulta a ApiError', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: { message: 'permission denied', code: '42501' },
      }),
    )
    await expect(fetchEmployeeRatingsSummary()).rejects.toSatisfy(isApiError)
  })
})
