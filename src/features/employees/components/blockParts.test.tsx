import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TimeCell } from './blockParts'

/** Escribe tecla por tecla (cada tecla dispara un `change` con lo acumulado). */
function typeKeys(input: HTMLElement, text: string) {
  let acc = ''
  for (const char of text) {
    acc += char
    fireEvent.change(input, { target: { value: acc } })
  }
}

function setup(value = '08:00') {
  const onCommit = vi.fn()
  render(
    <TimeCell
      value={value}
      label="Hora de inicio"
      editable
      suppressClick={() => false}
      onCommit={onCommit}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Hora de inicio' }))
  const input = screen.getByRole('textbox', { name: 'Hora de inicio' })
  fireEvent.change(input, { target: { value: '' } })
  return { onCommit, input }
}

describe('TimeCell: hora escrita con el teclado (DEF-P30-05)', () => {
  it('«0830» y Enter confirman 08:30 sin que se pise lo escrito', () => {
    const { onCommit, input } = setup('09:00')
    typeKeys(input, '0830')
    expect(input).toHaveValue('0830')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('08:30')
  })

  it('«8:30» y salir de la casilla confirman 08:30', () => {
    const { onCommit, input } = setup('09:00')
    typeKeys(input, '8:30')
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('08:30')
  })

  it('Escape cancela', () => {
    const { onCommit, input } = setup('09:00')
    typeKeys(input, '1015')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('si no cambia la hora no confirma', () => {
    const { onCommit, input } = setup('08:30')
    typeKeys(input, '0830')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('un texto inválido se entrega tal cual para que la pantalla avise', () => {
    const { onCommit, input } = setup('09:00')
    typeKeys(input, '99')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('99')
  })
})
