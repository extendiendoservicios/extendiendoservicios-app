import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SupervisorMorePage from './MorePage'
import * as authModule from '@/features/auth/AuthProvider'
import type { AuthContextValue } from '@/features/auth/AuthProvider'
import * as installPromptModule from '@/hooks/useInstallPrompt'

/**
 * SUP-09 (MOB-SUP-009, MOB-SUP-010): "Mis servicios" (acceso cruzado a
 * EMP-03, `/app`) solo si la persona también es empleada; "Instalar la app"
 * solo si `useInstallPrompt` la ofrece. Mismo patrón de mocks que
 * `src/pages/app/MorePage.test.tsx`.
 */
function authValue(overrides: Partial<AuthContextValue>): AuthContextValue {
  return {
    status: 'authenticated',
    userId: 'user-1',
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

afterEach(() => {
  vi.restoreAllMocks()
})

function renderMorePage() {
  return render(
    <MemoryRouter>
      <SupervisorMorePage />
    </MemoryRouter>,
  )
}

describe('SupervisorMorePage (SUP-09)', () => {
  it('siempre muestra "Mi perfil" y "Cerrar sesión", sin "Mis servicios" para quien no es empleado', () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue(authValue({}))
    vi.spyOn(installPromptModule, 'useInstallPrompt').mockReturnValue({
      available: false,
      promptInstall: vi.fn(),
    })

    renderMorePage()

    expect(screen.getByText('Mi perfil')).toBeInTheDocument()
    expect(screen.getByText('Cerrar sesión')).toBeInTheDocument()
    expect(screen.queryByText('Mis servicios')).not.toBeInTheDocument()
    expect(screen.queryByText('Instalar la app')).not.toBeInTheDocument()
  })

  it('muestra "Mis servicios" con enlace a /app cuando la persona también es empleada', () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({ roles: ['supervisor', 'employee'] }),
    )
    vi.spyOn(installPromptModule, 'useInstallPrompt').mockReturnValue({
      available: false,
      promptInstall: vi.fn(),
    })

    renderMorePage()

    const link = screen.getByText('Mis servicios').closest('a')
    expect(link).toHaveAttribute('href', '/app')
  })

  it('muestra "Instalar la app" solo cuando el navegador la ofrece', () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue(authValue({}))
    vi.spyOn(installPromptModule, 'useInstallPrompt').mockReturnValue({
      available: true,
      promptInstall: vi.fn(),
    })

    renderMorePage()

    expect(screen.getByText('Instalar la app')).toBeInTheDocument()
  })

  it('cierra sesión al tocar "Cerrar sesión"', () => {
    const signOut = vi.fn()
    vi.spyOn(authModule, 'useAuth').mockReturnValue(authValue({ signOut }))
    vi.spyOn(installPromptModule, 'useInstallPrompt').mockReturnValue({
      available: false,
      promptInstall: vi.fn(),
    })

    renderMorePage()
    screen.getByText('Cerrar sesión').click()

    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
