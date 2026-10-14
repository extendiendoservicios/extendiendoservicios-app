import { describe, expect, it } from 'vitest'
import { isConsentStale, resolveLocationConsent } from './locationConsent'

/** Re-consentimiento (B-22): se vuelve a mostrar el texto si cambió después de que la persona lo aceptara. */
describe('isConsentStale', () => {
  it('el texto cambió después del consentimiento', () => {
    expect(isConsentStale('2026-09-01T10:00:00Z', '2026-10-14T12:00:00Z')).toBe(
      true,
    )
  })

  it('el consentimiento es posterior al cambio del texto', () => {
    expect(isConsentStale('2026-10-15T10:00:00Z', '2026-10-14T12:00:00Z')).toBe(
      false,
    )
  })

  it('sin cambio de texto registrado, nunca está vencido', () => {
    expect(isConsentStale('2026-09-01T10:00:00Z', null)).toBe(false)
  })

  it('sin consentimiento no hay nada que vencer', () => {
    expect(isConsentStale(null, '2026-10-14T12:00:00Z')).toBe(false)
  })

  it('fechas inválidas no bloquean', () => {
    expect(isConsentStale('no-es-fecha', '2026-10-14T12:00:00Z')).toBe(false)
  })
})

describe('resolveLocationConsent', () => {
  it('consentimiento vigente: granted', () => {
    expect(
      resolveLocationConsent({
        consentAt: '2026-10-15T10:00:00Z',
        consentUpdatedAt: '2026-10-14T12:00:00Z',
        declined: false,
      }),
    ).toBe('granted')
  })

  it('texto nuevo después del consentimiento: vuelve a pedirlo', () => {
    expect(
      resolveLocationConsent({
        consentAt: '2026-09-01T10:00:00Z',
        consentUpdatedAt: '2026-10-14T12:00:00Z',
        declined: false,
      }),
    ).toBe('needs-consent')
  })

  it('el texto nuevo gana aunque haya una negativa vieja recordada', () => {
    expect(
      resolveLocationConsent({
        consentAt: '2026-09-01T10:00:00Z',
        consentUpdatedAt: '2026-10-14T12:00:00Z',
        declined: true,
      }),
    ).toBe('needs-consent')
  })

  it('nunca decidió: pide el consentimiento', () => {
    expect(
      resolveLocationConsent({
        consentAt: null,
        consentUpdatedAt: null,
        declined: false,
      }),
    ).toBe('needs-consent')
  })

  it('rechazó seguir con ubicación: declined, aunque el texto cambie', () => {
    expect(
      resolveLocationConsent({
        consentAt: null,
        consentUpdatedAt: '2026-10-14T12:00:00Z',
        declined: true,
      }),
    ).toBe('declined')
  })
})
