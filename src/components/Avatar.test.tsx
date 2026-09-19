import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Avatar, getAvatarColorKey, getInitials } from './Avatar'

describe('getAvatarColorKey', () => {
  it('es estable: el mismo id siempre da el mismo color', () => {
    const first = getAvatarColorKey('11111111-1111-1111-1111-111111111111')
    const second = getAvatarColorKey('11111111-1111-1111-1111-111111111111')
    expect(second).toBe(first)
  })

  it('devuelve uno de los seis colores fijos (a..f)', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'maria', 'juan', 'sofia']
    for (const id of ids) {
      expect(['a', 'b', 'c', 'd', 'e', 'f']).toContain(getAvatarColorKey(id))
    }
  })

  it('distingue ids distintos (buena distribución en un lote chico)', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `empleado-${i}`)
    const colors = new Set(ids.map(getAvatarColorKey))
    // No exige que las 12 caigan en 6 baldes distintos, pero sí que no
    // colapsen todas en uno solo (eso indicaría un hash roto).
    expect(colors.size).toBeGreaterThan(1)
  })
})

describe('getInitials', () => {
  it('toma la primera letra del primer y el último nombre', () => {
    expect(getInitials('María Gómez')).toBe('MG')
    expect(getInitials('Juan Pérez')).toBe('JP')
  })

  it('con un nombre compuesto usa el primero y el último', () => {
    expect(getInitials('Ana María Sosa Bravo')).toBe('AB')
  })

  it('con un solo nombre usa sus dos primeras letras', () => {
    expect(getInitials('Sofía')).toBe('SO')
  })

  it('con una cadena vacía devuelve vacío', () => {
    expect(getInitials('   ')).toBe('')
  })
})

describe('Avatar', () => {
  it('sin foto, muestra las iniciales como fallback', () => {
    render(<Avatar id="emp-1" name="María Gómez" />)
    expect(screen.getByText('MG')).toBeInTheDocument()
    // El nombre completo queda accesible para lectores de pantalla.
    expect(screen.getByText('María Gómez')).toHaveClass('sr-only')
  })

  it('el mismo id siempre pinta el mismo color de fondo', () => {
    const { container: first } = render(<Avatar id="emp-42" name="Ana Ruiz" />)
    const { container: second } = render(<Avatar id="emp-42" name="Ana Ruiz" />)
    const firstFallback = first.querySelector('[data-slot=avatar-fallback]')
    const secondFallback = second.querySelector('[data-slot=avatar-fallback]')
    expect((firstFallback as HTMLElement).style.backgroundColor).toBe(
      (secondFallback as HTMLElement).style.backgroundColor,
    )
  })
})
