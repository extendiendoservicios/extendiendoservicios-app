import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeAgendaItem } from './agendaTestUtils'
import { AgendaDayDialog } from './AgendaDayDialog'

vi.mock('../queries', () => {
  const mutation = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  })
  return {
    useSaveAgendaItemMutation: mutation,
    useSetAgendaItemResolvedMutation: mutation,
    useDuplicateAgendaItemMutation: mutation,
    useDeleteAgendaItemMutation: mutation,
  }
})

const suggestions = { places: [], clients: [], employees: [] }

function open(events: ReturnType<typeof makeAgendaItem>[]) {
  render(
    <AgendaDayDialog
      date="2026-11-13"
      events={events}
      suggestions={suggestions}
      onOpenChange={vi.fn()}
    />,
  )
}

describe('AgendaDayDialog', () => {
  it('arranca en lectura: solo los datos con valor, en orden, sin formulario', () => {
    open([
      makeAgendaItem({
        workType: 'Reunión',
        timeText: '8:30',
        clientPerson: 'Pérez',
        observation: 'Llevar muestras',
        resolved: true,
      }),
    ])
    const card = screen.getByTestId('agenda-event-read')
    const lines = Array.from(card.querySelectorAll('p')).map(
      (p) => p.textContent,
    )
    expect(lines).toEqual([
      'Trabajo: Reunión',
      'Hora: 8:30',
      'Cliente/Persona: Pérez',
      'Observación: Llevar muestras',
      'Resuelto',
    ])
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(screen.queryByText(/Lugar:/)).not.toBeInTheDocument()
  })

  it('Editar muestra el formulario y Cancelar vuelve a la lectura', async () => {
    open([makeAgendaItem({ workType: 'Turno' })])
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Opciones del evento' }),
      { button: 0, ctrlKey: false },
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Editar' }))
    expect(screen.getByRole('form', { name: 'Evento' })).toBeInTheDocument()
    expect(screen.queryByTestId('agenda-event-read')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByTestId('agenda-event-read')).toBeInTheDocument()
  })

  it('sin eventos avisa y deja abierto el formulario de alta', () => {
    open([])
    expect(screen.getByText('No hay eventos este día.')).toBeInTheDocument()
    expect(
      screen.getByRole('form', { name: 'Evento nuevo' }),
    ).toBeInTheDocument()
  })
})
