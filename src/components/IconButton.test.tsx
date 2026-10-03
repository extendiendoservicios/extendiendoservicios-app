import { render, screen } from '@testing-library/react'
import { Plus } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { IconButton, IconButtonGroup } from './IconButton'

describe('IconButton', () => {
  it('mide 34 px y agranda el área táctil a 44 px por debajo de 768 px', () => {
    render(<IconButton icon={Plus} aria-label="Agregar" />)

    const button = screen.getByRole('button', { name: 'Agregar' })
    expect(button).toHaveClass('size-[34px]')
    // El `::after` transparente suma 6 px por lado sobre el área interna de
    // 32 px (34 menos el borde de 1 px): 32 + 12 = 44.
    expect(button).toHaveClass('relative')
    expect(button).toHaveClass('max-md:after:absolute')
    expect(button).toHaveClass('max-md:after:-inset-[6px]')
  })
})

describe('IconButtonGroup', () => {
  it('separa 10 px en celular para que los toques de 44 px no se pisen', () => {
    const { container } = render(
      <IconButtonGroup>
        <IconButton icon={Plus} aria-label="Uno" />
        <IconButton icon={Plus} aria-label="Dos" />
      </IconButtonGroup>,
    )

    const group = container.querySelector('[data-slot="icon-button-group"]')
    expect(group).toHaveClass('gap-[10px]')
    expect(group).toHaveClass('md:gap-1')
  })
})
