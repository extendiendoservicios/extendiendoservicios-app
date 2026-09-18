import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConstructionPage } from './ConstructionPage'

describe('ConstructionPage', () => {
  it('muestra el texto "Plataforma en construcción"', () => {
    render(<ConstructionPage />)

    expect(screen.getByText('Plataforma en construcción')).toBeInTheDocument()
  })
})
