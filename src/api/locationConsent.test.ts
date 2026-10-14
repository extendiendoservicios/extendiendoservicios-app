import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `src/api/locationConsent.ts` (módulo B1, B-22): lectura de cuándo cambió el
 * texto del consentimiento y guardado/retiro del consentimiento propio.
 */
const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }))

const { fetchLocationConsentInfo, saveLocationConsent, revokeLocationConsent } =
  await import('./locationConsent')

beforeEach(() => fromMock.mockReset())

describe('fetchLocationConsentInfo', () => {
  it('lee location_consent_updated_at de company_settings', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { location_consent_updated_at: '2026-10-14T12:00:00Z' },
      error: null,
    })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    fromMock.mockReturnValue({ select })

    const info = await fetchLocationConsentInfo()

    expect(fromMock).toHaveBeenCalledWith('company_settings')
    expect(select).toHaveBeenCalledWith('location_consent_updated_at')
    expect(info).toEqual({ consentUpdatedAt: '2026-10-14T12:00:00Z' })
  })

  it('devuelve null si el texto nunca cambió', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { location_consent_updated_at: null },
      error: null,
    })
    fromMock.mockReturnValue({ select: () => ({ maybeSingle }) })

    expect(await fetchLocationConsentInfo()).toEqual({ consentUpdatedAt: null })
  })

  it('propaga el error', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'boom', code: '500' },
    })
    fromMock.mockReturnValue({ select: () => ({ maybeSingle }) })

    await expect(fetchLocationConsentInfo()).rejects.toThrow()
  })
})

describe('saveLocationConsent / revokeLocationConsent', () => {
  it('guarda el consentimiento propio con el instante dado', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({ eq })
    fromMock.mockReturnValue({ update })

    await saveLocationConsent('u1', '2026-10-14T12:00:01.000Z')

    expect(fromMock).toHaveBeenCalledWith('profiles')
    expect(update).toHaveBeenCalledWith({
      location_consent_at: '2026-10-14T12:00:01.000Z',
    })
    expect(eq).toHaveBeenCalledWith('id', 'u1')
  })

  it('retira el consentimiento propio', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({ eq })
    fromMock.mockReturnValue({ update })

    await revokeLocationConsent('u1')

    expect(update).toHaveBeenCalledWith({ location_consent_at: null })
  })

  it('propaga el error al guardar', async () => {
    const eq = vi
      .fn()
      .mockResolvedValue({ error: { message: 'boom', code: '500' } })
    fromMock.mockReturnValue({ update: () => ({ eq }) })

    await expect(saveLocationConsent('u1', 'x')).rejects.toThrow()
  })
})
