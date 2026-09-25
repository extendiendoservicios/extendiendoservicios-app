import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiError } from './errors'

/**
 * `src/api/services.ts` (SERVICE-001): mismo patrón sin red que
 * `clients.test.ts`/`sites.test.ts` — se mockea `@/lib/supabase` entero.
 */

interface PostgrestResult<T> {
  data: T | null
  error: { message: string; code?: string; hint?: string } | null
}

function makeChainable<T>(result: PostgrestResult<T>) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    is: () => chain,
    eq: () => chain,
    order: () => chain,
    single: () => Promise.resolve(result),
    then: (
      resolve: (value: PostgrestResult<T>) => void,
      reject?: (reason: unknown) => void,
    ) => Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabase: { from: fromMock },
}))

const {
  createService,
  updateService,
  setServiceStatus,
  fetchServiceDetail,
  fetchServicesByClient,
  fetchServicesBySite,
} = await import('./services')

beforeEach(() => {
  fromMock.mockReset()
})

const SERVICE_ROW = {
  id: 's1',
  client_id: 'c1',
  site_id: 'si1',
  name: 'Limpieza mañana',
  weekdays: [1, 2, 3, 4, 5],
  start_time: '08:00:00',
  end_time: '12:00:00',
  required_staff: 2,
  valid_from: '2026-01-01',
  valid_to: null,
  works_on_holidays: true,
  min_hours_month: null,
  max_hours_month: null,
  status: 'active' as const,
  notes: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: null,
  clients: { legal_name: 'Limpiadora SRL', trade_name: 'Limpia Ya' },
  sites: { name: 'Sede Centro' },
}

const SERVICE_SUMMARY_ROW = {
  id: 's1',
  client_id: 'c1',
  site_id: 'si1',
  name: 'Limpieza mañana',
  weekdays: [1, 2, 3, 4, 5],
  start_time: '08:00:00',
  end_time: '12:00:00',
  required_staff: 2,
  valid_from: '2026-01-01',
  valid_to: null,
  status: 'active' as const,
  sites: { name: 'Sede Centro' },
}

const FORM_INPUT = {
  clientId: 'c1',
  siteId: 'si1',
  name: 'Limpieza mañana',
  weekdays: [1, 2, 3, 4, 5],
  startTime: '08:00',
  endTime: '12:00',
  requiredStaff: 2,
  validFrom: '2026-01-01',
  validTo: null,
  worksOnHolidays: true,
  minHoursMonth: null,
  maxHoursMonth: null,
  status: 'active' as const,
  notes: null,
}

describe('fetchServiceDetail', () => {
  it('mapea la fila de services a camelCase, con el nombre del cliente y de la sede', async () => {
    fromMock.mockReturnValue(makeChainable({ data: SERVICE_ROW, error: null }))
    const result = await fetchServiceDetail('s1')
    expect(result).toEqual({
      id: 's1',
      clientId: 'c1',
      clientName: 'Limpia Ya',
      siteId: 'si1',
      siteName: 'Sede Centro',
      name: 'Limpieza mañana',
      weekdays: [1, 2, 3, 4, 5],
      startTime: '08:00:00',
      endTime: '12:00:00',
      requiredStaff: 2,
      validFrom: '2026-01-01',
      validTo: null,
      worksOnHolidays: true,
      minHoursMonth: null,
      maxHoursMonth: null,
      status: 'active',
      notes: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: null,
    })
  })

  it('usa la razón social cuando no hay nombre de fantasía', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: {
          ...SERVICE_ROW,
          clients: { legal_name: 'Limpiadora SRL', trade_name: null },
        },
        error: null,
      }),
    )
    const result = await fetchServiceDetail('s1')
    expect(result.clientName).toBe('Limpiadora SRL')
  })
})

describe('fetchServicesByClient', () => {
  it('mapea la lista de servicios de un cliente', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: [SERVICE_SUMMARY_ROW], error: null }),
    )
    const result = await fetchServicesByClient('c1')
    expect(result).toEqual([
      {
        id: 's1',
        clientId: 'c1',
        siteId: 'si1',
        siteName: 'Sede Centro',
        name: 'Limpieza mañana',
        weekdays: [1, 2, 3, 4, 5],
        startTime: '08:00:00',
        endTime: '12:00:00',
        requiredStaff: 2,
        validFrom: '2026-01-01',
        validTo: null,
        status: 'active',
      },
    ])
  })
})

describe('fetchServicesBySite', () => {
  it('mapea la lista de servicios de una sede', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: [SERVICE_SUMMARY_ROW], error: null }),
    )
    const result = await fetchServicesBySite('si1')
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('s1')
  })
})

describe('createService', () => {
  it('inserta y devuelve el servicio creado', async () => {
    fromMock.mockReturnValue(makeChainable({ data: SERVICE_ROW, error: null }))
    const result = await createService(FORM_INPUT, 'admin-1')
    expect(result.id).toBe('s1')
  })

  it('días de la semana inválidos -> ApiError con hint INVALID_WEEKDAYS', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: {
          message:
            'new row for relation "services" violates check constraint "services_weekdays_check"',
          code: '23514',
        },
      }),
    )
    await expect(createService(FORM_INPUT, 'admin-1')).rejects.toMatchObject({
      message: 'Elegí al menos un día de la semana.',
      hint: 'INVALID_WEEKDAYS',
    })
  })

  it('rango horario inválido -> ApiError con hint INVALID_TIME_RANGE', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: {
          message:
            'new row for relation "services" violates check constraint "services_time_range_check"',
          code: '23514',
        },
      }),
    )
    await expect(createService(FORM_INPUT, 'admin-1')).rejects.toMatchObject({
      message: 'La hora de fin tiene que ser posterior a la de inicio.',
      hint: 'INVALID_TIME_RANGE',
    })
  })

  it('dotación fuera de rango -> ApiError con hint VALIDATION_ERROR', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: {
          message:
            'new row for relation "services" violates check constraint "services_required_staff_check"',
          code: '23514',
        },
      }),
    )
    await expect(createService(FORM_INPUT, 'admin-1')).rejects.toMatchObject({
      message: 'La dotación tiene que ser de 1 a 10 personas.',
      hint: 'VALIDATION_ERROR',
    })
  })

  it('otro check no reconocido -> ApiError genérico de fromPostgrestError', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: {
          message: 'otra restricción cualquiera',
          code: '23514',
        },
      }),
    )
    try {
      await createService(FORM_INPUT, 'admin-1')
      expect.unreachable()
    } catch (error) {
      expect(isApiError(error)).toBe(true)
      if (isApiError(error)) {
        expect(error.hint).toBe('VALIDATION_ERROR')
      }
    }
  })
})

describe('updateService', () => {
  it('actualiza y devuelve el servicio', async () => {
    fromMock.mockReturnValue(makeChainable({ data: SERVICE_ROW, error: null }))
    const result = await updateService('s1', FORM_INPUT, 'admin-1')
    expect(result.id).toBe('s1')
  })
})

describe('setServiceStatus', () => {
  it('actualiza solo el estado', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: { ...SERVICE_ROW, status: 'paused' },
        error: null,
      }),
    )
    const result = await setServiceStatus('s1', 'paused', 'admin-1')
    expect(result.status).toBe('paused')
  })
})
