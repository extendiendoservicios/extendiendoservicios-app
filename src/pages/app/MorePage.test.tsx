import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MorePage from './MorePage'
import * as authModule from '@/features/auth/AuthProvider'
import type { AuthContextValue } from '@/features/auth/AuthProvider'
import * as installPromptModule from '@/hooks/useInstallPrompt'
import * as bankApi from '@/api/bankDetails'

/**
 * EMP-13 (MOB-EMP-013, MOB-EMP-020): la fila "Avisar demora o ausencia"
 * lleva a EMP-12 (`/app/avisar`), "Supervisión" solo con el rol, "Instalar
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
  // AJ2-04: «Más» lee los datos bancarios propios; por defecto, sin datos cargados.
  if (!vi.isMockFunction(bankApi.fetchEmployeeBankDetails)) {
    vi.spyOn(bankApi, 'fetchEmployeeBankDetails').mockResolvedValue(null)
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MorePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('MorePage (EMP-13)', () => {
  it('siempre muestra "Mi perfil", "Avisar demora o ausencia" (con enlace a EMP-12) y "Cerrar sesión"', () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue(authValue({}))
    vi.spyOn(installPromptModule, 'useInstallPrompt').mockReturnValue({
      available: false,
      promptInstall: vi.fn(),
    })

    renderMorePage()

    expect(screen.getByText('Mi perfil')).toBeInTheDocument()
    expect(screen.getByText('Cerrar sesión')).toBeInTheDocument()
    const noticeLink = screen.getByText('Avisar demora o ausencia').closest('a')
    expect(noticeLink).toHaveAttribute('href', '/app/avisar')
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

  it('AJ2-04: muestra los datos bancarios propios, solo lectura, cuando están cargados', async () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue(authValue({}))
    vi.spyOn(installPromptModule, 'useInstallPrompt').mockReturnValue({
      available: false,
      promptInstall: vi.fn(),
    })
    vi.spyOn(bankApi, 'fetchEmployeeBankDetails').mockResolvedValue({
      bankName: 'Banco Nación',
      cbu: '0170099220000067797370',
      alias: 'mi.alias',
    })

    renderMorePage()

    expect(await screen.findByText('Mis datos bancarios')).toBeInTheDocument()
    expect(screen.getByText('Banco Nación')).toBeInTheDocument()
    expect(screen.getByText('01700992 20000067797370')).toBeInTheDocument()
    expect(screen.getByText('mi.alias')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('AJ2-04: sin datos bancarios cargados no muestra la sección', async () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue(authValue({}))
    vi.spyOn(installPromptModule, 'useInstallPrompt').mockReturnValue({
      available: false,
      promptInstall: vi.fn(),
    })

    renderMorePage()

    expect(await screen.findByText('Cerrar sesión')).toBeInTheDocument()
    expect(screen.queryByText('Mis datos bancarios')).not.toBeInTheDocument()
  })
})
