import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import SupervisionsPage from './SupervisionsPage'

vi.mock('@/features/supervisions/components/SupervisionsAdminScreen', () => ({
  SupervisionsAdminScreen: ({ tab }: { tab: string }) => (
    <div data-testid="tab">{tab}</div>
  ),
}))

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <SupervisionsPage />
    </MemoryRouter>,
  )
}

describe('SupervisionsPage: ?pestana=', () => {
  it('reconoce «sin-supervisar» (P35.2)', () => {
    renderAt('/admin/supervisiones?pestana=sin-supervisar')
    expect(screen.getByTestId('tab')).toHaveTextContent('sin-supervisar')
  })

  it('un valor desconocido cae en «supervisiones»', () => {
    renderAt('/admin/supervisiones?pestana=otra')
    expect(screen.getByTestId('tab')).toHaveTextContent('supervisiones')
  })
})
