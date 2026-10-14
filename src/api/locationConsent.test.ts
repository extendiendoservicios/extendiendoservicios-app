import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `src/api/locationConsent.ts` (módulo B1, B-22): lectura de cuándo cambió el
 * texto del consentimiento y guardado/retiro del consentimiento propio.
 */
const { fromMock, rpcMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { from: fromMock, rpc: rpcMock },
}))

const { fetchLocationConsentInfo, saveLocationConsent, revokeLocationConsent } =
  await import('./locationConsent')

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
})

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
  it('guarda el consentimiento con la RPC, sin mandar hora del dispositivo', async () => {
    rpcMock.mockResolvedValue({ data: '2026-10-14T12:00:01.000Z', error: null })

    const at = await saveLocationConsent()

    expect(rpcMock).toHaveBeenCalledWith('accept_location_consent')
    expect(rpcMock.mock.calls[0]).toHaveLength(1)
    expect(fromMock).not.toHaveBeenCalled()
    expect(at).toBe('2026-10-14T12:00:01.000Z')
  })

  it('retira el consentimiento con la RPC', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null })

    await revokeLocationConsent()

    expect(rpcMock).toHaveBeenCalledWith('revoke_location_consent')
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('propaga el error al guardar', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'boom', code: '500' },
    })

    await expect(saveLocationConsent()).rejects.toThrow()
  })

  it('propaga el error al retirar', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'No encontramos tu perfil.',
        hint: 'PROFILE_NOT_FOUND',
      },
    })

    await expect(revokeLocationConsent()).rejects.toThrow()
  })
})
