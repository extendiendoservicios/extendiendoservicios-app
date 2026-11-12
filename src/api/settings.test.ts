import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `src/api/settings.ts` (USERS-012 a USERS-016): mismo patrón sin red que
 * `users.test.ts` -- se mockea `@/lib/supabase` entero.
 */

interface PostgrestResult<T> {
  data: T | null
  error: { message: string; code?: string; hint?: string } | null
}

const { fromMock, storageFromMock, rpcMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  storageFromMock: vi.fn(),
  rpcMock: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
    storage: { from: storageFromMock },
  },
}))

const {
  fetchCompanySettings,
  updateCompanySettings,
  validateLogoFile,
  createHoliday,
  fetchHolidayShiftConflicts,
  removeHolidayShifts,
  deactivateHoliday,
  loadNationalHolidays,
  fetchRatingCriteria,
  closeRatingCriterion,
  fetchSecurityEvents,
} = await import('./settings')
const { computeNationalHolidays } =
  await import('@/features/settings/nationalHolidays')

beforeEach(() => {
  fromMock.mockReset()
  storageFromMock.mockReset()
  rpcMock.mockReset()
})

describe('fetchCompanySettings', () => {
  it('mapea la fila singleton a camelCase', async () => {
    const result: PostgrestResult<{
      name: string | null
      logo_path: string | null
      support_phone: string | null
      location_consent_text: string | null
      location_consent_updated_at: string | null
      updated_by: string | null
      updated_at: string
    }> = {
      data: {
        name: 'Extendiendo Servicios',
        logo_path: 'logo.png',
        support_phone: '11-5555-5555',
        location_consent_text: 'Texto legal.',
        location_consent_updated_at: '2026-10-14T12:00:00Z',
        updated_by: 'owner-1',
        updated_at: '2026-09-01T00:00:00Z',
      },
      error: null,
    }
    fromMock.mockReturnValue({
      select: () => ({ eq: () => ({ single: () => Promise.resolve(result) }) }),
    })

    const settings = await fetchCompanySettings()

    expect(settings).toEqual({
      name: 'Extendiendo Servicios',
      logoPath: 'logo.png',
      supportPhone: '11-5555-5555',
      locationConsentText: 'Texto legal.',
      locationConsentUpdatedAt: '2026-10-14T12:00:00Z',
      updatedBy: 'owner-1',
      updatedAt: '2026-09-01T00:00:00Z',
    })
  })
})

describe('updateCompanySettings', () => {
  it('actualiza solo los campos provistos, más updated_by', async () => {
    const eqMock = vi.fn(() => Promise.resolve({ error: null }))
    const updateMock = vi.fn(() => ({ eq: eqMock }))
    fromMock.mockReturnValue({ update: updateMock })

    await updateCompanySettings({ name: 'Nuevo nombre', updatedBy: 'owner-1' })

    expect(updateMock).toHaveBeenCalledWith({
      updated_by: 'owner-1',
      name: 'Nuevo nombre',
    })
    expect(eqMock).toHaveBeenCalledWith('id', 1)
  })
})

describe('validateLogoFile', () => {
  it('rechaza un tipo MIME no admitido', () => {
    const file = new File(['x'], 'logo.gif', { type: 'image/gif' })
    expect(validateLogoFile(file)).toMatch(/PNG, JPEG o WebP/)
  })

  it('rechaza un archivo de más de 1 MB', () => {
    const bigContent = new Uint8Array(1_048_577)
    const file = new File([bigContent], 'logo.png', { type: 'image/png' })
    expect(validateLogoFile(file)).toMatch(/1 MB/)
  })

  it('acepta un PNG chico', () => {
    const file = new File(['x'], 'logo.png', { type: 'image/png' })
    expect(validateLogoFile(file)).toBeNull()
  })
})

describe('createHoliday (upsert_holiday, OF-19)', () => {
  it('crea o reactiva con la RPC y devuelve la acción', async () => {
    rpcMock.mockResolvedValue({
      data: {
        holiday: {
          id: 'h1',
          holiday_date: '2026-11-11',
          name: 'VI',
          deleted_at: null,
        },
        action: 'reactivated',
      },
      error: null,
    })

    const result = await createHoliday({
      holidayDate: '2026-11-11',
      name: 'VI',
    })

    expect(rpcMock).toHaveBeenCalledWith('upsert_holiday', {
      p_date: '2026-11-11',
      p_name: 'VI',
    })
    expect(result.action).toBe('reactivated')
    expect(result.holiday).toEqual({
      id: 'h1',
      holidayDate: '2026-11-11',
      name: 'VI',
      deletedAt: null,
    })
  })

  it('muestra el mensaje del servidor', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'Indicá el nombre del feriado.',
        code: 'P0001',
        hint: 'HOLIDAY_NAME_REQUIRED',
      },
    })
    await expect(
      createHoliday({ holidayDate: '2026-11-11', name: ' ' }),
    ).rejects.toMatchObject({
      message: 'Indicá el nombre del feriado.',
      hint: 'HOLIDAY_NAME_REQUIRED',
    })
  })
})

describe('holiday_shift_conflicts y remove_holiday_shifts (OF-19b)', () => {
  it('mapea los turnos en conflicto', async () => {
    rpcMock.mockResolvedValue({
      data: {
        date: '2026-11-11',
        is_holiday: true,
        deletable_count: 1,
        with_history_count: 0,
        shifts: [
          {
            shift_id: 's1',
            shift_date: '2026-11-11',
            start_time: '08:00:00',
            end_time: '12:00:00',
            status: 'assigned',
            service_id: 'sv1',
            service_name: 'Limpieza',
            client_name: 'Cliente',
            site_name: 'Sede',
            assignments_count: 2,
            has_history: false,
          },
        ],
      },
      error: null,
    })
    const result = await fetchHolidayShiftConflicts('2026-11-11')
    expect(rpcMock).toHaveBeenCalledWith('holiday_shift_conflicts', {
      p_date: '2026-11-11',
    })
    expect(result.deletableCount).toBe(1)
    expect(result.shifts[0]).toMatchObject({
      shiftId: 's1',
      serviceName: 'Limpieza',
      assignmentsCount: 2,
      hasHistory: false,
    })
  })

  it('informa lo borrado y lo salteado', async () => {
    rpcMock.mockResolvedValue({
      data: {
        date: '2026-11-11',
        deleted: { shifts: 2, assignments: 3, tasks: 0, observations: 0 },
        skipped_count: 1,
        skipped: [
          {
            shift_id: 's3',
            shift_date: '2026-11-11',
            code: 'HAS_HISTORY',
            message: 'Tiene fichajes.',
          },
        ],
      },
      error: null,
    })
    const result = await removeHolidayShifts('2026-11-11')
    expect(rpcMock).toHaveBeenCalledWith('remove_holiday_shifts', {
      p_date: '2026-11-11',
    })
    expect(result.deletedShifts).toBe(2)
    expect(result.skippedCount).toBe(1)
    expect(result.skipped[0]?.code).toBe('HAS_HISTORY')
  })
})

describe('deactivateHoliday', () => {
  it('pone deleted_at, no borra la fila', async () => {
    const eqMock = vi.fn(() => Promise.resolve({ error: null }))
    const updateMock = vi.fn((_patch: { deleted_at: string }) => ({
      eq: eqMock,
    }))
    fromMock.mockReturnValue({ update: updateMock })

    await deactivateHoliday('holiday-1', 'owner-1')

    const patch = updateMock.mock.calls[0]?.[0]
    expect(patch?.deleted_at).toBeTruthy()
    expect(eqMock).toHaveBeenCalledWith('id', 'holiday-1')
  })
})

describe('loadNationalHolidays', () => {
  it('saltea las fechas vigentes y carga o reactiva el resto con upsert_holiday', async () => {
    const year = 2026
    const national = computeNationalHolidays(year)
    const alreadyActive = national.at(0)
    const alreadyDeleted = national.at(1)
    if (!alreadyActive || !alreadyDeleted) {
      throw new Error(
        'computeNationalHolidays debería devolver al menos dos feriados.',
      )
    }

    const existingRows = [
      {
        id: 'h-active',
        holiday_date: alreadyActive.date,
        name: 'Nombre viejo',
        deleted_at: null,
      },
      {
        id: 'h-deleted',
        holiday_date: alreadyDeleted.date,
        name: 'Nombre viejo',
        deleted_at: '2025-01-01T00:00:00Z',
      },
    ]
    fromMock.mockImplementation(() => ({
      select: () => ({
        gte: () => ({
          lte: () => ({
            order: () => Promise.resolve({ data: existingRows, error: null }),
          }),
        }),
      }),
    }))
    rpcMock.mockImplementation((_name: string, args: { p_date: string }) =>
      Promise.resolve({
        data: {
          holiday: {
            id: 'x',
            holiday_date: args.p_date,
            name: 'n',
            deleted_at: null,
          },
          action:
            args.p_date === alreadyDeleted.date ? 'reactivated' : 'created',
        },
        error: null,
      }),
    )

    const result = await loadNationalHolidays(year)

    expect(result.skipped).toBe(1)
    expect(result.reactivated).toBe(1)
    expect(result.created).toBe(national.length - 2)
    expect(rpcMock).toHaveBeenCalledTimes(national.length - 1)
    expect(rpcMock).not.toHaveBeenCalledWith(
      'upsert_holiday',
      expect.objectContaining({ p_date: alreadyActive.date }),
    )
  })
})

describe('fetchRatingCriteria', () => {
  it('mapea la guía completa (vigente y cerrada)', async () => {
    const result: PostgrestResult<
      {
        id: string
        position: number
        title: string
        description: string | null
        valid_from: string
        valid_to: string | null
      }[]
    > = {
      data: [
        {
          id: 'c1',
          position: 0,
          title: 'Puntualidad',
          description: null,
          valid_from: '2026-01-01',
          valid_to: null,
        },
      ],
      error: null,
    }
    fromMock.mockReturnValue({
      select: () => ({ order: () => Promise.resolve(result) }),
    })

    const criteria = await fetchRatingCriteria()

    expect(criteria).toEqual([
      {
        id: 'c1',
        position: 0,
        title: 'Puntualidad',
        description: null,
        validFrom: '2026-01-01',
        validTo: null,
      },
    ])
  })
})

describe('closeRatingCriterion', () => {
  it('pone valid_to en la fecha de hoy', async () => {
    const eqMock = vi.fn(() => Promise.resolve({ error: null }))
    const updateMock = vi.fn((_patch: { valid_to: string }) => ({ eq: eqMock }))
    fromMock.mockReturnValue({ update: updateMock })

    await closeRatingCriterion('c1', 'owner-1')

    const patch = updateMock.mock.calls[0]?.[0]
    expect(patch?.valid_to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(eqMock).toHaveBeenCalledWith('id', 'c1')
  })
})

describe('fetchSecurityEvents', () => {
  it('arma el nombre de actor y destinatario a partir del embed de profiles', async () => {
    const result = {
      data: [
        {
          id: 'e1',
          event_type: 'user_deactivated',
          actor_id: 'owner-1',
          target_id: 'emp-1',
          created_at: '2026-09-01T12:00:00Z',
          actor: { first_name: 'Andrea', last_name: 'Ríos' },
          target: { first_name: 'Beto', last_name: 'Ruiz' },
        },
      ],
      error: null,
    }
    const query = {
      eq: vi.fn(() => query),
      gte: vi.fn(() => query),
      lte: vi.fn(() => query),
      then: (resolve: (value: typeof result) => void) => resolve(result),
    }
    fromMock.mockReturnValue({
      select: () => ({ order: () => ({ limit: () => query }) }),
    })

    const events = await fetchSecurityEvents({ eventType: 'user_deactivated' })

    expect(events).toEqual([
      {
        id: 'e1',
        eventType: 'user_deactivated',
        actorId: 'owner-1',
        actorName: 'Andrea Ríos',
        targetId: 'emp-1',
        targetName: 'Beto Ruiz',
        details: null,
        createdAt: '2026-09-01T12:00:00Z',
      },
    ])
  })

  it('P27.7: trae el detalle de un registro eliminado', async () => {
    const result = {
      data: [
        {
          id: 'e2',
          event_type: 'record_deleted',
          actor_id: 'owner-1',
          target_id: null,
          created_at: '2026-11-02T12:00:00Z',
          details: { entity: 'client', name: 'ACME', record_id: 'c1' },
          actor: { first_name: 'Andrea', last_name: 'Ríos' },
          target: null,
        },
      ],
      error: null,
    }
    const query = {
      then: (resolve: (value: typeof result) => void) => resolve(result),
    }
    fromMock.mockReturnValue({
      select: () => ({ order: () => ({ limit: () => query }) }),
    })

    const [event] = await fetchSecurityEvents()

    expect(event?.details).toEqual({
      entity: 'client',
      name: 'ACME',
      record_id: 'c1',
    })
  })
})
