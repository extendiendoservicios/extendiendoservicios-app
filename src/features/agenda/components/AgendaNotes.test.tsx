import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeAgendaItem } from './agendaTestUtils'
import { AgendaNotes } from './AgendaNotes'

vi.mock('../queries', () => {
  const mutation = () => ({ mutate: vi.fn(), isPending: false })
  return {
    useSaveAgendaItemMutation: mutation,
    useSetAgendaItemResolvedMutation: mutation,
    useDuplicateAgendaItemMutation: mutation,
    useDeleteAgendaItemMutation: mutation,
  }
})

describe('AgendaNotes', () => {
  it('cada nota tiene cuatro íconos sin texto en una sola línea', () => {
    const note = makeAgendaItem({ kind: 'nota', body: 'Llamar a Pérez' })
    render(<AgendaNotes items={[note]} month="2026-11-01" />)
    const row = screen.getByTestId('agenda-note')
    const buttons = within(row).getAllByRole('button')
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Marcar como resuelto',
      'Colores',
      'Duplicar al mes siguiente',
      'Eliminar',
    ])
    expect(buttons.every((b) => b.textContent === '')).toBe(true)
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'false')
  })

  it('la nota resuelta muestra el check activo', () => {
    const note = makeAgendaItem({
      kind: 'nota',
      body: 'Listo',
      resolved: true,
    })
    render(<AgendaNotes items={[note]} month="2026-11-01" />)
    expect(
      screen.getByRole('button', { name: 'Quitar resuelto' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })
})
