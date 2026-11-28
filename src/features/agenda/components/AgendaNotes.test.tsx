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
    expect(buttons[0]).toHaveTextContent('Resuelto')
    expect(buttons.slice(1).every((b) => b.textContent === '')).toBe(true)
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

  it('al resolver, la nota conserva su relleno y el verde va al botón', () => {
    const note = makeAgendaItem({
      kind: 'nota',
      body: 'Listo',
      resolved: true,
      fillColor: 20,
      fillBeforeResolved: null,
    })
    render(<AgendaNotes items={[note]} month="2026-11-01" />)
    expect(screen.getByTestId('agenda-note').style.background).toBe('')
    expect(screen.getByRole('button', { name: 'Quitar resuelto' })).toHaveClass(
      'bg-success',
    )
  })

  it('el texto de la nota es un textarea multilínea', () => {
    const note = makeAgendaItem({ kind: 'nota', body: 'uno\ndos' })
    render(<AgendaNotes items={[note]} month="2026-11-01" />)
    const field = screen.getByLabelText('Texto de la nota')
    expect(field.tagName).toBe('TEXTAREA')
    expect(field).toHaveValue('uno\ndos')
  })
})
