import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiError } from './errors'
import {
  fetchEmployeeFixedGaps,
  fetchEmployeeFixedPattern,
  fetchEmployeeWeekBoard,
  saveEmployeeWeekBoard,
} from './employeeFixed'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: rpcMock } }))

beforeEach(() => {
  rpcMock.mockReset()
})

describe('employeeFixed', () => {
  it('pide los huecos del mes y traduce el detalle del choque', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          shift_id: 's1',
          shift_date: '2026-11-10',
          start_time: '08:00:00',
          end_time: '12:00:00',
          open_ended: false,
          client_id: 'c1',
          client_name: 'Cliente',
          site_id: 'si1',
          site_name: 'Sede',
          service_id: 'sv1',
          service_name: 'Limpieza',
          calendar_color: 4,
          reason: 'OVERLAP',
          detail: {
            code: 'OVERLAP',
            conflict_shift_id: 'sx',
            site_name: 'Otra',
            start_time: '09:00:00',
            end_time: '10:00:00',
          },
          shift_status: 'scheduled',
        },
      ],
      error: null,
    })
    const gaps = await fetchEmployeeFixedGaps('p1', '2026-11-01', '2026-11-30')
    expect(rpcMock).toHaveBeenCalledWith('employee_fixed_gaps', {
      p_employee_id: 'p1',
      p_from: '2026-11-01',
      p_to: '2026-11-30',
    })
    expect(gaps[0]).toMatchObject({
      shiftId: 's1',
      reason: 'OVERLAP',
      calendarColor: 4,
    })
    expect(gaps[0]?.detail?.conflictShiftId).toBe('sx')
  })

  it('un motivo que la base ya no devuelve (SHIFT_FULL, D-01) cae en «sin asignar»', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          shift_id: 's1',
          shift_date: '2026-11-10',
          start_time: '08:00:00',
          end_time: '12:00:00',
          open_ended: false,
          client_id: 'c1',
          client_name: 'Cliente',
          site_id: 'si1',
          site_name: 'Sede',
          service_id: 'sv1',
          service_name: 'Limpieza',
          calendar_color: 4,
          reason: 'SHIFT_FULL',
          detail: null,
          shift_status: 'scheduled',
        },
      ],
      error: null,
    })
    const gaps = await fetchEmployeeFixedGaps('p1', '2026-11-01', '2026-11-30')
    expect(gaps[0]?.reason).toBe('NOT_ASSIGNED')
  })

  it('el patrón deja weeks_of_month vacío como null (todas las semanas)', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          service_id: 'sv1',
          service_name: 'L',
          client_id: 'c',
          client_name: 'C',
          site_id: 's',
          site_name: 'S',
          calendar_color: 0,
          weekdays: [1, 2],
          weeks_of_month: [],
          start_time: '08:00:00',
          end_time: '12:00:00',
          open_ended: false,
          valid_from: '2026-01-01',
          valid_to: null,
        },
      ],
      error: null,
    })
    const rows = await fetchEmployeeFixedPattern('p1')
    expect(rows[0]?.weeksOfMonth).toBeNull()
    expect(rows[0]?.weekdays).toEqual([1, 2])
  })

  it('la pizarra devuelve null si todavía no hay ninguna guardada', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null })
    expect(await fetchEmployeeWeekBoard('p1')).toBeNull()
  })

  it('guarda con las claves de la base y lee quién la editó', async () => {
    rpcMock.mockResolvedValue({
      data: {
        employee_id: 'p1',
        blocks: [
          {
            id: 'b1',
            weekday: 0,
            start: '08:00',
            end: null,
            label: 'X',
            color_index: 5,
            service_id: null,
          },
        ],
        updated_by: 'u1',
        updated_by_name: 'Laura Gómez',
        updated_at: '2026-11-18T15:00:00Z',
      },
      error: null,
    })
    const board = await saveEmployeeWeekBoard('p1', [
      {
        id: 'b1',
        weekday: 0,
        start: '08:00',
        end: null,
        label: 'X',
        colorIndex: 5,
        serviceId: null,
      },
    ])
    expect(rpcMock).toHaveBeenCalledWith('save_employee_week_board', {
      p_employee_id: 'p1',
      p_blocks: [
        {
          id: 'b1',
          weekday: 0,
          start: '08:00',
          end: null,
          label: 'X',
          color_index: 5,
          service_id: null,
        },
      ],
    })
    expect(board.updatedByName).toBe('Laura Gómez')
    expect(board.blocks[0]?.colorIndex).toBe(5)
  })

  it('INVALID_BOARD llega como error tipado con el mensaje del servidor', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: 'P0001',
        message: 'El bloque 2 no tiene un formato válido.',
        hint: 'INVALID_BOARD',
      },
    })
    const error: unknown = await saveEmployeeWeekBoard('p1', []).catch(
      (caught: unknown) => caught,
    )
    if (!isApiError(error)) {
      throw new Error('Se esperaba un ApiError.')
    }
    expect(error.hint).toBe('INVALID_BOARD')
    expect(error.message).toBe('El bloque 2 no tiene un formato válido.')
  })
})
