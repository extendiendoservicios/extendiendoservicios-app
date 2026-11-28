import { describe, expect, it } from 'vitest'
import {
  AGENDA_COLORS,
  RESOLVED_FILL_INDEX,
  agendaBlockStyle,
  agendaColorStyle,
  contrastRatio,
  getAgendaColor,
  readableTextColor,
} from './agendaColors'

describe('paleta de la Agenda', () => {
  it('tiene 20 colores con índices 0 a 19 y nombres distintos', () => {
    expect(AGENDA_COLORS).toHaveLength(20)
    expect(AGENDA_COLORS.map((color) => color.index)).toEqual(
      Array.from({ length: 20 }, (_, index) => index),
    )
    expect(new Set(AGENDA_COLORS.map((color) => color.name)).size).toBe(20)
  })

  it('los diez primeros son los saturados y los otros diez sus pasteles', () => {
    expect(AGENDA_COLORS.slice(0, 10).map((color) => color.name)).toEqual([
      'Rojo',
      'Azul',
      'Amarillo',
      'Verde',
      'Naranja',
      'Lila',
      'Rosa',
      'Celeste',
      'Violeta',
      'Turquesa',
    ])
    AGENDA_COLORS.slice(10).forEach((color, offset) => {
      expect(color.name).toBe(`${AGENDA_COLORS[offset]?.name} pastel`)
    })
  })

  it('el texto de cada color se lee sobre su relleno (contraste AA de 4,5:1)', () => {
    for (const color of AGENDA_COLORS) {
      expect(contrastRatio(color.hex, color.textColor)).toBeGreaterThanOrEqual(
        4.5,
      )
    }
  })

  it('elige texto oscuro sobre claro y blanco sobre oscuro', () => {
    expect(readableTextColor('#ffffff')).toBe('#1a1a1a')
    expect(readableTextColor('#000000')).toBe('#ffffff')
  })

  it('el índice 20 es el verde resuelto y no es de la paleta', () => {
    expect(getAgendaColor(RESOLVED_FILL_INDEX)).toBeNull()
    const style = agendaColorStyle(null, RESOLVED_FILL_INDEX)
    expect(style.background).toContain('--success')
    expect(style.color).toBe('#ffffff')
  })

  it('sin color no devuelve estilos', () => {
    expect(agendaBlockStyle(null, null)).toEqual({})
  })

  it('arma borde y relleno por separado', () => {
    const style = agendaBlockStyle(1, 12)
    expect(style.borderColor).toBe(AGENDA_COLORS[1]?.hex)
    expect(style.background).toBe(AGENDA_COLORS[12]?.hex)
    expect(style.color).toBe(AGENDA_COLORS[12]?.textColor)
  })
})
