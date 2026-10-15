import { describe, expect, it } from 'vitest'
import { createMarkerIcon, SITE_PIN_HEIGHT, SITE_PIN_WIDTH } from './markerIcon'

const html = (icon: ReturnType<typeof createMarkerIcon>) =>
  (icon.options.html as string | undefined) ?? ''

describe('createMarkerIcon', () => {
  it('el pin de sede lleva el isotipo de la marca, decorativo', () => {
    const icon = createMarkerIcon('primary', 'site')
    const markup = html(icon)
    expect(markup).toContain('/icons/isotipo_blanco_34px@2x.png')
    expect(markup).toContain('/icons/isotipo_blanco_34px@3x.png 3x')
    expect(markup).toContain('alt=""')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('bg-primary')
    expect(markup).toContain('border-white')
  })

  it('el pin de sede mide 30×38 y ancla en la punta', () => {
    const icon = createMarkerIcon('primary', 'site')
    expect(icon.options.iconSize).toEqual([SITE_PIN_WIDTH, SITE_PIN_HEIGHT])
    expect(SITE_PIN_WIDTH).toBe(30)
    expect(SITE_PIN_HEIGHT).toBe(38)
    expect(icon.options.iconAnchor).toEqual([15, 37])
    const popup = icon.options.popupAnchor as [number, number]
    expect(popup[1]).toBeLessThan(-30)
  })

  it('una sede inactiva usa el gris, no el color de marca', () => {
    const markup = html(createMarkerIcon('neutral', 'site'))
    expect(markup).toContain('bg-text-3')
    expect(markup).not.toContain('bg-primary')
  })

  it('las personas no llevan imagen y siguen ancladas al centro', () => {
    const dot = createMarkerIcon('success', 'dot')
    expect(html(dot)).not.toContain('<img')
    expect(dot.options.iconAnchor).toEqual([13, 13])
  })
})
