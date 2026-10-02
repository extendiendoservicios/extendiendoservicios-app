import { afterEach, describe, expect, it } from 'vitest'
import {
  dismissInstallBanner,
  isInstallBannerDismissed,
} from './installBannerDismiss'

afterEach(() => {
  window.localStorage.clear()
})

describe('isInstallBannerDismissed / dismissInstallBanner', () => {
  it('no está descartado si nunca se guardó nada', () => {
    expect(isInstallBannerDismissed(new Date())).toBe(false)
  })

  it('queda descartado justo después de cerrarlo', () => {
    const now = new Date('2026-09-26T12:00:00.000Z')
    dismissInstallBanner(now)
    expect(isInstallBannerDismissed(now)).toBe(true)
  })

  it('vuelve a ofrecerse pasados los siete días', () => {
    const dismissedAt = new Date('2026-09-19T12:00:00.000Z')
    dismissInstallBanner(dismissedAt)

    const stillWithin = new Date('2026-09-25T12:00:00.000Z')
    expect(isInstallBannerDismissed(stillWithin)).toBe(true)

    const afterWindow = new Date('2026-09-27T00:00:00.000Z')
    expect(isInstallBannerDismissed(afterWindow)).toBe(false)
  })
})
