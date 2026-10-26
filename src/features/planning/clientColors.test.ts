import { describe, expect, it } from 'vitest'
import { CLIENT_COLORS, clientChipColors, getClientColor } from './clientColors'

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ]
  return (hi + 0.05) / (lo + 0.05)
}

describe('paleta de colores por cliente', () => {
  it('tiene 12 colores con índices 0 a 11, nombres y tonos únicos', () => {
    expect(CLIENT_COLORS).toHaveLength(12)
    expect(CLIENT_COLORS.map((c) => c.index)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ])
    expect(new Set(CLIENT_COLORS.map((c) => c.hex)).size).toBe(12)
    expect(new Set(CLIENT_COLORS.map((c) => c.name)).size).toBe(12)
  })

  it('el texto sobre el fondo del chip cumple contraste AA (4,5:1) en los 12', () => {
    for (const color of CLIENT_COLORS) {
      const chip = clientChipColors(color.index)
      expect(chip, color.name).not.toBeNull()
      expect(
        contrast(chip!.color, chip!.background),
        color.name,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('devuelve null para un índice inválido o ausente', () => {
    expect(getClientColor(12)).toBeNull()
    expect(clientChipColors(null)).toBeNull()
    expect(clientChipColors(undefined)).toBeNull()
  })
})
