import { describe, expect, it } from 'vitest'
import { joinObservations } from './observation'

describe('joinObservations (AJ2-15)', () => {
  it('une las partes con « · » y descarta las vacías', () => {
    expect(
      joinObservations(
        'Inasistencia: sin fichaje de inicio',
        null,
        '  ',
        'Llevar llaves',
      ),
    ).toBe('Inasistencia: sin fichaje de inicio · Llevar llaves')
  })

  it('devuelve cadena vacía si no hay nada', () => {
    expect(joinObservations(undefined, null, '')).toBe('')
  })

  it('con una sola parte no agrega separador', () => {
    expect(joinObservations('', ' Llevar llaves ')).toBe('Llevar llaves')
  })
})
