import { describe, expect, it } from 'vitest'
import { version as packageVersion } from '../../package.json'
import { APP_VERSION } from './appVersion'

describe('APP_VERSION', () => {
  it('coincide con la versión de package.json (ADR-020)', () => {
    expect(APP_VERSION).toBe(packageVersion)
  })
})
