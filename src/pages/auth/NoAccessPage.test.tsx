import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NoAccessPage from './NoAccessPage'
import * as authModule from '@/features/auth/AuthProvider'
import type { AuthContextValue } from '@/features/auth/AuthProvider'

/** COM-05 (AUTH-006): sesión sin ningún rol, o sin sesión (URL directa). */
interface BrandingHookResult {
  status: 'loading' | 'ready' | 'error'
  branding: {
    name: string | null
    logoPath: string | null
    supportPhone: string | null
  } | null
}
// `vi.hoisted`: ver el comentario largo de `LoginPage.test.tsx` — sin esto,
// referenciar `brandingMock` directo dentro de la factory explota con la
// suite completa (`pnpm test`), aunque el archivo solo pase.
const { brandingMock } = vi.hoisted(() => ({
  brandingMock: vi.fn<() => BrandingHookResult>(),
}))
vi.mock('@/features/auth/useBranding', () => ({
  useBranding: brandingMock,
}))

function authValue(overrides: Partial<AuthContextValue>): AuthContextValue {
  return {
    status: 'unauthenticated',
    userId: null,
    email: null,
    roles: [],
    capabilities: [],
    profile: null,
    displayName: 'Cuenta',
    isPasswordRecovery: false,
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/sin-acceso']}>
      <Routes>
        <Route path="/sin-acceso" element={<NoAccessPage />} />
        <Route path="/ingresar" element={<p>Pantalla de ingreso</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  brandingMock.mockReturnValue({
    status: 'ready',
    branding: {
      name: 'Extendiendo Servicios',
      logoPath: null,
      supportPhone: '11 4000-0000',
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('NoAccessPage (COM-05)', () => {
  it('sin sesión redirige a /ingresar (no tiene sentido mostrar "sin acceso" sin sesión)', () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({ status: 'unauthenticated' }),
    )

    renderPage()

    expect(screen.getByText('Pantalla de ingreso')).toBeInTheDocument()
  })

  it('con sesión sin roles muestra el mensaje y el teléfono de soporte', () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({ status: 'authenticated', roles: [] }),
    )

    renderPage()

    expect(
      screen.getByRole('heading', { name: 'Sin acceso' }),
    ).toBeInTheDocument()
    expect(screen.getByText('11 4000-0000')).toBeInTheDocument()
  })

  it('el botón "Cerrar sesión" llama a auth.signOut()', () => {
    const signOut = vi.fn()
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({ status: 'authenticated', roles: [], signOut }),
    )

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))

    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
