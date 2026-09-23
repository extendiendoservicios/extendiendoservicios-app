import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LoginPage from './LoginPage'
import * as authModule from '@/features/auth/AuthProvider'
import type { AuthContextValue } from '@/features/auth/AuthProvider'

/**
 * COM-01 (AUTH-003/AUTH-004): sin red — `@/lib/supabase` y `useBranding` se
 * mockean, `useAuth()` se pisa por test con `vi.spyOn` (mismo patrón que
 * `RequireRole.test.tsx`).
 *
 * `vi.hoisted`: `vi.mock(...)` se sube sola al principio del archivo (antes
 * que cualquier `import`, `05` es el propio aviso de Vitest) — sin esto, la
 * referencia directa a `signInWithPasswordMock`/`brandingMock` DENTRO de la
 * factory explota con "Cannot access ... before initialization" en cuanto
 * corre junto con el resto de la suite (`pnpm test`), aunque el archivo
 * solo pase igual. Corrido de verdad, no solo leído: ver el reporte del
 * encargo P06.3.
 */
interface SignInResult {
  data: { user: unknown; session: unknown }
  error: { code: string; message: string; status: number; name: string } | null
}
interface BrandingHookResult {
  status: 'loading' | 'ready' | 'error'
  branding: {
    name: string | null
    logoPath: string | null
    supportPhone: string | null
  } | null
}
const { signInWithPasswordMock, brandingMock } = vi.hoisted(() => ({
  signInWithPasswordMock:
    vi.fn<
      (credentials: {
        email: string
        password: string
      }) => Promise<SignInResult>
    >(),
  brandingMock: vi.fn<() => BrandingHookResult>(),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: signInWithPasswordMock } },
}))
vi.mock('@/features/auth/useBranding', () => ({
  useBranding: brandingMock,
  brandingLogoUrl: (path: string) =>
    `https://ejemplo.supabase.co/storage/v1/object/public/branding/${path}`,
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

/** Mismo criterio que `AdminShell.test.tsx`: `min-width` según el ancho simulado. */
function mockViewportWidth(widthPx: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const minWidthMatch = /min-width:\s*(\d+)px/.exec(query)
    const minWidth = minWidthMatch?.[1] ? Number(minWidthMatch[1]) : 0
    return {
      matches: widthPx >= minWidth,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
  })
}

function renderLoginPage() {
  return render(
    <MemoryRouter initialEntries={['/ingresar']}>
      <Routes>
        <Route path="/ingresar" element={<LoginPage />} />
        <Route path="/recuperar" element={<p>Recuperar contraseña</p>} />
        <Route path="/admin" element={<p>Resumen de administración</p>} />
        <Route path="/app" element={<p>Hoy del empleado</p>} />
        <Route path="/sin-acceso" element={<p>Sin acceso</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  signInWithPasswordMock.mockReset()
  brandingMock.mockReturnValue({
    status: 'ready',
    branding: {
      name: 'Extendiendo Servicios',
      logoPath: null,
      supportPhone: '11 4000-0000',
    },
  })
  mockViewportWidth(1440)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LoginPage (COM-01)', () => {
  it('sin sesión muestra el formulario con email, contraseña y el teléfono de soporte', () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({ status: 'unauthenticated' }),
    )

    renderLoginPage()

    expect(
      screen.getByRole('heading', { name: 'Ingresar' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument()
    expect(screen.getByText('11 4000-0000')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '¿Olvidaste tu contraseña?' }),
    ).toHaveAttribute('href', '/recuperar')
  })

  it('una contraseña o un email incorrectos muestran el mismo error genérico', async () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({ status: 'unauthenticated' }),
    )
    signInWithPasswordMock.mockResolvedValue({
      data: { user: null, session: null },
      error: {
        code: 'invalid_credentials',
        message: 'Invalid login credentials',
        status: 400,
        name: 'AuthApiError',
      },
    })

    renderLoginPage()
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'carlos.medina@extendiendoservicios.com' },
    })
    fireEvent.change(screen.getByLabelText('Contraseña'), {
      target: { value: 'mal-puesta-123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }))

    expect(
      await screen.findByText('El email o la contraseña no son correctos.'),
    ).toBeInTheDocument()
    // Ni "no existe" ni el email vuelven a aparecer en el mensaje de error:
    // no delata si la cuenta existe (encargo P06.3, punto 1).
    expect(screen.queryByText(/no existe/i)).not.toBeInTheDocument()
  })

  it('con sesión de administradora en escritorio redirige a /admin', () => {
    mockViewportWidth(1440)
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({ status: 'authenticated', roles: ['admin'] }),
    )

    renderLoginPage()

    expect(screen.getByText('Resumen de administración')).toBeInTheDocument()
  })

  it('con sesión de empleada redirige a /app aunque el ancho sea de escritorio', () => {
    mockViewportWidth(1440)
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({ status: 'authenticated', roles: ['employee'] }),
    )

    renderLoginPage()

    expect(screen.getByText('Hoy del empleado')).toBeInTheDocument()
  })

  it('en modo de recuperación de contraseña no redirige: se queda para que /restablecer la atienda', () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({
        status: 'authenticated',
        roles: ['employee'],
        isPasswordRecovery: true,
      }),
    )

    renderLoginPage()

    expect(
      screen.getByRole('heading', { name: 'Ingresar' }),
    ).toBeInTheDocument()
  })
})
