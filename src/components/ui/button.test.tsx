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

  it('con asChild renderiza el hijo (un link) en vez de un <button>, sin romper (DS-015)', () => {
    render(
      <Button asChild>
        <a href="/admin">Ir a admin</a>
      </Button>,
    )

    const link = screen.getByRole('link', { name: 'Ir a admin' })
    expect(link).toHaveAttribute('href', '/admin')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('Button · objetivo táctil (RESP-003)', () => {
  it('md y sm crecen a 44 px de alto por debajo de 768 px', () => {
    render(
      <>
        <Button>Guardar</Button>
        <Button size="sm">Ver</Button>
      </>,
    )

    expect(screen.getByRole('button', { name: 'Guardar' })).toHaveClass(
      'max-md:min-h-11',
    )
    expect(screen.getByRole('button', { name: 'Ver' })).toHaveClass(
      'max-md:min-h-11',
    )
  })

  it('el link en línea no se agranda', () => {
    render(<Button variant="link">Ver más</Button>)

    const button = screen.getByRole('button', { name: 'Ver más' })
    expect(button).toHaveClass('max-md:min-h-0')
    expect(button).not.toHaveClass('max-md:min-h-11')
  })
})
