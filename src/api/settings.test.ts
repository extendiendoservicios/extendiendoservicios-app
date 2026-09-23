import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiError } from './errors'

/**
 * `src/api/settings.ts` (USERS-012 a USERS-016): mismo patrón sin red que
 * `users.test.ts` -- se mockea `@/lib/supabase` entero.
 */

interface PostgrestResult<T> {
  data: T | null
  error: { message: string; code?: string; hint?: string } | null
}

const { fromMock, storageFromMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  storageFromMock: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: fromMock,
    storage: { from: storageFromMock },
  },
}))

const {
  fetchCompanySettings,
  updateCompanySettings,
  validateLogoFile,
  createHoliday,
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
})

describe('fetchCompanySettings', () => {
  it('mapea la fila singleton a camelCase', async () => {
    const result: PostgrestResult<{
      name: string | null
      logo_path: string | null
      support_phone: string | null
      location_consent_text: string | null
      updated_by: string | null
      updated_at: string
    }> = {
      data: {
        name: 'Extendiendo Servicios',
        logo_path: 'logo.png',
        support_phone: '11-5555-5555',
        location_consent_text: 'Texto legal.',
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
    expect(validateLogoFile(file)).toMatch(/PNG, JPEG, SVG o WebP/)
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

describe('createHoliday', () => {
  it('traduce una fecha duplicada (23505) a un mensaje en español', async () => {
    const insertMock = vi.fn(() =>
      Promise.resolve({
        error: {
          message: 'duplicate key value violates unique constraint',
          code: '23505',
        },
      }),
    )
    fromMock.mockReturnValue({ insert: insertMock })

    await expect(
      createHoliday({
        holidayDate: '2026-01-01',
        name: 'Año Nuevo',
        createdBy: 'owner-1',
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(isApiError(error)).toBe(true)
      expect((error as Error).message).toMatch(/Ya existe/)
      return true
    })
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
  it('no duplica fechas activas, reactiva las de baja y crea el resto', async () => {
    const year = 2026
    const national = computeNationalHolidays(year)
    const alreadyActive = national.at(0)
    const alreadyDeleted = national.at(1)
    if (!alreadyActive || !alreadyDeleted) {
      throw new Error(
        'computeNationalHolidays debería devolver al menos dos feriados.',
      )
    }

    // `fetchHolidays` (select) devuelve dos filas existentes: una activa
    // (se saltea) y una de baja (se reactiva); el resto no existe (se crea).
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

    const insertMock = vi.fn(() => Promise.resolve({ error: null }))
    const updateEqMock = vi.fn(() => Promise.resolve({ error: null }))
    const updateMock = vi.fn(() => ({ eq: updateEqMock }))

    fromMock.mockImplementation(() => ({
      select: () => ({
        gte: () => ({
          lte: () => ({
            order: () => Promise.resolve({ data: existingRows, error: null }),
          }),
        }),
      }),
      insert: insertMock,
      update: updateMock,
    }))

    const result = await loadNationalHolidays(year, 'owner-1')

    expect(result.skipped).toBe(1)
    expect(result.reactivated).toBe(1)
    expect(result.created).toBe(national.length - 2)
    // La reactivación reusa la fila existente (mismo id), no inserta una nueva.
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: null }),
    )
    expect(updateEqMock).toHaveBeenCalledWith('id', 'h-deleted')
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
        createdAt: '2026-09-01T12:00:00Z',
      },
    ])
  })
})
