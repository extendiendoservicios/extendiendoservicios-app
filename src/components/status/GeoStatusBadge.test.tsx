import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GeoStatusBadge } from './GeoStatusBadge'

describe('GeoStatusBadge', () => {
  it.each([
    [{ status: 'valid' as const }, 'Validado', 'success'],
    [{ status: 'outside' as const }, 'Fuera de zona', 'danger'],
    [{ status: 'unvalidated' as const }, 'Sin validar', 'neutral'],
    [
      { status: 'unvalidated' as const, reason: 'no_location' as const },
      'Sin validar (sin ubicación)',
      'neutral',
    ],
    [
      {
        status: 'unvalidated' as const,
        reason: 'site_without_coords' as const,
      },
      'Sin validar (sede sin coordenadas)',
      'neutral',
    ],
    [
      { status: 'unvalidated' as const, reason: 'admin_record' as const },
      'Sin validar (registrado por la administración)',
      'neutral',
    ],
    [
      { status: 'unvalidated' as const, reason: 'low_accuracy' as const },
      'Sin validar (precisión insuficiente)',
      'neutral',
    ],
    [
      { status: 'outside' as const, corrected: true },
      'Validado (corregido)',
      'success',
    ],
  ])('%j -> %s', (props, label, variant) => {
    render(<GeoStatusBadge {...props} />)
    const badge = screen.getByText(label)
    expect(badge).toHaveAttribute('data-variant', variant)
  })

  it('muestra la distancia si se pide', () => {
    render(<GeoStatusBadge status="outside" distanceM={350} showDistance />)
    expect(screen.getByText('Fuera de zona · 350 m')).toBeInTheDocument()
  })

  it('puede ocultar el motivo', () => {
    render(
      <GeoStatusBadge
        status="unvalidated"
        reason="no_location"
        showReason={false}
      />,
    )
    expect(screen.getByText('Sin validar')).toBeInTheDocument()
  })
})
