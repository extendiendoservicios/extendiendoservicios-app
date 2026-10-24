import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { vi } from 'vitest'
import * as authModule from '@/features/auth/AuthProvider'
import type { AuthContextValue } from '@/features/auth/AuthProvider'
import * as consentModule from '@/features/employee/useLocationConsent'
import * as onlineModule from '@/features/employee/useOnlineStatus'

/**
 * Ayudas de los tests de las pantallas del coordinador (P24.2): el diálogo de
 * consentimiento necesita un `QueryClient`, y casi todas las pantallas leen
 * la sesión, la conexión y el consentimiento de ubicación.
 */
export function authValue(
  overrides: Partial<AuthContextValue> = {},
): AuthContextValue {
  return {
    status: 'authenticated',
    userId: 'sup-1',
    email: 'marta.rios@extendiendoservicios.com',
    roles: ['supervisor'],
    capabilities: [],
    profile: null,
    displayName: 'Marta Ríos',
    isPasswordRecovery: false,
    signOut: vi.fn(),
    refreshProfile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

export function mockCommonHooks({
  consent = 'declined',
  online = true,
}: {
  consent?: 'granted' | 'needs-consent' | 'declined'
  online?: boolean
} = {}) {
  vi.spyOn(onlineModule, 'useOnlineStatus').mockReturnValue(online)
  vi.spyOn(authModule, 'useAuth').mockReturnValue(authValue())
  vi.spyOn(consentModule, 'useLocationConsent').mockReturnValue({
    status: consent,
    loading: false,
    reconsent: false,
    consentUpdatedAt: null,
  })
}

export function renderRoute(
  ui: ReactElement,
  { path, entry }: { path: string; entry: string },
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path={path} element={ui} />
          <Route path="*" element={<p>otra pantalla</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
