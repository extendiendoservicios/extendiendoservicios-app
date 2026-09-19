import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StagingBanner } from './StagingBanner'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('StagingBanner', () => {
  it('no muestra nada en production', () => {
    vi.stubEnv('VITE_APP_ENV', 'production')

    const { container } = render(<StagingBanner />)

    expect(container).toBeEmptyDOMElement()
  })

  it('no muestra nada en local', () => {
    vi.stubEnv('VITE_APP_ENV', 'local')

    const { container } = render(<StagingBanner />)

    expect(container).toBeEmptyDOMElement()
  })

  it('muestra "Entorno de prueba" en staging, accesible como region de estado', () => {
    vi.stubEnv('VITE_APP_ENV', 'staging')

    render(<StagingBanner />)

    expect(screen.getByRole('status')).toHaveTextContent('Entorno de prueba')
  })
})
