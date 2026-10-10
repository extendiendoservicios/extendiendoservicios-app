import { describe, expect, it } from 'vitest'
import { isChunkLoadError } from './RouteErrorPage'

describe('isChunkLoadError', () => {
  it('reconoce el error de Chrome', () => {
    expect(
      isChunkLoadError(
        new TypeError(
          'Failed to fetch dynamically imported module: https://dev.extendiendoservicios.com/assets/Dashboard-DeOyKfKR.js',
        ),
      ),
    ).toBe(true)
  })

  it('reconoce el error de Safari', () => {
    expect(
      isChunkLoadError(new TypeError('Importing a module script failed.')),
    ).toBe(true)
  })

  it('no confunde otros errores', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of null'))).toBe(
      false,
    )
    expect(isChunkLoadError(null)).toBe(false)
  })
})
