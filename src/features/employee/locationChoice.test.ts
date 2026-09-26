import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasDeclinedLocation, rememberLocationDeclined } from './locationChoice'

describe('locationChoice', () => {
  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('recuerda la negativa por persona', () => {
    expect(hasDeclinedLocation('u1')).toBe(false)
    rememberLocationDeclined('u1')
    expect(hasDeclinedLocation('u1')).toBe(true)
    expect(hasDeclinedLocation('u2')).toBe(false)
  })

  it('sin usuario no recuerda nada', () => {
    rememberLocationDeclined(null)
    expect(hasDeclinedLocation(null)).toBe(false)
  })

  it('si el almacenamiento falla, no rompe y vuelve a preguntar', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    expect(() => rememberLocationDeclined('u1')).not.toThrow()
    expect(hasDeclinedLocation('u1')).toBe(false)
  })
})
