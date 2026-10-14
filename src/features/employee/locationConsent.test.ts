import { describe, expect, it } from 'vitest'
import {
  consentTimestamp,
  isConsentStale,
  resolveLocationConsent,
} from './locationConsent'

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

describe('consentTimestamp', () => {
  it('sin cambio de texto usa la hora actual', () => {
    const now = new Date('2026-10-14T15:00:00Z')
    expect(consentTimestamp(null, now)).toBe('2026-10-14T15:00:00.000Z')
  })

  it('si el reloj del celular va atrasado, no guarda un consentimiento anterior al texto', () => {
    const now = new Date('2026-10-14T11:00:00Z')
    const at = consentTimestamp('2026-10-14T12:00:00Z', now)
    expect(isConsentStale(at, '2026-10-14T12:00:00Z')).toBe(false)
    expect(at).toBe('2026-10-14T12:00:01.000Z')
  })

  it('con el reloj al día usa la hora actual', () => {
    const now = new Date('2026-10-15T09:00:00Z')
    expect(consentTimestamp('2026-10-14T12:00:00Z', now)).toBe(
      '2026-10-15T09:00:00.000Z',
    )
  })
})
