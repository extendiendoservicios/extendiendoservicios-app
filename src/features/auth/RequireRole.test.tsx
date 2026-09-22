import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { RequireRole } from './RequireRole'
import * as authModule from './AuthProvider'
import type { AuthContextValue } from './AuthProvider'
import type { Role } from './session'

/**
 * `RequireRole` contra la sesión real (`useAuth`, AuthProvider.tsx):
 * reemplaza la suite que probaba la sesión provisoria de F5 (`useSession`/
 * `devRole.ts`, ya borrados en P06.2). `AuthProvider` en sí se prueba en
 * `AuthProvider.test.tsx` — acá solo importa qué hace `RequireRole` con
 * cada valor que `useAuth()` puede devolver.
 */
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

function renderProtectedRoute(auth: AuthContextValue, allow: Role[]) {
  vi.spyOn(authModule, 'useAuth').mockReturnValue(auth)

  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/ingresar" element={<p>Pantalla de ingreso</p>} />
        <Route path="/sin-acceso" element={<p>Sin acceso</p>} />
        <Route path="/app" element={<p>Inicio del empleado</p>} />
        <Route path="/sup" element={<p>Inicio del supervisor</p>} />
        <Route
          path="/admin"
          element={
            <RequireRole allow={allow}>
              <p>Contenido protegido</p>
            </RequireRole>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireRole', () => {
  it('mientras la sesión está cargando no muestra ni protege ni redirige', () => {
    renderProtectedRoute(authValue({ status: 'loading' }), ['owner', 'admin'])

    expect(screen.getByRole('status', { name: 'Cargando' })).toBeInTheDocument()
    expect(screen.queryByText('Contenido protegido')).not.toBeInTheDocument()
    expect(screen.queryByText('Pantalla de ingreso')).not.toBeInTheDocument()
  })

  it('sin sesión redirige a /ingresar', () => {
    renderProtectedRoute(authValue({ status: 'unauthenticated' }), [
      'owner',
      'admin',
    ])

    expect(screen.getByText('Pantalla de ingreso')).toBeInTheDocument()
    expect(screen.queryByText('Contenido protegido')).not.toBeInTheDocument()
  })

  it('con un rol que no corresponde redirige a su propia vía', () => {
    renderProtectedRoute(
      authValue({ status: 'authenticated', roles: ['employee'] }),
      ['owner', 'admin'],
    )

    expect(screen.getByText('Inicio del empleado')).toBeInTheDocument()
    expect(screen.queryByText('Contenido protegido')).not.toBeInTheDocument()
  })

  it('un supervisor que no es empleado va a /sup', () => {
    renderProtectedRoute(
      authValue({ status: 'authenticated', roles: ['supervisor'] }),
      ['owner', 'admin'],
    )

    expect(screen.getByText('Inicio del supervisor')).toBeInTheDocument()
  })

  it('con sesión pero sin ningún rol redirige a /sin-acceso (desactivado o sin roles)', () => {
    renderProtectedRoute(authValue({ status: 'authenticated', roles: [] }), [
      'owner',
      'admin',
    ])

    expect(screen.getByText('Sin acceso')).toBeInTheDocument()
    expect(screen.queryByText('Contenido protegido')).not.toBeInTheDocument()
  })

  it('con el rol correcto muestra el contenido protegido', () => {
    renderProtectedRoute(
      authValue({ status: 'authenticated', roles: ['admin'] }),
      ['owner', 'admin'],
    )

    expect(screen.getByText('Contenido protegido')).toBeInTheDocument()
  })

  it('acepta a quien tiene más de un rol si alguno está permitido', () => {
    renderProtectedRoute(
      authValue({ status: 'authenticated', roles: ['employee', 'supervisor'] }),
      ['supervisor'],
    )

    expect(screen.getByText('Contenido protegido')).toBeInTheDocument()
  })
})
