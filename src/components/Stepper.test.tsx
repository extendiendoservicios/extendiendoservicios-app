import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Stepper } from './Stepper'

describe('Stepper', () => {
  it('deshabilita "restar" cuando el valor está en el mínimo', () => {
    render(
      <Stepper
        aria-label="Minutos"
        value={0}
        min={0}
        max={5}
        onValueChange={() => {}}
      />,
    )

    expect(screen.getByRole('button', { name: 'Restar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Sumar' })).not.toBeDisabled()
  })

  it('deshabilita "sumar" cuando el valor está en el máximo', () => {
    render(
      <Stepper
        aria-label="Minutos"
        value={5}
        min={0}
        max={5}
        onValueChange={() => {}}
      />,
    )

    expect(screen.getByRole('button', { name: 'Sumar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Restar' })).not.toBeDisabled()
  })

  it('sumar y restar avanzan de a un paso', () => {
    const handleChange = vi.fn()
    render(
      <Stepper
        aria-label="Minutos"
        value={2}
        min={0}
        max={5}
        onValueChange={handleChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Sumar' }))
    expect(handleChange).toHaveBeenLastCalledWith(3)

    fireEvent.click(screen.getByRole('button', { name: 'Restar' }))
    expect(handleChange).toHaveBeenLastCalledWith(1)
  })

  it('muestra el valor actual', () => {
    render(
      <Stepper
        aria-label="Minutos"
        value={4}
        min={0}
        max={10}
        onValueChange={() => {}}
      />,
    )

    expect(screen.getByText('4')).toBeInTheDocument()
  })
})
