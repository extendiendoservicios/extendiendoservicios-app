// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PRESENCE_FILTERS,
  readPresenceFilters,
  writePresenceFilters,
} from './presencePreference'

describe('preferencia del mapa del Resumen (OF-13)', () => {
  beforeEach(() => window.localStorage.clear())

  it('por omisión: por comenzar, en curso y coordinadores prendidos; finalizados apagado', () => {
    expect(readPresenceFilters('u1')).toEqual({
      showUpcoming: true,
      showInProgress: true,
      showFinished: false,
      showCoordinators: true,
    })
    expect(DEFAULT_PRESENCE_FILTERS.showFinished).toBe(false)
  })

  it('se recuerda por persona', () => {
    writePresenceFilters('u1', {
      ...DEFAULT_PRESENCE_FILTERS,
      showFinished: true,
    })
    expect(readPresenceFilters('u1').showFinished).toBe(true)
    expect(readPresenceFilters('u2').showFinished).toBe(false)
  })

  it('un valor roto vuelve a los valores por omisión', () => {
    window.localStorage.setItem('es.presenceMap.u1', '{no es json')
    expect(readPresenceFilters('u1')).toEqual(DEFAULT_PRESENCE_FILTERS)
  })
})
