import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './button'

describe('Button', () => {
  it('en estado loading se deshabilita, avisa con aria-busy y lo informa a lectores de pantalla', () => {
    render(<Button loading>Guardar</Button>)

    const button = screen.getByRole('button', { name: /guardar/i })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Cargando')).toBeInTheDocument()
  })

  it('sin loading no está deshabilitado ni agrega el aviso de carga', () => {
    render(<Button>Guardar</Button>)

    const button = screen.getByRole('button', { name: 'Guardar' })
    expect(button).not.toBeDisabled()
    expect(button).not.toHaveAttribute('aria-busy')
    expect(screen.queryByText('Cargando')).not.toBeInTheDocument()
  })

  it('disabled explícito también deshabilita sin estar en loading', () => {
    render(<Button disabled>Guardar</Button>)

    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  })
})
