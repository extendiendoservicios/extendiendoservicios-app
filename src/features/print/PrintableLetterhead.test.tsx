import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PrintableLetterhead } from './PrintableLetterhead'

vi.mock('@/features/settings/queries', () => ({
  useCompanySettingsQuery: () => ({ data: undefined }),
}))

describe('PrintableLetterhead', () => {
  it('no declara un punto de referencia banner (evita landmark-no-duplicate-banner)', () => {
    const { container } = render(
      <PrintableLetterhead
        title="Detalle de asistencia"
        issuedAt={new Date('2026-10-08T17:05:00Z')}
      />,
    )
    expect(screen.queryByRole('banner')).toBeNull()
    expect(container.querySelector('header')).toBeNull()
    expect(
      screen.getByRole('heading', { name: 'Detalle de asistencia' }),
    ).toBeInTheDocument()
  })
})
