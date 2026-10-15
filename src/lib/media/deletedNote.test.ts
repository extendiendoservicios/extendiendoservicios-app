import { describe, expect, it } from 'vitest'
import { deletedNote } from './deletedNote'

describe('deletedNote', () => {
  it('nombra a quien eliminó y el día', () => {
    expect(
      deletedNote({
        deletedAt: '2026-08-13T15:00:00Z',
        firstName: 'Ana',
        lastName: 'Pérez',
      }),
    ).toBe('Eliminada por Ana Pérez el día jue 13 ago')
  })

  it('sin nombre, deja solo el día', () => {
    expect(
      deletedNote({
        deletedAt: '2026-08-13T15:00:00Z',
        firstName: null,
        lastName: null,
      }),
    ).toBe('Eliminada el día jue 13 ago')
  })

  it('usa el día de Buenos Aires aunque en UTC ya sea el siguiente', () => {
    expect(deletedNote({ deletedAt: '2026-08-14T01:30:00Z' })).toBe(
      'Eliminada el día jue 13 ago',
    )
  })
})
