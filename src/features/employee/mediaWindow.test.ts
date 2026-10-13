import { describe, expect, it } from 'vitest'
import { mediaWindowMessage, mediaWindowState } from './mediaWindow'

const STARTS = '2026-10-13T11:00:00Z'
const ENDS = '2026-10-13T15:00:00Z'

describe('mediaWindowState', () => {
  it('antes del inicio está cerrada por temprano', () => {
    expect(
      mediaWindowState(new Date('2026-10-13T10:59:00Z'), STARTS, ENDS),
    ).toBe('before')
  })

  it('está abierta desde el inicio hasta 2 horas después del fin, inclusive', () => {
    expect(mediaWindowState(new Date(STARTS), STARTS, ENDS)).toBe('open')
    expect(
      mediaWindowState(new Date('2026-10-13T16:59:00Z'), STARTS, ENDS),
    ).toBe('open')
    expect(
      mediaWindowState(new Date('2026-10-13T17:00:00Z'), STARTS, ENDS),
    ).toBe('open')
  })

  it('pasadas las 2 horas del fin se cierra', () => {
    expect(
      mediaWindowState(new Date('2026-10-13T17:01:00Z'), STARTS, ENDS),
    ).toBe('after')
  })

  it('sin horarios no decide: queda abierta y resuelve el servidor', () => {
    expect(mediaWindowState(new Date(), null, null)).toBe('open')
  })
})

describe('mediaWindowMessage', () => {
  it('da el motivo solo cuando está cerrada', () => {
    expect(mediaWindowMessage('open')).toBeUndefined()
    expect(mediaWindowMessage('before')).toMatch(/desde que empiece/)
    expect(mediaWindowMessage('after')).toMatch(/2 horas después del fin/)
  })
})
