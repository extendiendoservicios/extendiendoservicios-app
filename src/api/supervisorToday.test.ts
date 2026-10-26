import { beforeEach, describe, expect, it, vi } from 'vitest'

/** `src/api/supervisorToday.ts` (P24.2, CJ-25): lectura de `v_supervisor_today`, sin red. */

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

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }))

const { fetchSupervisorToday } = await import('./supervisorToday')

beforeEach(() => fromMock.mockReset())

const ROW = {
  shift_id: 'sh1',
  shift_date: '2026-10-23',
  start_time: '08:00:00',
  end_time: '12:00:00',
  starts_at: '2026-10-23T11:00:00Z',
  ends_at: '2026-10-23T15:00:00Z',
  open_ended: false,
  display_state: 'in_progress',
  required_staff: 2,
  client_id: 'c1',
  client_legal_name: 'Limpiadora SRL',
  client_trade_name: 'Limpiadora',
  site_id: 'si1',
  site_name: 'Sede Centro',
  site_address: 'Av. Siempre Viva 123',
  site_city: 'Tigre',
  site_latitude: -34.4,
  site_longitude: -58.5,
  is_priority: true,
  priority_kind: 'site',
  shift_status: 'in_progress',
  my_supervision_id: null,
  my_supervision_status: null,
  assigned_employees: [
    {
      assignment_id: 'as1',
      employee_id: 'e1',
      first_name: 'Marta',
      last_name: 'Gómez',
      status: 'present',
      check_in_at: '2026-10-23T11:05:00Z',
      check_out_at: null,
    },
  ],
  supervisors: [
    {
      supervision_id: 'sv1',
      supervisor_id: 'u2',
      first_name: 'Ana',
      last_name: 'Ruiz',
      status: 'in_progress',
      check_in_at: '2026-10-23T11:30:00Z',
      check_out_at: null,
      is_me: false,
    },
  ],
}

describe('fetchSupervisorToday', () => {
  it('lee v_supervisor_today y mapea empleados con su assignment_id y quién supervisa', async () => {
    fromMock.mockReturnValue(makeChainable({ data: [ROW], error: null }))

    const shifts = await fetchSupervisorToday()

    expect(fromMock).toHaveBeenCalledWith('v_supervisor_today')
    expect(shifts).toHaveLength(1)
    expect(shifts[0]).toMatchObject({
      shiftId: 'sh1',
      clientName: 'Limpiadora SRL',
      siteName: 'Sede Centro',
      displayState: 'in_progress',
      isPriority: true,
      mySupervisionId: null,
    })
    expect(shifts[0]?.assignedEmployees[0]).toMatchObject({
      assignmentId: 'as1',
      employeeId: 'e1',
      firstName: 'Marta',
      checkInAt: '2026-10-23T11:05:00Z',
    })
    expect(shifts[0]?.supervisors[0]).toMatchObject({
      supervisionId: 'sv1',
      firstName: 'Ana',
      isMe: false,
    })
  })

  it('mapea el radio efectivo de la sede y la precisión máxima (DEF-P24-02)', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          { ...ROW, site_radius_m: 300, max_accuracy_m: 120 },
          { ...ROW, shift_id: 'sh2' },
        ],
        error: null,
      }),
    )
    const shifts = await fetchSupervisorToday()
    expect(shifts[0]).toMatchObject({ siteRadiusM: 300, maxAccuracyM: 120 })
    // Si la vista no las trae quedan en null y el panel usa los valores por defecto.
    expect(shifts[1]).toMatchObject({ siteRadiusM: null, maxAccuracyM: null })
  })

  it('mapea los datos útiles de la sede y deja null los que no vienen', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          {
            ...ROW,
            site_contact_name: 'Rosa Pérez',
            site_contact_phone: '11 5555-1234',
            access_instructions: 'Timbre 3B',
            building_hours: 'Lunes a viernes de 7 a 20',
            restrictions_notes: 'No mover los equipos',
          },
          { ...ROW, shift_id: 'sh2' },
        ],
        error: null,
      }),
    )
    const shifts = await fetchSupervisorToday()
    expect(shifts[0]).toMatchObject({
      siteContactName: 'Rosa Pérez',
      siteContactPhone: '11 5555-1234',
      accessInstructions: 'Timbre 3B',
      buildingHours: 'Lunes a viernes de 7 a 20',
      restrictionsNotes: 'No mover los equipos',
    })
    expect(shifts[1]).toMatchObject({
      siteContactName: null,
      siteContactPhone: null,
      accessInstructions: null,
      buildingHours: null,
      restrictionsNotes: null,
    })
  })

  it('tolera campos JSON vacíos', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [{ ...ROW, assigned_employees: null, supervisors: null }],
        error: null,
      }),
    )
    const shifts = await fetchSupervisorToday()
    expect(shifts[0]?.assignedEmployees).toEqual([])
    expect(shifts[0]?.supervisors).toEqual([])
  })

  it('propaga el error traducido', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: null, error: { message: 'x', code: '42501' } }),
    )
    await expect(fetchSupervisorToday()).rejects.toMatchObject({
      hint: 'FORBIDDEN',
    })
  })
})
