import * as Sentry from '@sentry/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_VERSION } from './appVersion'
import { initSentry } from './sentry'

vi.mock('@sentry/react', () => ({ init: vi.fn() }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.mocked(Sentry.init).mockClear()
})

describe('initSentry', () => {
  it('no inicializa nada si falta VITE_SENTRY_DSN (INFRA-021)', () => {
    vi.stubEnv('VITE_SENTRY_DSN', '')

    initSentry()

    expect(Sentry.init).not.toHaveBeenCalled()
  })

  it('inicializa con el DSN, el entorno y la versión cuando VITE_SENTRY_DSN existe', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://ejemplo@o0.ingest.de.sentry.io/0')
    vi.stubEnv('VITE_APP_ENV', 'staging')

    initSentry()

    expect(Sentry.init).toHaveBeenCalledWith({
      dsn: 'https://ejemplo@o0.ingest.de.sentry.io/0',
      environment: 'staging',
      release: APP_VERSION,
      sendDefaultPii: false,
    })
  })
})
