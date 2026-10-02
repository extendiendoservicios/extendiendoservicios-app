import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/appVersion', () => ({ APP_VERSION: '0.14.0' }))

import { AppVersion } from './AppVersion'

describe('AppVersion', () => {
  it('muestra el número de versión (ADR-020)', () => {
    render(<AppVersion />)
    expect(screen.getByText('Versión 0.14.0')).toBeInTheDocument()
  })
})
