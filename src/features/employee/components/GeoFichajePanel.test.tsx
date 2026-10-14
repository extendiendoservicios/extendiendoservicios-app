import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GeoFichajePanel } from './GeoFichajePanel'
import { buildLiveGeoView, type LiveGeoInput } from '../liveGeo'
import type { GeoFichaje } from '../useGeoFichaje'

// Leaflet no corre en jsdom: el mini mapa se reemplaza por un marcador que
// deja ver qué recibe.
vi.mock('@/components/map', () => ({
  GeofenceMiniMap: (props: {
    status: string | null
    position: { accuracyM: number } | null
    site: { radiusM: number }
  }) => (
    <div
      data-testid="mini-map"
      data-status={String(props.status)}
      data-radius={props.site.radiusM}
      data-accuracy={props.position?.accuracyM ?? ''}
    />
  ),
}))

const SITE = { lat: -34.6037, lng: -58.3816, name: 'Sede Centro' }

function fichaje(
  input: Partial<LiveGeoInput>,
  overrides: Partial<GeoFichaje> = {},
): GeoFichaje {
  const position = input.position ?? null
  const view = buildLiveGeoView({
    enabled: true,
    state: 'ready',
    position,
    site: SITE,
    radiusM: 150,
    maxAccuracyM: 150,
    wait: 'idle',
    ...input,
  })
  return {
    live: {
      state: 'ready',
      position: position ? { ...position, timestamp: 0 } : null,
      latest: null,
      accuracyM: position?.accuracyM ?? null,
      elapsedMs: 0,
      wait: 'idle',
      waitRemainingMs: 0,
      startWait: vi.fn(),
    },
    view,
    reasonText: '',
    setReasonText: vi.fn(),
    payload: { coords: view.coords, outsideReason: null },
    ...overrides,
  }
}

describe('GeoFichajePanel', () => {
  it('dentro de la zona: mapa verde y precisión en vivo', () => {
    render(
      <GeoFichajePanel
        fichaje={fichaje({
          position: { lat: SITE.lat, lng: SITE.lng, accuracyM: 35 },
        })}
        site={SITE}
      />,
    )
    const map = screen.getByTestId('mini-map')
    expect(map).toHaveAttribute('data-status', 'valid')
    expect(map).toHaveAttribute('data-radius', '150')
    expect(screen.getByTestId('geo-accuracy')).toHaveTextContent(
      'Precisión: 35 m',
    )
    expect(
      screen.queryByRole('button', { name: 'Esperar mejor señal' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText(/por qué estás fuera de la zona/i),
    ).not.toBeInTheDocument()
  })

  it('fuera de la zona: mapa rojo y campo opcional del motivo (máx. 300)', () => {
    const f = fichaje({
      position: { lat: -34.5937, lng: SITE.lng, accuracyM: 20 },
    })
    render(<GeoFichajePanel fichaje={f} site={SITE} />)

    expect(screen.getByTestId('mini-map')).toHaveAttribute(
      'data-status',
      'outside',
    )
    const field = screen.getByLabelText(/por qué estás fuera de la zona/i)
    expect(field).toHaveAttribute('maxlength', '300')
    fireEvent.change(field, { target: { value: 'No anda el GPS' } })
    expect(f.setReasonText).toHaveBeenCalledWith('No anda el GPS')
  })

  it('precisión peor que el radio: ofrece «Esperar mejor señal» y arranca la espera', () => {
    const f = fichaje({
      state: 'improving',
      radiusM: 100,
      position: { lat: SITE.lat, lng: SITE.lng, accuracyM: 180 },
    })
    render(<GeoFichajePanel fichaje={f} site={SITE} />)

    fireEvent.click(screen.getByRole('button', { name: 'Esperar mejor señal' }))
    expect(f.live.startWait).toHaveBeenCalled()
  })

  it('durante la espera muestra la cuenta regresiva', () => {
    const f = fichaje({
      state: 'improving',
      radiusM: 100,
      wait: 'running',
      position: { lat: SITE.lat, lng: SITE.lng, accuracyM: 180 },
    })
    f.live.waitRemainingMs = 24_300
    render(<GeoFichajePanel fichaje={f} site={SITE} />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'Esperando mejor señal… 25 s',
    )
    expect(
      screen.queryByRole('button', { name: 'Esperar mejor señal' }),
    ).not.toBeInTheDocument()
  })

  it('sin consentimiento no hay mapa y avisa que queda sin validar', () => {
    render(
      <GeoFichajePanel
        fichaje={fichaje({ enabled: false, state: 'idle' })}
        site={SITE}
      />,
    )
    expect(screen.queryByTestId('mini-map')).not.toBeInTheDocument()
    expect(screen.getByTestId('geo-message')).toHaveTextContent(
      /queda sin validar/,
    )
  })

  it('sede sin coordenadas: sin mapa y con aviso', () => {
    render(
      <GeoFichajePanel
        fichaje={fichaje({
          site: null,
          position: { lat: SITE.lat, lng: SITE.lng, accuracyM: 20 },
        })}
        site={null}
      />,
    )
    expect(screen.queryByTestId('mini-map')).not.toBeInTheDocument()
    expect(screen.getByTestId('geo-message')).toHaveTextContent(
      /no tiene ubicación cargada/,
    )
  })

  it('nunca escribe las coordenadas en pantalla (B-40)', () => {
    const { container } = render(
      <GeoFichajePanel
        fichaje={fichaje({
          position: { lat: -34.6037, lng: -58.3816, accuracyM: 12 },
        })}
        site={SITE}
      />,
    )
    expect(container.textContent).not.toMatch(/34\.60|58\.38/)
  })
})
