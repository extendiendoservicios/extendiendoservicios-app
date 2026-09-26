import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `src/api/myDay.ts` (ATT-005): mismo patrón sin red que
 * `src/api/assignments.test.ts` — se mockea `@/lib/supabase` entero.
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

const { fetchMyDay, isRelevantChange, markChangesSeen, fetchShiftPeers } =
  await import('./myDay')

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
})

const MY_DAY_ROW = {
  assignment_id: 'a1',
  shift_id: 'sh1',
  shift_date: '2026-09-26',
  is_today: true,
  client_id: 'c1',
  client_legal_name: 'Limpiadora SRL',
  client_trade_name: 'Limpia Ya',
  site_id: 'si1',
  site_name: 'Sede Centro',
  site_address: 'Av. Siempre Viva 123',
  site_contact_name: 'Ana',
  site_contact_phone: '1122334455',
  access_instructions: 'Timbre 3B',
  building_hours: '08:00 a 20:00',
  phone_restricted: false,
  photos_not_allowed: false,
  restrictions_notes: null,
  effective_start_time: '08:00:00',
  effective_end_time: '12:00:00',
  effective_starts_at: '2026-09-26T11:00:00Z',
  effective_ends_at: '2026-09-26T15:00:00Z',
  status: 'expected' as const,
  shift_status: 'scheduled' as const,
  notes: null,
  tasks_total: 3,
  tasks_done: 0,
  changed_since_last_seen: true,
  check_in_at: null,
  check_out_at: null,
}

describe('fetchMyDay', () => {
  it('arma MyDayAssignment[] a partir de v_my_day, con el nombre de fantasía primero', async () => {
    fromMock.mockReturnValue(makeChainable({ data: [MY_DAY_ROW], error: null }))

    const rows = await fetchMyDay()

    expect(fromMock).toHaveBeenCalledWith('v_my_day')
    expect(rows).toEqual([
      expect.objectContaining({
        assignmentId: 'a1',
        clientName: 'Limpia Ya',
        startTime: '08:00:00',
        changedSinceLastSeen: true,
        checkInAt: null,
      }),
    ])
  })

  it('propaga el error traducido si la consulta falla', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: null, error: { message: 'boom', code: '500' } }),
    )

    await expect(fetchMyDay()).rejects.toThrow()
  })
})

describe('isRelevantChange', () => {
  it('es relevante si cambió y todavía no se registró el inicio', () => {
    expect(
      isRelevantChange({
        ...baseAssignment(),
        changedSinceLastSeen: true,
        checkInAt: null,
      }),
    ).toBe(true)
  })

  it('NO es relevante si cambió pero ya tiene el inicio registrado (P13.1: el propio fichaje enciende changed_since_last_seen)', () => {
    expect(
      isRelevantChange({
        ...baseAssignment(),
        changedSinceLastSeen: true,
        checkInAt: '2026-09-26T11:05:00Z',
      }),
    ).toBe(false)
  })

  it('no es relevante si no cambió', () => {
    expect(
      isRelevantChange({
        ...baseAssignment(),
        changedSinceLastSeen: false,
        checkInAt: null,
      }),
    ).toBe(false)
  })
})

function baseAssignment() {
  return {
    assignmentId: 'a1',
    shiftId: 'sh1',
    shiftDate: '2026-09-26',
    isToday: true,
    clientId: 'c1',
    clientName: 'Limpia Ya',
    siteId: 'si1',
    siteName: 'Sede Centro',
    siteAddress: null,
    siteContactName: null,
    siteContactPhone: null,
    accessInstructions: null,
    buildingHours: null,
    phoneRestricted: false,
    photosNotAllowed: false,
    restrictionsNotes: null,
    startTime: '08:00:00',
    endTime: '12:00:00',
    startsAt: null,
    endsAt: null,
    status: 'expected' as const,
    shiftStatus: 'scheduled' as const,
    notes: null,
    tasksTotal: 0,
    tasksDone: 0,
    changedSinceLastSeen: false,
    checkInAt: null,
    checkOutAt: null,
  }
}

describe('markChangesSeen', () => {
  it('llama a la RPC sin argumentos', async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null })

    await markChangesSeen()

    expect(rpcMock).toHaveBeenCalledWith('mark_changes_seen')
  })

  it('propaga el error traducido si la RPC falla', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'no se pudo', hint: 'FORBIDDEN' },
    })

    await expect(markChangesSeen()).rejects.toThrow('no se pudo')
  })
})

describe('fetchShiftPeers', () => {
  it('busca los ids de la asignaciones vigentes del turno y después sus datos básicos, sin incluirse a sí mismo', async () => {
    fromMock
      .mockReturnValueOnce(
        makeChainable({
          data: [
            { employee_id: 'yo' },
            { employee_id: 'compa-1' },
            { employee_id: 'compa-1' },
          ],
          error: null,
        }),
      )
      .mockReturnValueOnce(
        makeChainable({
          data: [
            {
              profile_id: 'compa-1',
              first_name: 'Mara',
              last_name: 'Diaz',
              avatar_path: null,
            },
          ],
          error: null,
        }),
      )

    const peers = await fetchShiftPeers('sh1', 'yo')

    expect(fromMock).toHaveBeenNthCalledWith(1, 'assignments')
    expect(fromMock).toHaveBeenNthCalledWith(2, 'v_people_basic')
    expect(peers).toEqual([
      {
        profileId: 'compa-1',
        firstName: 'Mara',
        lastName: 'Diaz',
        avatarPath: null,
      },
    ])
  })

  it('no consulta v_people_basic si no hay compañeros', async () => {
    fromMock.mockReturnValueOnce(
      makeChainable({ data: [{ employee_id: 'yo' }], error: null }),
    )

    const peers = await fetchShiftPeers('sh1', 'yo')

    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(peers).toEqual([])
  })
})
