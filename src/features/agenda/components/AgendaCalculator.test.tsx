import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AgendaCalculator } from './AgendaCalculator'

describe('AgendaCalculator', () => {
  it('suma con los botones', () => {
    render(<AgendaCalculator />)
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sumar' }))
    fireEvent.click(screen.getByRole('button', { name: '3' }))
    fireEvent.click(screen.getByRole('button', { name: 'Igual' }))
    expect(screen.getByLabelText('Resultado')).toHaveTextContent('5')
  })

  it('funciona con el teclado cuando tiene el foco', () => {
    render(<AgendaCalculator />)
    const pad = screen.getByRole('group', { name: 'Teclado de la calculadora' })
    for (const key of ['9', '/', '3', 'Enter']) {
      fireEvent.keyDown(pad, { key })
    }
    expect(screen.getByLabelText('Resultado')).toHaveTextContent('3')
  })

  it('muestra Error al dividir por cero', () => {
    render(<AgendaCalculator />)
    const pad = screen.getByRole('group', { name: 'Teclado de la calculadora' })
    for (const key of ['5', '/', '0', '=']) {
      fireEvent.keyDown(pad, { key })
    }
    expect(screen.getByLabelText('Resultado')).toHaveTextContent('Error')
  })
})
