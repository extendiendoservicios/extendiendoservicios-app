import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MorePage from './MorePage'
import * as authModule from '@/features/auth/AuthProvider'
import type { AuthContextValue } from '@/features/auth/AuthProvider'
import * as installPromptModule from '@/features/employee/useInstallPrompt'

/**
 * EMP-13 (MOB-EMP-013): la fila "Avisar demora o ausencia" siempre
 * deshabilitada (EMP-12 es F14), "Supervisión" solo con el rol, "Instalar
 * la app" solo si `useInstallPrompt` la ofrece.
 */
function authValue(overrides: Partial<AuthContextValue>): AuthContextValue {
  return {
    status: 'authenticated',
    userId: 'user-1',
    email: 'carlos.medina@extendiendoservicios.com',
    roles: ['employee'],
    capabilities: [],
    profile: null,
    displayName: 'Carlos Medina',
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
      <MorePage />
    </MemoryRouter>,
  )
}

describe('MorePage (EMP-13)', () => {
  it('siempre muestra "Mi perfil" y "Cerrar sesión", y "Avisar demora o ausencia" deshabilitado', () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue(authValue({}))
    vi.spyOn(installPromptModule, 'useInstallPrompt').mockReturnValue({
      available: false,
      promptInstall: vi.fn(),
    })

    renderMorePage()

    expect(screen.getByText('Mi perfil')).toBeInTheDocument()
    expect(screen.getByText('Cerrar sesión')).toBeInTheDocument()
    expect(screen.getByText('Avisar demora o ausencia')).toBeInTheDocument()
    expect(screen.getByText('Próximamente')).toBeInTheDocument()
    expect(screen.queryByText('Supervisión')).not.toBeInTheDocument()
    expect(screen.queryByText('Instalar la app')).not.toBeInTheDocument()
  })

  it('muestra "Supervisión" cuando la persona también es supervisora', () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({ roles: ['employee', 'supervisor'] }),
    )
    vi.spyOn(installPromptModule, 'useInstallPrompt').mockReturnValue({
      available: false,
      promptInstall: vi.fn(),
    })

    renderMorePage()

    expect(screen.getByText('Supervisión')).toBeInTheDocument()
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
