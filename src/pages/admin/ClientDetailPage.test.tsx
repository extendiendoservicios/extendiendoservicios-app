import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import ClientDetailPage from './ClientDetailPage'

vi.mock('@/features/clients/queries', () => ({
  useClientDetailQuery: () => ({
    isLoading: false,
    data: {
      id: 'c1',
      legalName: 'Limpieza SA',
      tradeName: null,
      cuit: null,
      adminAddress: null,
      calendarColor: null,
      notes: null,
      status: 'active',
      photoPath: null,
    },
  }),
  useClientSitesQuery: () => ({ isLoading: false, data: [] }),
}))
vi.mock('@/features/bank/queries', () => ({
  useClientBankDetailsQuery: () => ({ data: undefined, isLoading: false }),
}))
vi.mock('@/features/bank/components/BankDetailsCard', () => ({
  BankDetailsCard: () => null,
}))
vi.mock('@/features/supervisions/components/PreferredSupervisorsBlock', () => ({
  PreferredSupervisorsBlock: () => null,
}))
vi.mock('@/features/clients/components/ClientCalendarioTab', () => ({
  ClientCalendarioTab: () => <p>Pestaña del calendario</p>,
}))
vi.mock('@/features/clients/components/ClientContactsPanel', () => ({
  ClientContactsPanel: () => null,
}))
vi.mock('@/features/clients/components/ClientServiceSummaryTab', () => ({
  ClientServiceSummaryTab: () => null,
}))
vi.mock('@/features/checklists/components/ClientTemplateSummary', () => ({
  ClientTemplateSummary: () => null,
}))
vi.mock('@/features/services/components/ServiceList', () => ({
  NewServiceButton: () => null,
  ServiceList: () => null,
}))
vi.mock('@/features/clients/components/ChangeClientStatusDialog', () => ({
  ChangeClientStatusDialog: () => null,
}))
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ roles: ['admin'], capabilities: [] }),
}))

function Search() {
  return <p data-testid="search">{useLocation().search}</p>
}

function renderPage(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin/clientes/:id" element={<ClientDetailPage />} />
      </Routes>
      <Search />
    </MemoryRouter>,
  )
}

describe('ClientDetailPage: pestañas (P34.1, D-01)', () => {
  it('sin pestaña se abre «Calendario», que es la primera', () => {
    renderPage('/admin/clientes/c1')
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]?.textContent).toBe('Calendario')
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Pestaña del calendario')).toBeTruthy()
  })

  it('«Sedes» se abre con ?pestana=sedes', () => {
    renderPage('/admin/clientes/c1?pestana=sedes')
    expect(
      screen.getByRole('tab', { name: 'Sedes' }).getAttribute('aria-selected'),
    ).toBe('true')
    expect(screen.getByText('Todavía no hay sedes cargadas')).toBeTruthy()
  })

  it('cambiar de pestaña borra mes, sede y empleado', () => {
    renderPage('/admin/clientes/c1?mes=2026-11&sede=s1&empleado=e1')
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Sedes' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Sedes' }))
    expect(screen.getByTestId('search').textContent).toBe('?pestana=sedes')
  })
})
