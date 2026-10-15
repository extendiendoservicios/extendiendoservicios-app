import { describe, expect, it } from 'vitest'
import { circleColor, circlePathOptions } from './circleStyles'

describe('circlePathOptions', () => {
  it('usa color y fillColor explícitos, distintos por variante', () => {
    const ok = circlePathOptions('success')
    const mal = circlePathOptions('danger')
    expect(ok.color).toBe('#2f9e6b')
    expect(ok.fillColor).toBe(ok.color)
    expect(mal.color).toBe('#ce4b52')
    expect(mal.color).not.toBe(ok.color)
  })

  it('lee el token CSS cuando está definido', () => {
    document.documentElement.style.setProperty('--success', '#00aa00')
    expect(circleColor('success')).toBe('#00aa00')
    document.documentElement.style.removeProperty('--success')
  })

  it('respeta opacidad, grosor y trazo', () => {
    const o = circlePathOptions('info', {
      fillOpacity: 0.12,
      weight: 1.5,
      dashArray: '4 4',
    })
    expect(o).toMatchObject({
      fillOpacity: 0.12,
      weight: 1.5,
      dashArray: '4 4',
    })
  })
})
