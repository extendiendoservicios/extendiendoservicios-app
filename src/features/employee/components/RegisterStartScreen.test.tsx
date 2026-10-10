import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RegisterStartScreen } from './RegisterStartScreen'

const assignment = {
  clientName: 'Limpia Ya',
  siteName: 'Sede Centro',
  startTime: '08:00:00',
  endTime: '12:00:00',
}

describe('RegisterStartScreen', () => {
  it('muestra el servicio y la hora de referencia', () => {
    render(
      <RegisterStartScreen
        assignment={assignment}
        nowLabel="08:03"
        onConfirm={() => {}}
      />,
    )

    expect(screen.getByText('Limpia Ya')).toBeInTheDocument()
    expect(screen.getByText('Sede Centro')).toBeInTheDocument()
    expect(screen.getByText('08:03')).toBeInTheDocument()
    expect(screen.getByText(/la hora que vale/i)).toBeInTheDocument()
  })

  it('muestra «A terminar» y no 23:59 en un turno abierto (AJ2-10)', () => {
    render(
      <RegisterStartScreen
        assignment={{ ...assignment, endTime: '23:59:00', openEnded: true }}
        nowLabel="08:03"
        onConfirm={() => {}}
      />,
    )

    expect(screen.getByText('08:00–A terminar')).toBeInTheDocument()
    expect(screen.queryByText(/23:59/)).not.toBeInTheDocument()
  })

  it('llama a onConfirm al tocar "Registrar inicio"', () => {
    const onConfirm = vi.fn()
    render(
      <RegisterStartScreen
        assignment={assignment}
        nowLabel="08:03"
        onConfirm={onConfirm}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Registrar inicio' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('muestra el error y deshabilita el botón sin conexión', () => {
    render(
      <RegisterStartScreen
        assignment={assignment}
        nowLabel="08:03"
        onConfirm={() => {}}
        error="Ya registraste el inicio."
        offline
      />,
    )

    expect(screen.getByText('Ya registraste el inicio.')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Registrar inicio' }),
    ).toBeDisabled()
  })
})
