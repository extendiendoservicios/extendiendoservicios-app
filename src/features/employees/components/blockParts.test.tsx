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

describe('TimeCell: esquinas exteriores de arriba (P34.2, D-15)', () => {
  function cell(corner: 'left' | 'right' | undefined, editable: boolean) {
    render(
      <TimeCell
        value="08:00"
        label="Hora"
        editable={editable}
        corner={corner}
        suppressClick={() => false}
        onCommit={() => undefined}
      />,
    )
  }

  it('la casilla de inicio redondea arriba a la izquierda', () => {
    cell('left', false)
    expect(screen.getByText('08:00').className).toContain(
      'rounded-tl-[calc(var(--radius-sm)-1px)]',
    )
  })

  it('la de fin redondea arriba a la derecha, también al editarla', () => {
    cell('right', true)
    expect(screen.getByRole('button', { name: 'Hora' }).className).toContain(
      'rounded-tr-[calc(var(--radius-sm)-1px)]',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Hora' }))
    const input = screen.getByRole('textbox', { name: 'Hora' })
    expect(input.className).toContain('rounded-tr-[calc(var(--radius-sm)-1px)]')
  })

  it('sin `corner` no redondea nada', () => {
    cell(undefined, false)
    expect(screen.getByText('08:00').className).not.toContain('rounded-t')
  })
})
