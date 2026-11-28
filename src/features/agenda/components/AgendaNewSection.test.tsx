import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { NEW_SLOT_NAMES } from '../agendaMonth'
import { makeAgendaItem } from './agendaTestUtils'
import { AgendaNewSection } from './AgendaNewSection'

vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }))
vi.mock('../queries', () => ({
  useSaveAgendaItemMutation: () => ({ mutate: vi.fn(), isPending: false }),
}))

const suggestions = { places: [], clients: [], employees: [] }

describe('AgendaNewSection', () => {
  it('las columnas se llaman de Lunes a Domingo y llevan encabezado', () => {
    expect([...NEW_SLOT_NAMES]).toEqual([
      'Lunes',
      'Martes',
      'Miércoles',
      'Jueves',
      'Viernes',
      'Sábado',
      'Domingo',
    ])
    const item = makeAgendaItem({ kind: 'nuevo', slot: 2, placeName: 'Café' })
    render(
      <MemoryRouter>
        <AgendaNewSection
          items={[item]}
          month="2026-11-01"
          suggestions={suggestions}
        />
      </MemoryRouter>,
    )
    for (const name of NEW_SLOT_NAMES) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('group', { name: 'Miércoles' })).toHaveTextContent(
      'Café',
    )
  })
})
