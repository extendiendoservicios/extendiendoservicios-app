import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ClientLegend, StatusDotLegend } from './ColorLegends'
import { ShiftChip } from './ShiftChip'

describe('ShiftChip', () => {
  it('modo Estado: insignia con el estado en sr-only y sin puntito', () => {
    render(
      <ShiftChip
        label="Colegio · Sede · 08:00–12:00"
        displayStatus="uncovered"
        clientCalendarColor={0}
        colorBy="status"
      />,
    )
    expect(screen.getByText(/Sin cubrir:/)).toHaveClass('sr-only')
    expect(screen.queryByTestId('status-dot')).toBeNull()
    expect(screen.queryByTestId('client-chip')).toBeNull()
  })

  it('modo Cliente: colores del cliente, puntito de estado y sr-only', () => {
    render(
      <ShiftChip
        label="Colegio · Sede · 08:00–12:00"
        displayStatus="completed"
        clientCalendarColor={0}
        colorBy="client"
      />,
    )
    const chip = screen.getByTestId('client-chip')
    expect(chip.style.background).not.toBe('')
    expect(screen.getByTestId('status-dot')).toHaveClass('bg-success')
    expect(screen.getByText(/Finalizado:/)).toHaveClass('sr-only')
    expect(chip).not.toHaveClass('line-through')
  })

  it('modo Cliente: el cancelado va tachado', () => {
    render(
      <ShiftChip
        label="x"
        displayStatus="cancelled"
        clientCalendarColor={3}
        colorBy="client"
      />,
    )
    expect(screen.getByTestId('client-chip')).toHaveClass('line-through')
  })

  it('modo Cliente sin color válido cae a la insignia de estado', () => {
    render(
      <ShiftChip
        label="x"
        displayStatus="assigned"
        clientCalendarColor={null}
        colorBy="client"
      />,
    )
    expect(screen.queryByTestId('client-chip')).toBeNull()
    expect(screen.getByText(/Asignado:/)).toBeInTheDocument()
  })
})

describe('ClientLegend', () => {
  const clients = [
    { id: 'c1', name: 'Colegio Los Robles', calendarColor: 0 },
    { id: 'c2', name: 'Clínica Del Parque', calendarColor: 1 },
  ]

  it('un clic filtra por el cliente y otro clic sobre el mismo lo limpia', () => {
    const onSelect = vi.fn()
    const { rerender } = render(
      <ClientLegend
        title="Clientes del mes"
        clients={clients}
        selectedId={null}
        onSelect={onSelect}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Colegio Los Robles' }))
    expect(onSelect).toHaveBeenLastCalledWith('c1')

    rerender(
      <ClientLegend
        title="Clientes del mes"
        clients={clients}
        selectedId="c1"
        onSelect={onSelect}
      />,
    )
    const selected = screen.getByRole('button', { name: 'Colegio Los Robles' })
    expect(selected).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(selected)
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })

  it('no muestra nada sin clientes', () => {
    const { container } = render(
      <ClientLegend
        title="Clientes del mes"
        clients={[]}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('StatusDotLegend', () => {
  it('lista los estados del puntito', () => {
    render(<StatusDotLegend />)
    expect(screen.getByText('Sin cubrir')).toBeInTheDocument()
    expect(screen.getByText('Finalizado')).toBeInTheDocument()
  })
})
